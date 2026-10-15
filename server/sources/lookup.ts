import { bareIsbn } from "../../src/lib/sources/isbn";
import { checkIsbn } from "../../src/lib/api/isbn";
import type { LookupQuery, LookupResponse, SourceRecord, SourceReport } from "../../src/lib/sources/types";
import { classify, groupRecords, rankGroups } from "./match";
import { googleBooks } from "./googlebooks";
import { openLibrary } from "./openlibrary";
import { SourceError, type Source } from "./source";

export class LookupError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly retryAfter?: number) {
    super(message);
    this.name = "LookupError";
  }
}

const MAX = 200;
/** Valida e normalizza i parametri della ricerca (arrivano dal browser: non fidati). */
export function parseLookupQuery(params: URLSearchParams): LookupQuery {
  const get = (k: string) => (params.get(k) ?? "").replace(/\s+/g, " ").trim().slice(0, MAX);
  const q: LookupQuery = {};
  const isbn = get("isbn");
  if (isbn) {
    const c = checkIsbn(isbn);
    if (c === "formato") throw new LookupError(400, "validation", "L'ISBN deve avere 10 o 13 cifre (la cifra finale del vecchio ISBN-10 può essere X).");
    if (c === "controllo") throw new LookupError(400, "validation", "La cifra di controllo dell'ISBN non torna: controlla di averlo dettato o scritto correttamente.");
    q.isbn = bareIsbn(isbn);
  }
  for (const k of ["title", "author", "publisher", "q"] as const) { const v = get(k); if (v) q[k] = v; }
  const year = get("year");
  if (year) { if (!/^\d{4}$/.test(year)) throw new LookupError(400, "validation", "L'anno deve avere 4 cifre."); q.year = year; }
  if (!q.isbn && !q.title && !q.q) throw new LookupError(400, "validation", "Indica almeno un ISBN, un titolo o un testo da cercare.");
  if ((q.title ?? q.q ?? "").length > 0 && (q.title ?? q.q ?? "").length < 2 && !q.isbn) throw new LookupError(400, "validation", "Il testo da cercare è troppo corto.");
  return q;
}

export interface LookupOptions {
  fetch: typeof fetch;
  env?(key: string): string | undefined;
  sources?: Source[];
  now?(): number;
  sleep?(ms: number): Promise<void>;
  timeoutMs?: number;
  cacheTtlMs?: number;
  /** Intervallo minimo tra due richieste alla stessa fonte da questa istanza (rispetto dei limiti di Open Library). */
  minIntervalMs?: number;
  limits?: { perMinute: number; perDay: number };
}

/**
 * Orchestratore: interroga le fonti in parallelo, ciascuna con timeout e isolamento degli errori,
 * unisce le edizioni identiche, classifica e ordina. Non scrive nulla nel catalogo.
 * Cache e limiti sono in memoria dell'istanza della Function (best effort): su Netlify ogni istanza ha la sua.
 */
export function createLookup(opts: LookupOptions) {
  const sources = opts.sources ?? [openLibrary, googleBooks];
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const timeoutMs = opts.timeoutMs ?? 6000;
  const ttl = opts.cacheTtlMs ?? 24 * 3600_000;
  const minInterval = opts.minIntervalMs ?? 400;
  const limits = opts.limits ?? { perMinute: 10, perDay: 150 };
  const env = opts.env ?? (() => undefined);
  const userAgent = `Bibliotheca/0.1 (catalogo bibliografico personale${env("LOOKUP_CONTACT") ? `; contatto: ${env("LOOKUP_CONTACT")}` : ""})`;

  const cache = new Map<string, { at: number; records: SourceRecord[] }>();
  const hits = new Map<string, number[]>();
  const last = new Map<string, number>();
  const chain = new Map<string, Promise<void>>();

  function checkLimit(user: string) {
    const t = now();
    const list = (hits.get(user) ?? []).filter((x) => t - x < 86_400_000);
    const minute = list.filter((x) => t - x < 60_000).length;
    if (minute >= limits.perMinute) throw new LookupError(429, "rate_limited", "Troppe ricerche in poco tempo. Attendi un minuto e riprova.", 60);
    if (list.length >= limits.perDay) throw new LookupError(429, "rate_limited", "Hai raggiunto il limite giornaliero di ricerche. Riprova domani.", 3600);
    list.push(t);
    hits.set(user, list);
  }

  /** Serializza le richieste verso la stessa fonte con un intervallo minimo. */
  function paced<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = chain.get(id) ?? Promise.resolve();
    const run = prev.then(async () => {
      const wait = (last.get(id) ?? 0) + minInterval - now();
      if (wait > 0) await sleep(wait);
      last.set(id, now());
    });
    chain.set(id, run.catch(() => undefined));
    return run.then(fn);
  }

  async function runSource(s: Source, q: LookupQuery, key: string, refresh: boolean): Promise<{ report: SourceReport; records: SourceRecord[] }> {
    const ck = `${s.id}|${key}`;
    const hit = cache.get(ck);
    if (!refresh && hit && now() - hit.at < ttl) return { report: { id: s.id, label: s.label, status: "ok", count: hit.records.length, cached: true }, records: hit.records };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const records = await paced(s.id, () => s.search(q, { fetch: opts.fetch, signal: ctrl.signal, userAgent, env }));
      cache.set(ck, { at: now(), records });
      if (cache.size > MAX) cache.delete(cache.keys().next().value as string);
      return { report: { id: s.id, label: s.label, status: "ok", count: records.length }, records };
    } catch (e) {
      if ((e as Error).name === "AbortError") return { report: { id: s.id, label: s.label, status: "timeout", count: 0, message: "La fonte non ha risposto in tempo." }, records: [] };
      if (e instanceof SourceError) return { report: { id: s.id, label: s.label, status: e.kind, count: 0, message: e.message }, records: [] };
      return { report: { id: s.id, label: s.label, status: "errore", count: 0, message: "Errore imprevisto nella fonte." }, records: [] };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async run(q: LookupQuery, userId: string, o: { refresh?: boolean } = {}): Promise<LookupResponse> {
      checkLimit(userId);
      const key = JSON.stringify([q.isbn ?? "", q.title ?? "", q.author ?? "", q.publisher ?? "", q.q ?? ""].map((x) => x.toLowerCase()));
      const results = await Promise.all(sources.map((s) => runSource(s, q, key, Boolean(o.refresh))));
      const records = results.flatMap((r) => r.records);
      const groups = rankGroups(groupRecords(records).map((g, i) => classify(g, q, `g${i + 1}`))).slice(0, 20);
      return { groups, sources: results.map((r) => r.report), cached: results.every((r) => r.report.cached === true) };
    },
  };
}
export type Lookup = ReturnType<typeof createLookup>;
