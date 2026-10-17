import type { MarcDataField, MarcField } from "../api/types";

/**
 * Validità STRUTTURALE di un record MARC21 (non correttezza catalografica).
 * Condivisa da browser e server: il server la applica comunque a ogni scrittura.
 * Regole generali (formato MARC 21 bibliografico): tag di 3 caratteri; i tag 001–009 sono campi di controllo (solo valore);
 * i tag 010–999 sono campi dati con 2 indicatori di un carattere e sottocampi con codice di un carattere.
 */
export const MAX_MARC_FIELDS = 2000;
export const MAX_SUBFIELDS = 200;
export const MAX_VALUE_LEN = 10_000;
export const LEADER_LENGTH = 24;

export const isControlTag = (tag: string) => /^00[1-9]$/.test(tag);
export const isDataField = (f: MarcField): f is MarcDataField => "subfields" in f;

export interface MarcIssue {
  level: "errore" | "avviso";
  /** posizione 0-based del campo nel record, se riferibile */
  index?: number;
  message: string;
}

const CTRL = /[\u0000-\u001f\u007f]/;

/** Controlli strutturali. `errore` = il record non è strutturalmente valido e non va salvato; `avviso` = da verificare. */
export function checkStructure(leader: string | null, fields: MarcField[] | null): MarcIssue[] {
  const out: MarcIssue[] = [];
  if (leader !== null && leader !== undefined && leader !== "") {
    if (leader.length !== LEADER_LENGTH) out.push({ level: "errore", message: `L'intestazione (leader) deve avere esattamente ${LEADER_LENGTH} caratteri (ne ha ${leader.length}).` });
    if (CTRL.test(leader)) out.push({ level: "errore", message: "L'intestazione contiene caratteri di controllo non ammessi." });
  }
  const list = fields ?? [];
  if (list.length > MAX_MARC_FIELDS) out.push({ level: "errore", message: `Troppi campi (massimo ${MAX_MARC_FIELDS}).` });
  list.forEach((f, i) => {
    const where = `Campo ${i + 1}${f.tag ? ` (${f.tag})` : ""}`;
    if (!/^[0-9A-Za-z]{3}$/.test(f.tag)) { out.push({ level: "errore", index: i, message: `${where}: il tag deve avere 3 caratteri alfanumerici.` }); return; }
    if (isDataField(f)) {
      if (isControlTag(f.tag)) out.push({ level: "errore", index: i, message: `${where}: i tag 001–009 sono campi di controllo e non hanno indicatori né sottocampi.` });
      for (const [n, v] of [[1, f.ind1], [2, f.ind2]] as const) {
        if (v.length !== 1) out.push({ level: "errore", index: i, message: `${where}: l'indicatore ${n} deve essere un solo carattere (usa lo spazio per «non definito»).` });
        else if (!/^[0-9a-z ]$/.test(v)) out.push({ level: "errore", index: i, message: `${where}: l'indicatore ${n} può essere una cifra, una lettera minuscola o uno spazio.` });
      }
      if (f.subfields.length === 0) out.push({ level: "errore", index: i, message: `${where}: serve almeno un sottocampo.` });
      if (f.subfields.length > MAX_SUBFIELDS) out.push({ level: "errore", index: i, message: `${where}: troppi sottocampi (massimo ${MAX_SUBFIELDS}).` });
      f.subfields.forEach((s, j) => {
        if (!/^[0-9a-z]$/.test(s.code)) out.push({ level: "errore", index: i, message: `${where}, sottocampo ${j + 1}: il codice deve essere una cifra o una lettera minuscola.` });
        if (s.value.trim() === "") out.push({ level: "avviso", index: i, message: `${where}, sottocampo ${j + 1} ($${s.code}): valore vuoto.` });
        if (s.value.length > MAX_VALUE_LEN || CTRL.test(s.value)) out.push({ level: "errore", index: i, message: `${where}, sottocampo ${j + 1}: valore troppo lungo o con caratteri di controllo.` });
      });
    } else {
      if (!isControlTag(f.tag)) out.push({ level: "errore", index: i, message: `${where}: un campo con solo valore deve avere tag da 001 a 009 (i campi dati hanno indicatori e sottocampi).` });
      if (f.value.length > MAX_VALUE_LEN || CTRL.test(f.value)) out.push({ level: "errore", index: i, message: `${where}: valore troppo lungo o con caratteri di controllo.` });
      if (f.value.trim() === "") out.push({ level: "avviso", index: i, message: `${where}: valore vuoto.` });
    }
  });
  return out;
}

export const hasErrors = (issues: MarcIssue[]) => issues.some((i) => i.level === "errore");

/** Visualizzazione testuale leggibile, una riga per campo (stile «MARC mnemonico»: =245  10$aTitolo$bResto). NON è ISO 2709. */
export function toReadableText(leader: string | null, fields: MarcField[] | null): string {
  const lines: string[] = [];
  if (leader) lines.push(`=LDR  ${leader}`);
  for (const f of fields ?? []) {
    if (isDataField(f)) lines.push(`=${f.tag}  ${f.ind1 === " " ? "\\" : f.ind1}${f.ind2 === " " ? "\\" : f.ind2}${f.subfields.map((s) => `$${s.code}${s.value}`).join("")}`);
    else lines.push(`=${f.tag}  ${f.value.replace(/ /g, "\\")}`);
  }
  return lines.join("\n");
}
