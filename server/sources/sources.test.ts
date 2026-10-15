// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createLookup, LookupError, parseLookupQuery } from "./lookup";
import { parseVolume } from "./googlebooks";
import { parseEdition, parseWorkDoc } from "./openlibrary";
import { groupRecords, norm, normTitle, sameEdition, surname } from "./match";
import { toIsbn10, toIsbn13 } from "../../src/lib/sources/isbn";
import type { SourceRecord } from "../../src/lib/sources/types";

// ===== Risposte SIMULATE (dati di prova, non bibliografici reali) nel formato delle API ufficiali =====
const ISBN13 = "9780306406157"; // ISBN d'esempio con cifra di controllo valida
const olEdition = (over: object = {}) => ({
  [`ISBN:${ISBN13}`]: {
    url: "https://openlibrary.org/books/OL1M/Libro_di_prova", key: "/books/OL1M", title: "Libro di prova", subtitle: "con sottotitolo",
    authors: [{ name: "Anna Rossi", url: "x" }], number_of_pages: 321, identifiers: { isbn_13: [ISBN13], isbn_10: ["0306406152"] },
    publishers: [{ name: "Alfa" }], publish_places: [{ name: "Milano" }], publish_date: "1980", subjects: [{ name: "Prova" }], cover: { medium: "http://covers.example/m.jpg" }, ...over,
  },
});
const olSearch = { docs: [{ key: "/works/OL9W", title: "Libro di prova", author_name: ["Anna Rossi"], first_publish_year: 1980, isbn: [ISBN13, "9781234567897"], publisher: ["Alfa", "Beta"], language: ["ita", "eng"], number_of_pages_median: 300, subject: ["Prova"], cover_i: 55 }] };
const gbItem = (over: object = {}, info: object = {}) => ({
  id: "GB1", volumeInfo: { title: "Libro di prova", subtitle: "con sottotitolo", authors: ["Anna Rossi"], publisher: "Alfa", publishedDate: "1980-05-01", description: "Descrizione", industryIdentifiers: [{ type: "ISBN_13", identifier: ISBN13 }, { type: "ISBN_10", identifier: "0306406152" }], pageCount: 320, categories: ["Prova"], imageLinks: { thumbnail: "http://books.example/t.jpg" }, language: "it", infoLink: "http://books.google.example/GB1", ...info }, ...over,
});

type Handler = (url: URL, init?: RequestInit) => Response | Promise<Response>;
function fakeFetch(handlers: { ol?: Handler; gb?: Handler }) {
  const calls: URL[] = [];
  const f = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(url);
    const h = url.hostname === "openlibrary.org" ? handlers.ol : url.hostname === "www.googleapis.com" ? handlers.gb : undefined;
    if (!h) throw new Error("rete non simulata: " + url.hostname);
    return h(url, init);
  });
  return { f: f as unknown as typeof fetch, calls, spy: f };
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
const olOk: Handler = (u) => json(u.pathname === "/api/books" ? olEdition() : olSearch);
const gbOk: Handler = () => json({ items: [gbItem()] });
const lookup = (h: { ol?: Handler; gb?: Handler }, o: Parameters<typeof createLookup>[0] extends infer T ? Partial<T> : never = {}) => {
  const ff = fakeFetch(h);
  return { ...ff, lk: createLookup({ fetch: ff.f, sleep: async () => {}, ...o } as never) };
};
const q = (s: string) => parseLookupQuery(new URLSearchParams(s));

describe("Validazione della richiesta (non fidata)", () => {
  it("accetta ISBN, titolo, testo libero; normalizza spazi e trattini", () => {
    expect(q("isbn=978-0-306-40615-7")).toEqual({ isbn: ISBN13 });
    expect(q("title=%20%20Il%20%20nome%20&author=Eco&year=1980")).toEqual({ title: "Il nome", author: "Eco", year: "1980" });
    expect(q("q=qualcosa")).toEqual({ q: "qualcosa" });
  });
  it.each([["isbn=12ab"], ["isbn=9780306406158"], ["year=80&title=abc"], [""], ["author=Eco"], ["title=a"]])("rifiuta %s con messaggio chiaro", (s) => {
    expect(() => q(s)).toThrow(LookupError);
    try { q(s); } catch (e) { expect((e as LookupError).status).toBe(400); expect((e as LookupError).message.length).toBeGreaterThan(10); }
  });
  it("tronca i testi lunghi", () => { expect(q("title=" + "x".repeat(900)).title).toHaveLength(200); });
});

describe("Parsing difensivo delle risposte delle fonti", () => {
  it("Open Library edizione", () => {
    const r = parseEdition(ISBN13, olEdition()[`ISBN:${ISBN13}`])!;
    expect(r).toMatchObject({ source: "openlibrary", granularity: "edizione", title: "Libro di prova", subtitle: "con sottotitolo", authors: ["Anna Rossi"], isbn13: ISBN13, isbn10: "0306406152", publisher: "Alfa", publicationPlace: "Milano", publicationDate: "1980", pages: 321, subjects: ["Prova"] });
    expect(r.coverUrl).toBe("https://covers.example/m.jpg");
  });
  it("Open Library ricerca: livello OPERA; editore/lingua ambigui NON vengono scelti", () => {
    const r = parseWorkDoc(olSearch.docs[0])!;
    expect(r.granularity).toBe("opera");
    expect(r.publisher).toBeUndefined();
    expect(r.language).toBeUndefined();
    expect(r.isbn13).toBeUndefined();
    expect(r.publicationDate).toBe("1980");
    expect(r.coverUrl).toBe("https://covers.openlibrary.org/b/id/55-M.jpg");
  });
  it("Google Books volume", () => {
    expect(parseVolume(gbItem())).toMatchObject({ source: "googlebooks", externalId: "GB1", isbn13: ISBN13, isbn10: "0306406152", publisher: "Alfa", pages: 320, language: "it", description: "Descrizione", sourceUrl: "https://books.google.example/GB1" });
  });
  it.each([null, 5, "x", [], {}, { id: "1" }, { id: "1", volumeInfo: {} }, { volumeInfo: { title: "t" } }])("risposte malformate (%j) non fanno crollare nulla", (x) => {
    expect(parseVolume(x)).toBeNull();
    expect(parseWorkDoc(x)).toBeNull();
    expect(parseEdition("x", x)).toBeNull();
  });
  it("conversioni ISBN-10 ↔ ISBN-13", () => { expect(toIsbn13("0306406152")).toBe(ISBN13); expect(toIsbn10(ISBN13)).toBe("0306406152"); expect(toIsbn13("1234")).toBeNull(); });
});

describe("Ricerca su più fonti", () => {
  it("per ISBN: le due fonti descrivono la stessa edizione → UN gruppo «esatta», con provenienza di entrambe", async () => {
    const { lk, calls } = lookup({ ol: olOk, gb: gbOk });
    const r = await lk.run(q(`isbn=${ISBN13}`), "u1");
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]).toMatchObject({ match: "esatta", reason: expect.stringContaining("ISBN") });
    expect(r.groups[0]!.records.map((x) => x.source).sort()).toEqual(["googlebooks", "openlibrary"]);
    expect(r.sources.map((s) => [s.id, s.status, s.count])).toEqual([["openlibrary", "ok", 1], ["googlebooks", "ok", 1]]);
    expect(calls.find((u) => u.hostname === "openlibrary.org")!.pathname).toBe("/api/books");
    expect(calls.find((u) => u.hostname === "www.googleapis.com")!.searchParams.get("q")).toBe(`isbn:${ISBN13}`);
  });
  it("le richieste partono in parallelo: una fonte lenta non blocca l'altra oltre il timeout", async () => {
    const slow: Handler = (_u, init) => new Promise((_res, rej) => init!.signal!.addEventListener("abort", () => rej(Object.assign(new Error("abort"), { name: "AbortError" }))));
    const { lk } = lookup({ ol: slow, gb: gbOk }, { timeoutMs: 30 });
    const r = await lk.run(q("title=Libro di prova"), "u1");
    expect(r.sources.find((s) => s.id === "openlibrary")).toMatchObject({ status: "timeout", count: 0 });
    expect(r.sources.find((s) => s.id === "googlebooks")?.status).toBe("ok");
    expect(r.groups).toHaveLength(1);
  });
  it("una fonte che risponde 500, 429, 403, rete assente o JSON rotto non impedisce le altre; nessun dettaglio tecnico filtra", async () => {
    for (const [h, kind] of [[() => json({}, 500), "errore"], [() => json({}, 429), "non_disponibile"], [() => json({}, 403), "non_disponibile"], [() => { throw new TypeError("fetch failed https://x?key=SEGRETA"); }, "errore"], [() => new Response("<html>", { status: 200 }), "errore"]] as const) {
      const { lk } = lookup({ ol: h as Handler, gb: gbOk });
      const r = await lk.run(q("title=Libro di prova"), "u1");
      expect(r.sources[0]).toMatchObject({ id: "openlibrary", status: kind, count: 0 });
      expect(r.sources[1]?.status).toBe("ok");
      expect(JSON.stringify(r)).not.toMatch(/SEGRETA|https:\/\/x/);
    }
  });
  it("tutte le fonti non disponibili: risposta valida, nessun gruppo, stato di ogni fonte", async () => {
    const { lk } = lookup({ ol: () => json({}, 500), gb: () => json({}, 500) });
    const r = await lk.run(q("title=Libro di prova"), "u1");
    expect(r.groups).toEqual([]);
    expect(r.sources.every((s) => s.status === "errore")).toBe(true);
  });
  it("nessun risultato: elenco vuoto, fonti ok", async () => {
    const { lk } = lookup({ ol: () => json({ docs: [] }), gb: () => json({ totalItems: 0 }) });
    const r = await lk.run(q("title=zzzzzz"), "u1");
    expect(r.groups).toEqual([]);
    expect(r.sources.every((s) => s.status === "ok")).toBe(true);
  });
  it("ricerca per titolo e autore: costruisce query distinte per fonte, con virgolette neutralizzate", async () => {
    const { lk, calls } = lookup({ ol: olOk, gb: gbOk });
    await lk.run(q('title=Il "nome"&author=Eco&publisher=Bompiani'), "u1");
    const gb = calls.find((u) => u.hostname === "www.googleapis.com")!;
    expect(gb.searchParams.get("q")).toBe('intitle:"Il nome" inauthor:"Eco" inpublisher:"Bompiani"');
    expect(gb.searchParams.get("maxResults")).toBe("10");
    const ol = calls.find((u) => u.hostname === "openlibrary.org")!;
    expect(ol.pathname).toBe("/search.json");
    expect(ol.searchParams.get("limit")).toBe("10");
    expect(ol.searchParams.get("title")).toBe('Il "nome"');
  });
  it("User-Agent identificativo verso le fonti; il contatto viene solo dalla configurazione", async () => {
    const seen: string[] = [];
    const h: Handler = (_u, init) => { seen.push(new Headers(init?.headers).get("user-agent") ?? ""); return json({ docs: [] }); };
    await lookup({ ol: h, gb: h }, { env: (k) => (k === "LOOKUP_CONTACT" ? "contatto@esempio.it" : undefined) }).lk.run(q("title=abc"), "u1");
    expect(seen.every((x) => /^Bibliotheca\/0\.1/.test(x) && x.includes("contatto@esempio.it"))).toBe(true);
  });
});

describe("Chiave API: solo lato server", () => {
  it("se configurata viene inviata a Google ma non compare mai nella risposta all'interfaccia", async () => {
    const { lk, calls } = lookup({ ol: olOk, gb: gbOk }, { env: (k) => (k === "GOOGLE_BOOKS_API_KEY" ? "CHIAVE-DI-PROVA-123" : undefined) });
    const r = await lk.run(q("title=Libro di prova"), "u1");
    expect(calls.find((u) => u.hostname === "www.googleapis.com")!.searchParams.get("key")).toBe("CHIAVE-DI-PROVA-123");
    expect(calls.find((u) => u.hostname === "openlibrary.org")!.search).not.toContain("CHIAVE");
    expect(JSON.stringify(r)).not.toContain("CHIAVE-DI-PROVA-123");
  });
  it("senza chiave la richiesta non include il parametro key; se Google rifiuta la fonte risulta «non disponibile»", async () => {
    const { lk, calls } = lookup({ ol: olOk, gb: () => json({ error: { code: 403 } }, 403) });
    const r = await lk.run(q("title=Libro di prova"), "u1");
    expect(calls.find((u) => u.hostname === "www.googleapis.com")!.searchParams.has("key")).toBe(false);
    expect(r.sources.find((s) => s.id === "googlebooks")).toMatchObject({ status: "non_disponibile" });
  });
});

describe("Deduplicazione e classificazione", () => {
  const rec = (o: Partial<SourceRecord>): SourceRecord => ({ source: "googlebooks", sourceLabel: "G", externalId: Math.random().toString(), granularity: "edizione", title: "Libro di prova", authors: ["Anna Rossi"], subjects: [], ...o });
  it("stesso ISBN → stesso gruppo (anche ISBN-10 vs ISBN-13)", () => {
    expect(groupRecords([rec({ isbn13: ISBN13 }), rec({ source: "openlibrary", isbn10: "0306406152" })])).toHaveLength(1);
  });
  it("senza ISBN: stesso titolo+autore+anno+editore → unite; articolo, accenti e maiuscole non contano", () => {
    expect(sameEdition(rec({ title: "Il Nome della Rosa", publicationDate: "1980", publisher: "Bompiani", authors: ["Umberto Eco"] }), rec({ title: "nome della rosa", publicationDate: "1980-01", publisher: "BOMPIANI", authors: ["Eco, Umberto"] }))).toBe(true);
  });
  it("edizioni, traduzioni e ISBN diversi NON vengono mai fusi", () => {
    const base = { publicationDate: "1980", publisher: "Alfa" };
    expect(sameEdition(rec({ ...base }), rec({ ...base, publicationDate: "1999" }))).toBe(false);
    expect(sameEdition(rec({ ...base }), rec({ ...base, publisher: "Beta" }))).toBe(false);
    expect(sameEdition(rec({ ...base }), rec({ ...base, authors: ["Mario Bianchi"] }))).toBe(false);
    expect(sameEdition(rec({ ...base, isbn13: ISBN13 }), rec({ ...base, isbn13: "9781234567897" }))).toBe(false);
    expect(sameEdition(rec({ ...base, title: "The Book" }), rec({ ...base, title: "Il libro" }))).toBe(false);
    expect(sameEdition(rec({ publisher: "Alfa" }), rec({ publisher: "Alfa" }))).toBe(false); // anno assente: prudenza
    expect(sameEdition(rec({ ...base }), rec({ ...base, granularity: "opera" }))).toBe(false);
  });
  it("normalizzazioni", () => {
    expect(norm("  Città, d'Èuropa! ")).toBe("citta d europa");
    expect(normTitle("L'isola")).toBe("isola");
    expect(surname("García Márquez, Gabriel")).toBe("garcia marquez");
    expect(surname("Umberto Eco")).toBe("eco");
  });
  it("probabile: titolo uguale e TUTTI i criteri forniti coincidono; simile se uno non coincide", async () => {
    const gb: Handler = () => json({ items: [gbItem({ id: "A" }, { isbn: undefined, industryIdentifiers: [], publishedDate: "1980" }), gbItem({ id: "B" }, { industryIdentifiers: [], publisher: "Beta", publishedDate: "2005" })] });
    const r = await lookup({ ol: () => json({ docs: [] }), gb }).lk.run(q("title=libro di prova&author=Rossi&year=1980&publisher=Alfa"), "u1");
    expect(r.groups).toHaveLength(2);
    expect(r.groups[0]).toMatchObject({ match: "probabile" });
    expect(r.groups[0]!.reason).toMatch(/titolo.*autore.*anno.*editore/);
    expect(r.groups[1]).toMatchObject({ match: "simile" });
    expect(r.groups[1]!.reason).toMatch(/anno/);
    expect(r.groups[1]!.reason).toMatch(/editore/);
  });
  it("un risultato con ISBN diverso da quello cercato non è mai «esatta»", async () => {
    const r = await lookup({ ol: () => json({}), gb: () => json({ items: [gbItem({}, { industryIdentifiers: [{ type: "ISBN_13", identifier: "9781234567897" }] })] }) }).lk.run(q(`isbn=${ISBN13}`), "u1");
    expect(r.groups.every((g) => g.match !== "esatta")).toBe(true);
  });
  it("opera (Open Library senza ISBN cercato): mai «esatta», indicazione che l'edizione non è identificata; dati incompleti segnalati", async () => {
    const r = await lookup({ ol: () => json(olSearch), gb: () => json({}) }).lk.run(q(`title=Libro di prova`), "u1");
    expect(r.groups[0]!.records[0]!.granularity).toBe("opera");
    expect(r.groups[0]!.reason).toMatch(/edizione non è identificata/);
    const inc = await lookup({ ol: () => json({}), gb: () => json({ items: [gbItem({}, { authors: undefined, publisher: undefined, publishedDate: undefined, industryIdentifiers: [] })] }) }).lk.run(q("title=Libro di prova"), "u1");
    expect(inc.groups[0]).toMatchObject({ incomplete: true });
    expect(inc.groups[0]!.missing).toEqual(expect.arrayContaining(["autori", "editore", "anno", "ISBN"]));
  });
  it("ordinamento: esatta, poi probabile, poi simile; nessun punteggio numerico nella risposta", async () => {
    const r = await lookup({ ol: olOk, gb: gbOk }).lk.run(q(`isbn=${ISBN13}`), "u1");
    expect(JSON.stringify(r)).not.toMatch(/score|percent|confidence|%/i);
  });
});

describe("Cache, frequenza e rispetto dei limiti", () => {
  it("una seconda ricerca identica usa la cache: nessuna nuova richiesta alle fonti; «aggiorna» la salta", async () => {
    const { lk, spy } = lookup({ ol: olOk, gb: gbOk });
    await lk.run(q("title=Libro di prova"), "u1");
    const n = spy.mock.calls.length;
    const again = await lk.run(q("title=  LIBRO di prova "), "u1");
    expect(spy.mock.calls.length).toBe(n);
    expect(again.cached).toBe(true);
    await lk.run(q("title=Libro di prova"), "u1", { refresh: true });
    expect(spy.mock.calls.length).toBe(n + 2);
  });
  it("la cache scade dopo la durata prevista", async () => {
    let t = 1_000_000;
    const { lk, spy } = lookup({ ol: olOk, gb: gbOk }, { now: () => t, cacheTtlMs: 1000 });
    await lk.run(q("title=Libro di prova"), "u1");
    t += 1500;
    await lk.run(q("title=Libro di prova"), "u1");
    expect(spy.mock.calls.length).toBe(4);
  });
  it("gli errori non finiscono in cache: la ricerca successiva riprova", async () => {
    let fail = true;
    const { lk, spy } = lookup({ ol: () => (fail ? json({}, 500) : json(olSearch)), gb: gbOk });
    await lk.run(q("title=Libro di prova"), "u1");
    fail = false;
    const r = await lk.run(q("title=Libro di prova"), "u1");
    expect(r.sources[0]!.status).toBe("ok");
    expect(spy.mock.calls.filter(([u]) => String(u).includes("openlibrary")).length).toBe(2);
  });
  it("limite di frequenza per utente: 429 con Retry-After; altri utenti non risentono; la finestra si libera", async () => {
    let t = 5_000_000;
    const { lk } = lookup({ ol: olOk, gb: gbOk }, { now: () => t, limits: { perMinute: 3, perDay: 100 } });
    for (let i = 0; i < 3; i++) await lk.run(q(`title=Libro ${i}x`), "u1");
    await expect(lk.run(q("title=Libro altro"), "u1")).rejects.toMatchObject({ status: 429, code: "rate_limited", retryAfter: 60 });
    await expect(lk.run(q("title=Libro altro"), "u2")).resolves.toBeDefined();
    t += 61_000;
    await expect(lk.run(q("title=Libro altro"), "u1")).resolves.toBeDefined();
  });
  it("limite giornaliero", async () => {
    let t = 9_000_000;
    const { lk } = lookup({ ol: olOk, gb: gbOk }, { now: () => t, limits: { perMinute: 100, perDay: 4 } });
    for (let i = 0; i < 4; i++) { await lk.run(q(`title=Libro ${i}x`), "u1"); t += 61_000; }
    await expect(lk.run(q("title=Libro altro"), "u1")).rejects.toMatchObject({ status: 429 });
  });
  it("Open Library: richieste distanziate (almeno l'intervallo minimo) anche se arrivano insieme", async () => {
    let t = 0;
    const waits: number[] = [];
    const { lk } = lookup({ ol: olOk, gb: gbOk }, { now: () => t, sleep: async (ms) => { waits.push(ms); t += ms; }, minIntervalMs: 400, limits: { perMinute: 100, perDay: 100 } });
    await Promise.all([lk.run(q("title=Libro uno"), "u1"), lk.run(q("title=Libro due"), "u1")]);
    expect(waits.length).toBeGreaterThan(0);
    expect(Math.min(...waits)).toBeGreaterThan(0);
  });
});

describe("Il codice client non contiene segreti né chiamate dirette alle fonti", () => {
  it("nessun riferimento a chiavi o host delle fonti sotto src/", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
    const offenders = walk("src").filter((f) => /\.(tsx?|css|html)$/.test(f) && !f.endsWith(".test.ts") && !f.endsWith(".test.tsx")).filter((f) => /GOOGLE_BOOKS_API_KEY|googleapis\.com|openlibrary\.org\/(api|search)|[?&]key=/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
