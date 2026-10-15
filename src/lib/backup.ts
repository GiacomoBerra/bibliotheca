import { parseBookInput } from "./api/parse";
import type { Book, BookInput, BooksApi } from "./api/types";
import { BACKUP_FORMAT } from "./export";

/**
 * Ripristino da un backup JSON creato da Bibliotheca. Principi:
 * - il file non è fidato: ogni scheda passa dalla STESSA validazione del server (`parseBookInput`);
 * - il ripristino NON cancella mai nulla: crea schede nuove o, solo se l'utente lo sceglie, aggiorna quelle esistenti;
 * - i conflitti si mostrano prima e si risolvono uno per uno;
 * - le scritture avvengono con le API normali (che verificano il ruolo admin lato server).
 */
export const MAX_BACKUP_BYTES = 20 * 1024 * 1024;
export const SUPPORTED_VERSIONS = [1];

export interface RecordIssue { index: number; title: string; errors: string[] }
export interface BackupItem { index: number; id?: string; input: BookInput }
export type ParsedBackup =
  | { ok: false; message: string }
  | { ok: true; exportedAt?: string; declaredCount: number | null; items: BackupItem[]; issues: RecordIssue[]; warnings: string[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseBackup(text: string): ParsedBackup {
  if (text.length > MAX_BACKUP_BYTES) return { ok: false, message: "Il file è troppo grande (massimo 20 MB)." };
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    return { ok: false, message: "Il file non è un JSON valido: potrebbe essere danneggiato o non essere un backup di Bibliotheca. Nulla è stato modificato." };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, message: "Il file non ha la struttura di un backup di Bibliotheca." };
  const o = raw as Record<string, unknown>;
  if (o["format"] !== BACKUP_FORMAT) return { ok: false, message: "Il file non è un backup di Bibliotheca (campo «format» mancante o diverso). Un CSV o un altro formato non può essere ripristinato da qui." };
  if (typeof o["version"] !== "number" || !SUPPORTED_VERSIONS.includes(o["version"])) return { ok: false, message: `Versione del backup non supportata (${String(o["version"])}). Versioni gestite: ${SUPPORTED_VERSIONS.join(", ")}.` };
  if (!Array.isArray(o["books"])) return { ok: false, message: "Il backup non contiene l'elenco «books»." };
  const items: BackupItem[] = [];
  const issues: RecordIssue[] = [];
  const warnings: string[] = [];
  o["books"].forEach((b, index) => {
    const parsed = parseBookInput(b);
    const title = b && typeof b === "object" && typeof (b as { title?: unknown }).title === "string" ? (b as { title: string }).title : "(senza titolo)";
    if (!parsed.ok) {
      const e = parsed.errors as Record<string, string>;
      issues.push({ index, title, errors: Object.values(e).filter((x): x is string => typeof x === "string") });
      return;
    }
    const id = (b as { id?: unknown }).id;
    items.push({ index, ...(typeof id === "string" && UUID.test(id) ? { id: id.toLowerCase() } : {}), input: parsed.input });
  });
  const declared = typeof o["count"] === "number" ? o["count"] : null;
  if (declared !== null && declared !== o["books"].length) warnings.push(`Il file dichiara ${declared} schede ma ne contiene ${o["books"].length}: potrebbe essere incompleto.`);
  return { ok: true, ...(typeof o["exportedAt"] === "string" ? { exportedAt: o["exportedAt"] } : {}), declaredCount: declared, items, issues, warnings };
}

export type Resolution = "crea" | "aggiorna" | "salta";
export type Relation = "nuova" | "stesso-id" | "stesso-isbn" | "stesso-titolo-autore" | "duplicato-nel-file";
export interface PlanItem {
  item: BackupItem;
  relation: Relation;
  /** scheda esistente corrispondente (per «aggiorna») */
  match?: { id: string; title: string };
  resolution: Resolution;
}

const bare = (s: string) => s.replace(/[-\s]/g, "").toLowerCase();
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim().toLowerCase();
const key = (b: BookInput) => `${norm(b.title)}|${norm(b.authors[0] ?? "")}`;

export function relationLabel(r: Relation): string {
  return { nuova: "Nuova", "stesso-id": "Stessa scheda già presente (stesso identificativo)", "stesso-isbn": "Possibile duplicato: stesso ISBN", "stesso-titolo-autore": "Possibile duplicato: stesso titolo e primo autore", "duplicato-nel-file": "Duplicato dentro il file" }[r];
}

export function planRestore(items: BackupItem[], existing: Book[]): PlanItem[] {
  const byId = new Map(existing.map((b) => [b.id.toLowerCase(), b]));
  const byIsbn = new Map(existing.filter((b) => bare(b.isbn)).map((b) => [bare(b.isbn), b]));
  const byKey = new Map(existing.filter((b) => b.title.trim()).map((b) => [key(b), b]));
  const seenIds = new Set<string>();
  const seenIsbn = new Set<string>();
  const seenKey = new Set<string>();
  return items.map((item) => {
    const isbn = bare(item.input.isbn);
    const k = key(item.input);
    let relation: Relation = "nuova";
    let match: Book | undefined;
    if ((item.id && seenIds.has(item.id)) || (isbn && seenIsbn.has(isbn)) || seenKey.has(k)) relation = "duplicato-nel-file";
    else if (item.id && byId.has(item.id)) { relation = "stesso-id"; match = byId.get(item.id); }
    else if (isbn && byIsbn.has(isbn)) { relation = "stesso-isbn"; match = byIsbn.get(isbn); }
    else if (byKey.has(k)) { relation = "stesso-titolo-autore"; match = byKey.get(k); }
    if (item.id) seenIds.add(item.id);
    if (isbn) seenIsbn.add(isbn);
    seenKey.add(k);
    return { item, relation, ...(match ? { match: { id: match.id, title: match.title } } : {}), resolution: relation === "nuova" ? "crea" : "salta" };
  });
}

export interface RestoreResult {
  created: number;
  updated: number;
  skipped: number;
  failed: { index: number; title: string; message: string }[];
  /** true se il ripristino si è fermato prima della fine (es. sessione scaduta o permessi insufficienti) */
  aborted: boolean;
}

/** Esegue il piano, una scheda alla volta. Non cancella nulla. Si ferma se la sessione è scaduta o mancano i permessi. */
export async function applyRestore(api: Pick<BooksApi, "createBook" | "updateBook">, plan: PlanItem[], onProgress?: (done: number, total: number) => void): Promise<RestoreResult> {
  const res: RestoreResult = { created: 0, updated: 0, skipped: 0, failed: [], aborted: false };
  let done = 0;
  for (const p of plan) {
    try {
      if (p.resolution === "salta") res.skipped++;
      else if (p.resolution === "aggiorna" && p.match) { await api.updateBook(p.match.id, p.item.input); res.updated++; }
      else { await api.createBook(p.item.input); res.created++; }
    } catch (e) {
      const kind = (e as { kind?: string }).kind;
      res.failed.push({ index: p.item.index, title: p.item.input.title, message: e instanceof Error ? e.message : "Errore sconosciuto." });
      if (kind === "auth") { res.aborted = true; break; }
    }
    onProgress?.(++done, plan.length);
  }
  return res;
}
