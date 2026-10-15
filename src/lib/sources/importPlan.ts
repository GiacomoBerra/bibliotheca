import type { BookInput } from "@/lib/api/types";
import type { ResultGroup, SourceRecord } from "./types";

export type ImportField = "title" | "authors" | "isbn" | "publisher" | "publicationPlace" | "publicationYear" | "language" | "physicalDescription" | "subjects" | "notes";

export const FIELD_LABELS: Record<ImportField, string> = {
  title: "Titolo", authors: "Autori", isbn: "ISBN", publisher: "Editore", publicationPlace: "Luogo di pubblicazione",
  publicationYear: "Anno di pubblicazione", language: "Lingua", physicalDescription: "Descrizione fisica", subjects: "Soggetti", notes: "Note",
};
export const FIELD_ORDER = Object.keys(FIELD_LABELS) as ImportField[];

export interface Candidate {
  /** Valore da inserire nel campo (per autori e soggetti: una voce per riga). */
  value: string;
  /** Fonti che propongono esattamente questo valore. */
  sources: string[];
  note?: string;
}
export interface PlanRow {
  field: ImportField;
  label: string;
  candidates: Candidate[];
  /** Valore già presente nella scheda (testo; liste una voce per riga). */
  current: string;
  /** true se la scheda ha già un valore diverso da tutti i candidati: servirebbe una sostituzione. */
  conflict: boolean;
  /** true se il valore attuale coincide già con un candidato. */
  same: boolean;
  /** Selezione iniziale proposta. */
  defaultUse: boolean;
}

const yearOf = (d?: string) => d?.match(/\b(1[0-9]{3}|20[0-9]{2})\b/)?.[1];

function add(map: Map<string, Candidate>, value: string | undefined, source: string, note?: string) {
  const v = value?.trim();
  if (!v) return;
  const c = map.get(v) ?? { value: v, sources: [], ...(note ? { note } : {}) };
  if (!c.sources.includes(source)) c.sources.push(source);
  map.set(v, c);
}

const currentText = (f: ImportField, b: BookInput): string => {
  switch (f) {
    case "authors": return b.authors.join("\n");
    case "subjects": return b.subjects.join("\n");
    default: return (b[f] as string).trim();
  }
};

/**
 * Costruisce l'anteprima di ciò che si può importare da un gruppo di risultati (una sola edizione, già
 * separata dalle altre). Non inventa nulla: ogni valore viene da un record e porta con sé le fonti.
 * I risultati a livello di opera propongono solo titolo, autori e soggetti: editore, anno e ISBN
 * potrebbero riferirsi a edizioni diverse.
 */
export function buildPlan(group: ResultGroup, current: BookInput): PlanRow[] {
  const maps = Object.fromEntries(FIELD_ORDER.map((f) => [f, new Map<string, Candidate>()])) as Record<ImportField, Map<string, Candidate>>;
  for (const r of group.records as SourceRecord[]) {
    const s = r.sourceLabel;
    const edition = r.granularity === "edizione";
    add(maps.title, r.title, s);
    if (r.subtitle) add(maps.title, `${r.title}: ${r.subtitle}`, s, "con sottotitolo");
    if (r.authors.length) add(maps.authors, r.authors.join("\n"), s, "nomi come nella fonte, non invertiti secondo le regole catalografiche");
    if (r.subjects.length) add(maps.subjects, r.subjects.join("\n"), s, "suggeriti dalla fonte, non controllati su elenchi d'autorità");
    if (r.description) add(maps.notes, r.description, s, "descrizione della fonte");
    if (!edition) continue;
    add(maps.isbn, r.isbn13 ?? r.isbn10, s);
    add(maps.publisher, r.publisher, s);
    add(maps.publicationPlace, r.publicationPlace, s);
    add(maps.publicationYear, yearOf(r.publicationDate), s);
    add(maps.language, r.language, s, "come scritta dalla fonte (codice o nome), non convertita");
    if (r.pages) add(maps.physicalDescription, `${r.pages} pagine`, s);
  }
  return FIELD_ORDER.map((field) => {
    const candidates = [...maps[field].values()];
    const cur = currentText(field, current);
    const same = candidates.some((c) => c.value === cur);
    const conflict = cur !== "" && !same && candidates.length > 0;
    const optional = field === "notes" || field === "subjects";
    return { field, label: FIELD_LABELS[field], candidates, current: cur, conflict, same, defaultUse: candidates.length > 0 && !conflict && !same && !optional };
  });
}

export interface Selection { use: boolean; choice: number }

export interface ImportResult {
  next: BookInput;
  /** Campi cambiati, con valore precedente e fonti del valore scelto. */
  applied: { field: ImportField; previous: string; sources: string[] }[];
  /** Campi per cui nessuna fonte ha fornito alcun dato. */
  notFound: ImportField[];
}

/**
 * Applica la selezione. Tocca SOLO i campi scelti: dewey, collocazione, stato e l'intero record MARC21
 * (marcLeader, marcFields) restano esattamente come sono. Un campo già compilato viene sostituito solo
 * se l'utente ha spuntato esplicitamente quella riga.
 */
export function applyPlan(current: BookInput, rows: PlanRow[], selection: Partial<Record<ImportField, Selection>>): ImportResult {
  const next: BookInput = { ...current };
  const applied: ImportResult["applied"] = [];
  for (const row of rows) {
    const sel = selection[row.field];
    const cand = row.candidates[sel?.choice ?? 0];
    if (!sel?.use || !cand || cand.value === row.current) continue;
    if (row.field === "authors") next.authors = cand.value.split("\n").map((x) => x.trim()).filter(Boolean);
    else if (row.field === "subjects") next.subjects = cand.value.split("\n").map((x) => x.trim()).filter(Boolean);
    else (next[row.field] as string) = cand.value;
    applied.push({ field: row.field, previous: row.current, sources: cand.sources });
  }
  return { next, applied, notFound: rows.filter((r) => r.candidates.length === 0).map((r) => r.field) };
}

/** Ripristina i valori precedenti dei soli campi importati. */
export function undoImport(current: BookInput, applied: ImportResult["applied"]): BookInput {
  const next: BookInput = { ...current };
  for (const a of applied) {
    if (a.field === "authors") next.authors = a.previous ? a.previous.split("\n") : [];
    else if (a.field === "subjects") next.subjects = a.previous ? a.previous.split("\n") : [];
    else (next[a.field] as string) = a.previous;
  }
  return next;
}
