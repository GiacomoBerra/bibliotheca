import { bareIsbn, toIsbn10, toIsbn13 } from "../../src/lib/sources/isbn";
import type { LookupQuery, SourceRecord } from "../../src/lib/sources/types";
import { getText, type Source, type SourceContext } from "./source";

/**
 * Library of Congress — catalogo bibliografico (LCDB) tramite SRU (Search/Retrieval via URL).
 * NON si usa l'API JSON di loc.gov: la documentazione ufficiale precisa che non include i record del catalogo.
 * Endpoint documentato: http://lx2.loc.gov:210/LCDB (pagina «LC Z39.50/SRW/SRU servers» di loc.gov; query ISBN
 * `bath.ISBN=` come nell'uso pubblico noto). L'endpoint è HTTP (non cifrato) e invia solo i termini di ricerca.
 * STATO: parser testato con una risposta MARCXML simulata; l'endpoint reale va verificato su una Deploy Preview
 * (non raggiungibile dall'ambiente di sviluppo). Gli indici bath.title / bath.author non sono confermati dalla documentazione.
 * I campi MARC sono quelli della fonte, non vengono reinterpretati: la lettura dei sottocampi è meccanica.
 */
export const LOC_BASE = "http://lx2.loc.gov:210/LCDB";
const LIMIT = 10;
const cql = (s: string) => `"${s.replace(/["\\^]/g, " ").replace(/\s+/g, " ").trim()}"`;

export function buildLocUrl(q: LookupQuery): string {
  const parts: string[] = [];
  if (q.isbn) parts.push(`bath.isbn=${bareIsbn(q.isbn)}`);
  else {
    if (q.title) parts.push(`bath.title=${cql(q.title)}`);
    if (q.author) parts.push(`bath.author=${cql(q.author)}`);
    if (parts.length === 0 && q.q) parts.push(cql(q.q));
  }
  const p = new URLSearchParams({ operation: "searchRetrieve", version: "1.1", query: parts.join(" and "), maximumRecords: String(LIMIT) });
  return `${LOC_BASE}?${p.toString()}`;
}

const decode = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, "&");
const clean = (s: string) => decode(s).replace(/\s+/g, " ").replace(/\s*[/:;,.]+\s*$/, "").trim();

interface Df { tag: string; subs: { code: string; value: string }[] }

/** Estrae i campi di un record MARCXML (con o senza prefisso di namespace). */
export function parseMarcXmlRecords(xml: string): { control: Record<string, string>; fields: Df[] }[] {
  const out: { control: Record<string, string>; fields: Df[] }[] = [];
  const recRe = /<(?:\w+:)?record\b[^>]*>([\s\S]*?)<\/(?:\w+:)?record>/g;
  for (let m = recRe.exec(xml); m; m = recRe.exec(xml)) {
    const body = m[1]!;
    const control: Record<string, string> = {};
    for (const c of body.matchAll(/<(?:\w+:)?controlfield\b[^>]*tag="(\d{3})"[^>]*>([\s\S]*?)<\/(?:\w+:)?controlfield>/g)) control[c[1]!] = decode(c[2]!.trim());
    const fields: Df[] = [];
    for (const d of body.matchAll(/<(?:\w+:)?datafield\b[^>]*tag="(\d{3})"[^>]*>([\s\S]*?)<\/(?:\w+:)?datafield>/g)) {
      const subs = [...d[2]!.matchAll(/<(?:\w+:)?subfield\b[^>]*code="(.)"[^>]*>([\s\S]*?)<\/(?:\w+:)?subfield>/g)].map((s) => ({ code: s[1]!, value: s[2]! }));
      fields.push({ tag: d[1]!, subs });
    }
    out.push({ control, fields });
  }
  return out;
}

export function parseLocRecord(r: { control: Record<string, string>; fields: Df[] }): SourceRecord | null {
  const sub = (f: Df | undefined, codes: string) => (f ? f.subs.filter((s) => codes.includes(s.code)).map((s) => clean(s.value)).filter(Boolean) : []);
  const first = (tag: string) => r.fields.find((f) => f.tag === tag);
  const all = (tag: string) => r.fields.filter((f) => f.tag === tag);
  const f245 = first("245");
  const title = sub(f245, "a").join(" ");
  if (!title) return null;
  const subtitle = sub(f245, "b").join(" ");
  const isbns = [...new Set(all("020").flatMap((f) => sub(f, "a")).map((s) => bareIsbn(s.split(" ")[0] ?? "")).filter((s) => /^\d{9}[\dX]$|^\d{13}$/.test(s)))];
  const i13 = isbns.find((i) => i.length === 13) ?? (isbns[0] && toIsbn13(isbns[0]) ) ?? undefined;
  const i10 = isbns.find((i) => i.length === 10) ?? (i13 ? toIsbn10(i13) ?? undefined : undefined);
  const authors = [...sub(first("100"), "a"), ...all("700").flatMap((f) => sub(f, "a"))];
  const pub = first("264") ?? first("260");
  const place = sub(pub, "a").join("; ");
  const publisher = sub(pub, "b").join("; ");
  const date = sub(pub, "c").join(" ");
  const f300 = first("300");
  const pagesMatch = f300 ? /(\d+)\s*(?:p\b|pages?)/i.exec(sub(f300, "a").join(" ")) : null;
  const subjects = [...new Set(all("650").map((f) => sub(f, "avxyz").join(" -- ")).filter(Boolean))].slice(0, 12);
  const lang = (r.control["008"] ?? "").slice(35, 38).trim();
  const id = r.control["001"] ?? `${title}|${isbns[0] ?? ""}`;
  return {
    source: "loc", sourceLabel: "Library of Congress", externalId: id,
    ...(r.control["001"] ? { sourceUrl: `https://lccn.loc.gov/${encodeURIComponent(r.control["001"].trim())}` } : {}),
    granularity: "edizione", title,
    ...(subtitle ? { subtitle } : {}),
    authors, isbns,
    ...(i10 ? { isbn10: i10 } : {}), ...(i13 ? { isbn13: i13 } : {}),
    ...(publisher ? { publisher } : {}), ...(place ? { publicationPlace: place } : {}), ...(date ? { publicationDate: date } : {}),
    ...(lang && lang !== "|||" ? { language: lang } : {}),
    ...(pagesMatch ? { pages: Number(pagesMatch[1]) } : {}),
    subjects,
  };
}

export const loc: Source = {
  id: "loc",
  label: "Library of Congress",
  async search(q: LookupQuery, ctx: SourceContext): Promise<SourceRecord[]> {
    const xml = await getText(buildLocUrl(q), ctx);
    return parseMarcXmlRecords(xml).map(parseLocRecord).filter((x): x is SourceRecord => x !== null).slice(0, LIMIT);
  },
};
