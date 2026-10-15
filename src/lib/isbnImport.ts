import { emptyBookInput, type BooksApi } from "./api/types";
import { checkIsbn } from "./api/isbn";
import type { BackupItem, ParsedBackup, RecordIssue } from "./backup";
import { applyPlan, buildPlan, type ImportField, type Selection } from "./sources/importPlan";
import { toIsbn13 } from "./sources/isbn";

/**
 * Importazione da un ELENCO DI ISBN: ogni ISBN viene cercato nelle fonti bibliografiche integrate (Open Library, Google Books,
 * Library of Congress) tramite il server. Si accettano solo corrispondenze ESATTE (stesso ISBN-13). Nulla viene inventato né
 * completato: i campi vengono dalle fonti, che possono comunque contenere errori. I record risultanti entrano come
 * «da revisionare» e vanno confrontati con il libro.
 */
export const MAX_ISBN_LIST = 150; // limite giornaliero di ricerche per utente lato server
const MIN_GAP_MS = 6_500; // il server consente 10 ricerche al minuto

export function parseIsbnList(text: string): { isbns: string[]; issues: RecordIssue[]; warnings: string[] } {
  const tokens = text.replace(/^﻿/, "").split(/[\n\r;,\t]+/).map((t) => t.trim()).filter(Boolean);
  const isbns: string[] = [];
  const issues: RecordIssue[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  tokens.forEach((t, index) => {
    const c = checkIsbn(t);
    if (c === "formato") { issues.push({ index, title: t, errors: ["Non è un ISBN valido: servono 10 o 13 cifre (trattini e spazi sono ammessi)."] }); return; }
    if (c === "controllo") { issues.push({ index, title: t, errors: ["La cifra di controllo dell'ISBN è errata: probabile errore di battitura. Non è stato cercato."] }); return; }
    const n = toIsbn13(t);
    if (!n) { issues.push({ index, title: t, errors: ["ISBN non riconosciuto."] }); return; }
    if (seen.has(n)) { warnings.push(`ISBN ripetuto nell'elenco: ${t} (cercato una sola volta).`); return; }
    seen.add(n);
    isbns.push(n);
  });
  if (isbns.length > MAX_ISBN_LIST) {
    warnings.push(`L'elenco ha ${isbns.length} ISBN validi: vengono cercati i primi ${MAX_ISBN_LIST} (limite giornaliero delle ricerche). Ripeti domani con il resto.`);
    isbns.length = MAX_ISBN_LIST;
  }
  return { isbns, issues, warnings };
}

const FIELDS: ImportField[] = ["title", "authors", "isbn", "publisher", "publicationPlace", "publicationYear", "language", "physicalDescription"];
const sleepReal = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface LookupImportOptions {
  sleep?: (ms: number) => Promise<void>;
  onProgress?: (done: number, total: number) => void;
  shouldStop?: () => boolean;
  now?: Date;
}

export async function lookupIsbnList(api: Pick<BooksApi, "lookupSources">, text: string, o: LookupImportOptions = {}): Promise<ParsedBackup> {
  const sleep = o.sleep ?? sleepReal;
  const { isbns, issues, warnings } = parseIsbnList(text);
  const invalidCount = issues.length;
  if (isbns.length === 0 && issues.length === 0) return { ok: false, message: "L'elenco è vuoto: scrivi o incolla un ISBN per riga." };
  const date = (o.now ?? new Date()).toISOString().slice(0, 10);
  const items: BackupItem[] = [];
  let first = true;
  for (let i = 0; i < isbns.length; i++) {
    if (o.shouldStop?.()) { warnings.push(`Ricerca interrotta dall'utente dopo ${i} ISBN su ${isbns.length}: gli altri non sono stati cercati.`); break; }
    const isbn = isbns[i]!;
    let res: Awaited<ReturnType<BooksApi["lookupSources"]>> | null = null;
    for (let attempt = 0; attempt < 4 && !res; attempt++) {
      if (!first) await sleep(MIN_GAP_MS);
      first = false;
      try { res = await api.lookupSources({ isbn }); }
      catch (e) {
        const msg = e instanceof Error ? e.message : "Errore sconosciuto.";
        if ((e as { kind?: string }).kind === "auth") return { ok: false, message: msg };
        if (/Troppe ricerche/i.test(msg) && attempt < 3) { await sleep(62_000); continue; }
        issues.push({ index: i, title: isbn, errors: [`Ricerca non riuscita: ${msg}`] });
        break;
      }
    }
    o.onProgress?.(i + 1, isbns.length);
    if (!res) continue;
    const exact = res.groups.filter((g) => g.match === "esatta").sort((a, b) => b.records.length - a.records.length)[0];
    if (!exact) {
      const down = res.sources.filter((s) => s.status !== "ok").map((s) => `${s.label}: ${s.status}`);
      issues.push({ index: i, title: isbn, errors: [`Nessuna corrispondenza esatta per l'ISBN ${isbn} nelle fonti interrogate${down.length ? ` (problemi: ${down.join("; ")})` : ""}. Puoi inserirlo a mano o con la ricerca assistita.`] });
      continue;
    }
    const rows = buildPlan(exact, emptyBookInput());
    const sel: Partial<Record<ImportField, Selection>> = Object.fromEntries(FIELDS.map((f) => [f, { use: true, choice: 0 }]));
    const { next } = applyPlan(emptyBookInput(), rows, sel);
    const notes: string[] = [];
    const disagree = rows.filter((r) => FIELDS.includes(r.field) && r.candidates.length > 1).map((r) => r.label);
    if (disagree.length) notes.push(`Le fonti non concordano su: ${disagree.join(", ")} (scelto il primo valore: controlla).`);
    if (exact.records.every((r) => r.granularity === "opera")) notes.push("Le fonti descrivono l'opera, non questa edizione: editore e anno non importati.");
    if (exact.incomplete) notes.push(`Dati incompleti nelle fonti (${exact.missing.join(", ")}).`);
    if (!next.isbn) next.isbn = isbn;
    if (!next.title.trim()) { issues.push({ index: i, title: isbn, errors: ["Le fonti non forniscono un titolo per questo ISBN."] }); continue; }
    const sources = [...new Set(exact.records.map((r) => r.sourceLabel))].join(", ");
    next.status = "da revisionare";
    next.notes = `Dati importati da ISBN il ${date} dalle fonti: ${sources}. Da verificare confrontando con il libro.`;
    items.push({ index: i, input: next, ...(notes.length ? { notes } : {}) });
  }
  return { ok: true, declaredCount: isbns.length + invalidCount, items, issues, warnings };
}
