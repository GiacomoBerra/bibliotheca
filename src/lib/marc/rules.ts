import type { MarcField } from "../api/types";
import { isDataField, type MarcIssue } from "./structure";

/**
 * Regole del formato MARC 21 per un ELENCO LIMITATO di campi, verificate sulle pagine ufficiali della Library of Congress
 * (https://www.loc.gov/marc/bibliographic/bdNNN.html) consultate il 15 ottobre 2026. Per qualsiasi altro campo l'app
 * NON conosce ripetibilità, indicatori e sottocampi ammessi: non li controlla e non li inventa.
 * Superare questi controlli NON significa che la catalogazione sia corretta.
 */
export interface FieldRule {
  label: string;
  url: string;
  repeatable: boolean;
  /** valori ammessi per ciascun indicatore (" " = non definito/«nessuna informazione») */
  ind1: string[];
  ind2: string[];
  /** codici di sottocampo noti → ripetibile? (i codici non elencati non sono giudicati) */
  subfields: Record<string, boolean>;
}
const U = (n: string) => `https://www.loc.gov/marc/bibliographic/bd${n}.html`;

export const RULES: Record<string, FieldRule> = {
  "020": { label: "ISBN", url: U("020"), repeatable: true, ind1: [" "], ind2: [" "], subfields: { a: false, c: false, q: true, z: true } },
  "100": { label: "Intestazione principale – nome di persona", url: U("100"), repeatable: false, ind1: ["0", "1", "3"], ind2: [" "], subfields: { a: false } },
  "245": { label: "Titolo", url: U("245"), repeatable: false, ind1: ["0", "1"], ind2: ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"], subfields: { a: false, b: false, c: false, f: false, g: false, h: false, k: true, n: true, p: true, s: false } },
  "264": { label: "Produzione, pubblicazione, distribuzione", url: U("264"), repeatable: true, ind1: [" ", "2", "3"], ind2: ["0", "1", "2", "3", "4"], subfields: { a: true, b: true, c: true } },
  "300": { label: "Descrizione fisica", url: U("300"), repeatable: true, ind1: [" "], ind2: [" "], subfields: { a: true, b: false, c: true, e: false } },
  "653": { label: "Termine d'indice non controllato", url: U("653"), repeatable: true, ind1: [" ", "0", "1", "2"], ind2: [" ", "0", "1", "2", "3", "4", "5", "6"], subfields: { a: true } },
  "700": { label: "Accesso aggiuntivo – nome di persona", url: U("700"), repeatable: true, ind1: ["0", "1", "3"], ind2: [" ", "2"], subfields: { a: false } },
};

export function checkKnownRules(fields: MarcField[] | null): MarcIssue[] {
  const out: MarcIssue[] = [];
  const list = fields ?? [];
  const seen: Record<string, number> = {};
  list.forEach((f, i) => {
    seen[f.tag] = (seen[f.tag] ?? 0) + 1;
    const rule = RULES[f.tag];
    if (!rule) return;
    const where = `Campo ${i + 1} (${f.tag} ${rule.label})`;
    if (!rule.repeatable && seen[f.tag]! > 1) out.push({ level: "avviso", index: i, message: `${where}: il campo non è ripetibile secondo la documentazione MARC 21 (${rule.url}).` });
    if (!isDataField(f)) return;
    if (!rule.ind1.includes(f.ind1)) out.push({ level: "avviso", index: i, message: `${where}: indicatore 1 «${f.ind1 === " " ? "spazio" : f.ind1}» non previsto (ammessi: ${rule.ind1.map((v) => (v === " " ? "spazio" : v)).join(", ")}).` });
    if (!rule.ind2.includes(f.ind2)) out.push({ level: "avviso", index: i, message: `${where}: indicatore 2 «${f.ind2 === " " ? "spazio" : f.ind2}» non previsto (ammessi: ${rule.ind2.map((v) => (v === " " ? "spazio" : v)).join(", ")}).` });
    const counts: Record<string, number> = {};
    for (const s of f.subfields) {
      counts[s.code] = (counts[s.code] ?? 0) + 1;
      if (rule.subfields[s.code] === false && counts[s.code]! > 1) out.push({ level: "avviso", index: i, message: `${where}: il sottocampo $${s.code} non è ripetibile.` });
    }
  });
  return out;
}
