import { bareIsbn, toIsbn13 } from "../../src/lib/sources/isbn";
import type { LookupQuery, MatchKind, ResultGroup, SourceRecord } from "../../src/lib/sources/types";

const ARTICLES = new Set(["il", "lo", "la", "i", "gli", "le", "l", "un", "uno", "una", "the", "a", "an", "der", "die", "das", "ein", "eine", "les", "des", "el", "los", "las"]);

/** Minuscole, senza accenti né punteggiatura, spazi singoli. */
export function norm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
/** Come `norm` ma senza articolo iniziale (per confrontare i titoli). */
export function normTitle(s: string): string {
  const t = norm(s).split(" ").filter(Boolean);
  if (t.length > 1 && ARTICLES.has(t[0]!)) t.shift();
  return t.join(" ");
}
/** Cognome: «Eco, Umberto» → eco; «Umberto Eco» → eco. */
export function surname(name: string): string {
  const comma = name.indexOf(",");
  const base = comma > 0 ? name.slice(0, comma) : name.trim().split(/\s+/).slice(-1)[0] ?? "";
  return norm(base);
}
export const yearOf = (d?: string): string | undefined => d?.match(/\b(1[0-9]{3}|20[0-9]{2})\b/)?.[1];

function isbn13s(r: SourceRecord): Set<string> {
  const out = new Set<string>();
  for (const x of [r.isbn13, r.isbn10, ...(r.isbns ?? [])]) {
    const v = x ? toIsbn13(x) : null;
    if (v) out.add(v);
  }
  return out;
}

/**
 * Due record descrivono la STESSA edizione se condividono un ISBN-13 oppure se coincidono titolo, primo autore,
 * anno (presente in entrambi) ed editore (se presente in entrambi) e nessuno dei due ha un ISBN in conflitto.
 * I record a livello di opera non si fondono mai con le edizioni, e due edizioni con ISBN diversi restano separate:
 * edizioni e traduzioni diverse non vengono mai unite automaticamente.
 */
export function sameEdition(a: SourceRecord, b: SourceRecord): boolean {
  if (a.granularity !== b.granularity) return false;
  const ia = isbn13s(a), ib = isbn13s(b);
  if (a.granularity === "edizione" && [...ia].some((x) => ib.has(x))) return true;
  if (a.granularity === "opera") return a.source === b.source && a.externalId === b.externalId;
  if (ia.size > 0 && ib.size > 0) return false;
  if (normTitle(a.title) !== normTitle(b.title)) return false;
  if (!a.authors[0] || !b.authors[0] || surname(a.authors[0]) !== surname(b.authors[0])) return false;
  const ya = yearOf(a.publicationDate), yb = yearOf(b.publicationDate);
  if (!ya || !yb || ya !== yb) return false;
  if (a.publisher && b.publisher && norm(a.publisher) !== norm(b.publisher)) return false;
  return true;
}

export function groupRecords(records: SourceRecord[]): SourceRecord[][] {
  const parent = records.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (let i = 0; i < records.length; i++) for (let j = i + 1; j < records.length; j++) if (sameEdition(records[i]!, records[j]!)) parent[find(j)] = find(i);
  const groups = new Map<number, SourceRecord[]>();
  records.forEach((r, i) => { const k = find(i); groups.set(k, [...(groups.get(k) ?? []), r]); });
  return [...groups.values()];
}

function titleRelation(query: string, title: string): "uguale" | "parziale" | "nessuna" {
  const q = normTitle(query), t = normTitle(title);
  if (!q || !t) return "nessuna";
  if (q === t) return "uguale";
  const qt = q.split(" "), tt = new Set(t.split(" "));
  if (t.includes(q) || q.includes(t) || qt.every((w) => tt.has(w))) return "parziale";
  return "nessuna";
}

export function classify(records: SourceRecord[], q: LookupQuery, id: string): ResultGroup {
  const all = new Set(records.flatMap((r) => [...isbn13s(r)]));
  const authors = [...new Set(records.flatMap((r) => r.authors))];
  const years = new Set(records.map((r) => yearOf(r.publicationDate)).filter(Boolean) as string[]);
  const publishers = records.map((r) => r.publisher).filter(Boolean).map((p) => norm(p!));
  const titles = records.flatMap((r) => [r.title, r.subtitle ? `${r.title} ${r.subtitle}` : r.title]);

  let match: MatchKind;
  let reason: string;
  const qIsbn = q.isbn ? toIsbn13(q.isbn) : null;
  const opera = records.every((r) => r.granularity === "opera");
  if (qIsbn && all.has(qIsbn) && !opera) {
    match = "esatta"; reason = "ISBN identico a quello cercato.";
  } else {
    const checks: string[] = [], fails: string[] = [];
    let rel: "uguale" | "parziale" | "nessuna" = "nessuna";
    if (q.title) {
      for (const t of titles) { const r = titleRelation(q.title, t); if (r === "uguale" || (r === "parziale" && rel === "nessuna")) rel = r; }
      if (rel === "uguale") checks.push("titolo"); else fails.push(rel === "parziale" ? "titolo solo in parte" : "titolo");
    } else if (q.q) {
      const words = norm(q.q).split(" ").filter((w) => w.length > 2);
      const hay = new Set(norm([...titles, ...authors].join(" ")).split(" "));
      const hit = words.length > 0 && words.every((w) => hay.has(w));
      if (hit) { rel = "parziale"; fails.push("testo libero (nessun titolo distinto: corrispondenza non verificabile)"); } else fails.push("testo libero");
    }
    if (q.author) (authors.some((a) => surname(a) === surname(q.author!)) ? checks : fails).push("autore");
    if (q.year) (years.has(q.year) ? checks : fails).push("anno");
    if (q.publisher) (publishers.some((p) => p === norm(q.publisher!) || p.includes(norm(q.publisher!))) ? checks : fails).push("editore");
    if (rel === "uguale" && fails.length === 0) { match = "probabile"; reason = `Coincidono: ${checks.join(", ")}.`; }
    else { match = "simile"; reason = `${checks.length ? `Coincidono: ${checks.join(", ")}. ` : ""}Non coincidono o mancano: ${fails.join(", ") || "titolo"}.`; }
    if (opera) reason += " Risultato a livello di opera: l'edizione non è identificata.";
  }
  const have = { autori: authors.length > 0, editore: publishers.length > 0, anno: years.size > 0, ISBN: all.size > 0 };
  const missing = Object.entries(have).filter(([, ok]) => !ok).map(([k]) => k);
  return { id, match, reason, incomplete: missing.length > 1 || records.every((r) => !r.title), missing, records };
}

const RANK: Record<MatchKind, number> = { esatta: 0, probabile: 1, simile: 2 };
export function rankGroups(groups: ResultGroup[]): ResultGroup[] {
  return [...groups].sort((a, b) => RANK[a.match] - RANK[b.match] || b.records.length - a.records.length || a.missing.length - b.missing.length);
}
