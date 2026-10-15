import type { BookInput, MarcDataField, MarcField } from "../api/types";
import { isDataField } from "./structure";

/**
 * Corrispondenza «dati generali → campi MARC21» limitata alle regole VERIFICATE sulle pagine ufficiali LoC
 * (020, 100, 245, 264, 300, 653, 700; consultate il 15/10/2026). Non applica punteggiatura ISBD, non inverte i nomi
 * e non compila 041, 082, 852 né altri campi la cui regola non è stata verificata.
 * Sincronizzazione ESPLICITA e in un solo verso: l'utente vede un'anteprima e conferma; i campi MARC non generati restano intatti.
 */
export const GENERATED_TAGS = ["020", "100", "245", "264", "300", "653", "700"] as const;

const df = (tag: string, ind1: string, ind2: string, subfields: [string, string][]): MarcDataField => ({
  tag, ind1, ind2, subfields: subfields.filter(([, v]) => v.trim() !== "").map(([code, value]) => ({ code, value: value.trim() })),
});

export interface Generated { fields: MarcDataField[]; notes: string[] }

export function generateFromGeneral(b: BookInput): Generated {
  const notes: string[] = [];
  const fields: MarcDataField[] = [];
  const isbn = b.isbn.replace(/[-\s]/g, "");
  if (isbn) fields.push(df("020", " ", " ", [["a", isbn]]));
  const [first, ...others] = b.authors.map((a) => a.trim()).filter(Boolean);
  const ind1For = (name: string) => {
    if (name.includes(",")) return "1"; // cognome-nome, come nella forma «Rossi, Anna»
    notes.push(`«${name}» non è nella forma «Cognome, Nome»: indicatore 1 impostato a 0 (nome di battesimo) in modo provvisorio. Controllalo.`);
    return "0";
  };
  if (first) fields.push(df("100", ind1For(first), " ", [["a", first]]));
  if (b.title) {
    fields.push(df("245", "0", "0", [["a", b.title]]));
    notes.push("245: indicatori impostati a 0 e 0 (nessun accesso per titolo, nessun carattere di non-archiviazione). Determinali secondo le regole della tua agenzia catalografica.");
  }
  if (b.publisher || b.publicationPlace || b.publicationYear) {
    fields.push(df("264", " ", "1", [["a", b.publicationPlace], ["b", b.publisher], ["c", b.publicationYear]]));
  }
  if (b.physicalDescription) fields.push(df("300", " ", " ", [["a", b.physicalDescription]]));
  for (const s of b.subjects.map((x) => x.trim()).filter(Boolean)) fields.push(df("653", " ", " ", [["a", s]]));
  if (b.subjects.some((s) => s.trim())) notes.push("653: i soggetti sono registrati come termini d'indice NON controllati; non sono intestazioni di soggetto di un thesaurus.");
  for (const a of others) fields.push(df("700", ind1For(a), " ", [["a", a]]));
  return { fields, notes };
}

/** Sostituisce nel record i soli tag generati, mantenendo posizione relativa degli altri campi; i nuovi campi vanno in ordine di tag. */
export function mergeGenerated(existing: MarcField[] | null, gen: MarcDataField[]): MarcField[] {
  const kept = (existing ?? []).filter((f) => !(GENERATED_TAGS as readonly string[]).includes(f.tag));
  const all = [...kept, ...gen];
  // ordinamento stabile per tag: i campi di tag uguale conservano l'ordine relativo
  return all.map((f, i) => ({ f, i })).sort((a, b) => (a.f.tag < b.f.tag ? -1 : a.f.tag > b.f.tag ? 1 : a.i - b.i)).map((x) => x.f);
}

const sub = (f: MarcField | undefined, code: string) => (f && isDataField(f) ? f.subfields.find((s) => s.code === code)?.value : undefined);
const norm = (s: string | undefined) => (s ?? "").replace(/[\s.,:;/]+$/g, "").replace(/\s+/g, " ").trim().toLowerCase();

/** Segnala le incoerenze fra dati generali e record MARC (non modifica nulla). */
export function compareWithGeneral(b: BookInput, marc: MarcField[] | null): string[] {
  if (!marc) return [];
  const out: string[] = [];
  const f245 = marc.find((f) => f.tag === "245");
  if (f245 && b.title && norm(sub(f245, "a")) !== norm(b.title)) out.push(`Il titolo («${b.title}») non coincide con 245 $a («${sub(f245, "a") ?? ""}»).`);
  const isbns = marc.filter((f) => f.tag === "020").map((f) => (sub(f, "a") ?? "").replace(/[-\s]/g, "").split("(")[0]!);
  const gi = b.isbn.replace(/[-\s]/g, "");
  if (gi && isbns.length && !isbns.includes(gi)) out.push(`L'ISBN dei dati generali (${gi}) non compare nei campi 020 del MARC.`);
  const f100 = marc.find((f) => f.tag === "100");
  if (f100 && b.authors[0] && norm(sub(f100, "a")) !== norm(b.authors[0])) out.push(`Il primo autore («${b.authors[0]}») non coincide con 100 $a («${sub(f100, "a") ?? ""}»).`);
  const f264 = marc.find((f) => f.tag === "264");
  if (f264 && b.publisher && norm(sub(f264, "b")) !== norm(b.publisher)) out.push(`L'editore («${b.publisher}») non coincide con 264 $b («${sub(f264, "b") ?? ""}»).`);
  return out;
}
