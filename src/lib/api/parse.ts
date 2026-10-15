import { BOOK_STATUSES, emptyBookInput, type BookInput, type BookStatus, type MarcField } from "./types";
import { checkStructure } from "../marc/structure";
import { validateBook, type FieldErrors } from "./validation";

const TEXT_FIELDS = ["title", "isbn", "publisher", "publicationPlace", "publicationYear", "language", "physicalDescription", "notes", "dewey", "shelfMark"] as const;
const LIST_FIELDS = ["authors", "subjects"] as const;
const MAX_LIST_ITEMS = 100;
const MAX_ITEM_LEN = 500;
const MAX_MARC_FIELDS = 2000;

function isMarcField(f: unknown): f is MarcField {
  if (!f || typeof f !== "object") return false;
  const o = f as Record<string, unknown>;
  if (typeof o["tag"] !== "string" || !/^[0-9A-Za-z]{3}$/.test(o["tag"])) return false;
  if (typeof o["value"] === "string") return true;
  return typeof o["ind1"] === "string" && typeof o["ind2"] === "string" && Array.isArray(o["subfields"]) &&
    o["subfields"].every((s) => s && typeof (s as Record<string, unknown>)["code"] === "string" && typeof (s as Record<string, unknown>)["value"] === "string");
}

export type ParseResult = { ok: true; input: BookInput } | { ok: false; errors: FieldErrors | { _: string } };

/** Converte un JSON non fidato in BookInput controllando tipi e limiti. Ignora qualsiasi campo sconosciuto (anche user_id/owner_id). */
export function parseBookInput(raw: unknown): ParseResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, errors: { _: "Il corpo della richiesta deve essere un oggetto JSON." } };
  const o = raw as Record<string, unknown>;
  const out = emptyBookInput();
  for (const k of TEXT_FIELDS) {
    const v = o[k];
    if (v === undefined || v === null) continue;
    if (typeof v !== "string") return { ok: false, errors: { _: `Il campo «${k}» deve essere un testo.` } };
    out[k] = v;
  }
  for (const k of LIST_FIELDS) {
    const v = o[k];
    if (v === undefined || v === null) continue;
    if (!Array.isArray(v) || v.length > MAX_LIST_ITEMS || v.some((x) => typeof x !== "string" || x.length > MAX_ITEM_LEN)) {
      return { ok: false, errors: { _: `Il campo «${k}» deve essere un elenco di testi (al massimo ${MAX_LIST_ITEMS} voci da ${MAX_ITEM_LEN} caratteri).` } };
    }
    out[k] = v as string[];
  }
  if (o["status"] !== undefined) {
    if (typeof o["status"] !== "string" || !(BOOK_STATUSES as readonly string[]).includes(o["status"])) return { ok: false, errors: { _: "Stato non valido." } };
    out.status = o["status"] as BookStatus;
  }
  if (o["marcLeader"] !== undefined && o["marcLeader"] !== null) {
    if (typeof o["marcLeader"] !== "string" || o["marcLeader"].length > 24) return { ok: false, errors: { _: "Intestazione MARC (leader) non valida: al massimo 24 caratteri." } };
    out.marcLeader = o["marcLeader"];
  }
  if (o["marcFields"] !== undefined && o["marcFields"] !== null) {
    const m = o["marcFields"];
    if (!Array.isArray(m) || m.length > MAX_MARC_FIELDS || !m.every(isMarcField)) return { ok: false, errors: { _: "Campi MARC non validi: serve un elenco di campi con tag, indicatori e sottocampi." } };
    out.marcFields = m as MarcField[];
  }
  // Validità strutturale MARC21 applicata anche dal server: un record malformato non viene mai salvato.
  const marcIssues = checkStructure(out.marcLeader, out.marcFields).filter((i) => i.level === "errore");
  if (marcIssues.length) return { ok: false, errors: { _: "Record MARC21 non valido: " + marcIssues.slice(0, 3).map((i) => i.message).join(" ") } };
  const errors = validateBook(out);
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, input: out };
}
