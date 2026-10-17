import { parseBookInput } from "./api/parse";
import { checkIsbn } from "./api/isbn";
import type { BackupItem, ParsedBackup, RecordIssue } from "./backup";
import { csvCell } from "./export";

/**
 * Importazione da CSV. Il file non è fidato: ogni riga passa dalla STESSA validazione del server (`parseBookInput`).
 * Le colonne sono quelle dell'esportazione CSV di Bibliotheca (un file esportato si può reimportare).
 * Il CSV non porta i dati MARC21 completi né i prestiti: per quelli serve il backup JSON.
 */
export const MAX_CSV_BYTES = 20 * 1024 * 1024;
export const MAX_CSV_ROWS = 5000;
export const EXAMPLE_PREFIX = "[ESEMPIO]";

/** Intestazioni accettate → campo della scheda. Confronto senza maiuscole/accenti/spazi/trattini bassi. */
const COLUMNS: Record<string, string> = {
  titolo: "title", autori: "authors", isbn: "isbn", editore: "publisher", luogo: "publicationPlace", anno: "publicationYear",
  lingua: "language", descrizionefisica: "physicalDescription", soggetti: "subjects", dewey: "dewey", deweyfonte: "deweySource",
  deweynote: "deweyNotes", collocazione: "shelfMark", note: "notes", stato: "status",
};
export const CSV_HEADERS = ["titolo", "autori", "isbn", "editore", "luogo", "anno", "lingua", "descrizione_fisica", "soggetti", "dewey", "dewey_fonte", "dewey_note", "collocazione", "note", "stato"];
const headerKey = (h: string) => h.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[\s_\-.]+/g, "");

/** Parser CSV (RFC 4180): virgolette, virgolette doppie, a capo dentro i campi, BOM, separatore «,» o «;». */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r\n|\n|\r/, 1)[0] ?? "";
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (quoted) throw new Error("Virgolette non chiuse: il file CSV è danneggiato o troncato.");
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

/** Annulla la protezione anti-formula dell'esportazione (apostrofo davanti a = + - @). */
const unsafe = (s: string) => (/^'[=+\-@\t\r]/.test(s) ? s.slice(1) : s);
const list = (s: string) => s.split("|").map((x) => x.trim()).filter(Boolean);

export function parseCsvCatalog(text: string): ParsedBackup {
  if (text.length > MAX_CSV_BYTES) return { ok: false, message: "Il file è troppo grande (massimo 20 MB)." };
  let rows: string[][];
  try { rows = parseCsv(text); } catch (e) { return { ok: false, message: (e as Error).message + " Nulla è stato modificato." }; }
  if (rows.length === 0) return { ok: false, message: "Il file CSV è vuoto." };
  const head = rows[0]!.map(headerKey);
  const fields = head.map((h) => COLUMNS[h]);
  if (!fields.includes("title")) return { ok: false, message: "Nel CSV manca la colonna «titolo» (prima riga di intestazione). Scarica il modello e usa le sue intestazioni." };
  const warnings: string[] = [];
  const unknown = rows[0]!.filter((_, i) => !fields[i]);
  if (unknown.length) warnings.push(`Colonne ignorate perché non riconosciute: ${unknown.map((u) => `«${u.trim()}»`).join(", ")}.`);
  const dup = fields.filter((f, i) => f && fields.indexOf(f) !== i);
  if (dup.length) return { ok: false, message: "Il CSV ha colonne ripetute (stesso campo più volte). Correggi l'intestazione." };
  const body = rows.slice(1);
  if (body.length > MAX_CSV_ROWS) return { ok: false, message: `Il file ha ${body.length} righe: il massimo per una importazione è ${MAX_CSV_ROWS}. Dividilo in più file.` };

  const items: BackupItem[] = [];
  const issues: RecordIssue[] = [];
  body.forEach((cells, index) => {
    const obj: Record<string, unknown> = {};
    fields.forEach((f, c) => {
      if (!f) return;
      const v = unsafe((cells[c] ?? "").trim());
      if (f === "authors" || f === "subjects") obj[f] = list(v);
      else if (f === "status") { if (v) obj[f] = v.toLowerCase(); }
      else if (f === "deweySource") { if (v) obj[f] = v.toLowerCase(); }
      else obj[f] = v;
    });
    const title = typeof obj["title"] === "string" && obj["title"] ? (obj["title"] as string) : "(senza titolo)";
    const row = `Riga ${index + 2}`;
    if (cells.length > fields.length && cells.slice(fields.length).some((c) => c.trim())) {
      issues.push({ index, title, errors: [`${row}: ha più celle (${cells.length}) delle colonne dell'intestazione (${fields.length}). Probabile separatore o virgolette non corretti.`] });
      return;
    }
    if (title.startsWith(EXAMPLE_PREFIX)) { issues.push({ index, title, errors: [`${row}: è la riga di esempio del modello. Eliminala o sostituiscila con un libro reale.`] }); return; }
    if (!obj["title"]) { issues.push({ index, title, errors: [`${row}: il titolo è obbligatorio.`] }); return; }
    const parsed = parseBookInput(obj);
    if (!parsed.ok) { issues.push({ index, title, errors: Object.values(parsed.errors).filter((x): x is string => typeof x === "string").map((e) => `${row}: ${e}`) }); return; }
    const notes: string[] = [];
    const isbn = checkIsbn(parsed.input.isbn);
    if (isbn === "formato") notes.push("ISBN con formato non riconosciuto (attesi 10 o 13 cifre).");
    if (isbn === "controllo") notes.push("ISBN con cifra di controllo errata: probabile errore di battitura.");
    if (parsed.input.status === "catalogato") notes.push("Stato «catalogato» dichiarato nel file: verifica che il record sia davvero completo.");
    items.push({ index, input: parsed.input, ...(notes.length ? { notes } : {}) });
  });
  return { ok: true, declaredCount: body.length, items, issues, warnings };
}

/** Modello scaricabile: intestazione + una riga di ESEMPIO che l'importazione rifiuta se non viene eliminata. */
export function csvTemplate(): string {
  const example = [`${EXAMPLE_PREFIX} Titolo del libro`, "Cognome, Nome | Altro, Autore", "9780306406157", "Nome editore", "Città", "2001", "italiano", "250 pagine", "Primo soggetto | Secondo soggetto", "", "", "", "A1", "Eventuali note", "bozza"];
  return "﻿" + [CSV_HEADERS.join(","), example.map(csvCell).join(",")].join("\r\n") + "\r\n";
}
