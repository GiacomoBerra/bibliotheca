// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createHttpBooksApi } from "../src/lib/api/httpBooksApi";
import { emptyBookInput } from "../src/lib/api/types";
import { handle } from "./router";
import { api, makeDeps, makeTestDb } from "./testHarness";
import type { Db } from "./db";

let db: Db; let raw: PGlite; let call: ReturnType<typeof api>;
beforeAll(async () => { ({ db, raw } = await makeTestDb()); call = api(makeDeps(db)); });
afterAll(async () => { await raw.close(); });

const A = "user-A", B = "user-B";
const create = (user: string, body: object) => call("POST", "/api/books", { user, body });

describe("Accesso negato senza autenticazione", () => {
  it.each([
    ["GET", "/api/books"], ["POST", "/api/books"], ["GET", "/api/books/11111111-1111-1111-1111-111111111111"],
    ["PUT", "/api/books/11111111-1111-1111-1111-111111111111"], ["DELETE", "/api/books/11111111-1111-1111-1111-111111111111"],
    ["GET", "/api/stats"], ["GET", "/api/export"],
  ])("%s %s → 401", async (m, p) => {
    const r = await call(m, p, { body: { title: "x" } });
    expect(r.status).toBe(401);
    expect(r.json.error.code).toBe("unauthenticated");
  });
  it("nessun dato nella risposta 401 e nessuna scrittura nel database", async () => {
    await call("POST", "/api/books", { body: { title: "Intruso" } });
    expect((await raw.query("select count(*)::int as n from books where title = 'Intruso'")).rows[0]).toEqual({ n: 0 });
  });
  it("l'identità non si può dichiarare dal browser: parametri, corpo e intestazioni usuali sono ignorati", async () => {
    await create(A, { title: "Segreto di A" });
    for (const extra of [
      { path: `/api/books?userId=${A}&owner_id=${A}` },
      { path: "/api/books", headers: { "x-user-id": A, authorization: `Bearer ${A}`, cookie: `owner_id=${A}` } },
    ]) {
      const r = await call("GET", extra.path, { headers: extra.headers ?? {} });
      expect(r.status).toBe(401);
    }
    const r = await create(B, { title: "Di B", owner_id: A, ownerId: A, user_id: A });
    expect(r.status).toBe(201);
    expect((await raw.query("select owner_id from books where title = 'Di B'")).rows[0]).toEqual({ owner_id: B });
  });
});

describe("Isolamento tra utenti", () => {
  let idA = "";
  beforeAll(async () => { idA = (await create(A, { title: "Isolato di A", authors: ["Rossi, Anna"] })).json.id; });
  it("B non vede la scheda di A né in elenco, né per id, né in ricerca, né in export, né nelle statistiche", async () => {
    expect((await call("GET", `/api/books/${idA}`, { user: B })).status).toBe(404);
    expect((await call("GET", "/api/books?query=isolato", { user: B })).json.total).toBe(0);
    expect((await call("GET", "/api/export", { user: B })).json.books.some((b: any) => b.id === idA)).toBe(false);
    const stats = (await call("GET", "/api/stats", { user: B })).json;
    expect(stats.total).toBe(stats.byStatus.bozza + stats.byStatus["da revisionare"] + stats.byStatus.catalogato);
    expect((await call("GET", "/api/books?query=isolato", { user: A })).json.total).toBe(1);
  });
  it("B non può modificare né cancellare la scheda di A", async () => {
    expect((await call("PUT", `/api/books/${idA}`, { user: B, body: { title: "Hack" } })).status).toBe(404);
    expect((await call("DELETE", `/api/books/${idA}`, { user: B })).status).toBe(404);
    expect((await call("GET", `/api/books/${idA}`, { user: A })).json.title).toBe("Isolato di A");
  });
  it("il corpo non può riassegnare la proprietà in un aggiornamento", async () => {
    await call("PUT", `/api/books/${idA}`, { user: A, body: { title: "Isolato di A", owner_id: B } });
    expect((await raw.query("select owner_id from books where id = $1", [idA])).rows[0]).toEqual({ owner_id: A });
  });
});

describe("Inserimento, modifica, cancellazione", () => {
  it("record incompleto: basta il titolo; default bozza", async () => {
    const r = await create(A, { title: "Solo titolo" });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ title: "Solo titolo", status: "bozza", authors: [], isbn: "", marcFields: null });
  });
  it("validazione lato server: titolo mancante, ISBN malformato, tipi errati, stato errato, JSON non valido", async () => {
    expect((await create(A, {})).status).toBe(400);
    expect((await create(A, { title: "  " })).status).toBe(400);
    expect((await create(A, { title: "x", isbn: "12ab" })).json.error.fields.isbn).toBeDefined();
    expect((await create(A, { title: 5 })).status).toBe(400);
    expect((await create(A, { title: "x", authors: "no" })).status).toBe(400);
    expect((await create(A, { title: "x", status: "altro" })).status).toBe(400);
    expect((await create(A, { title: "x".repeat(501) })).status).toBe(400);
    expect((await call("POST", "/api/books", { user: A, raw: "{non json" })).json.error.code).toBe("bad_json");
    expect((await call("POST", "/api/books", { user: A, raw: "x".repeat(1_000_001) })).status).toBe(413);
  });
  it("MARC21: ordine, campi ripetuti, indicatori e sottocampi si conservano; MARC malformato rifiutato", async () => {
    const marcFields = [
      { tag: "650", ind1: " ", ind2: "7", subfields: [{ code: "a", value: "Uno" }, { code: "2", value: "x" }] },
      { tag: "650", ind1: " ", ind2: "7", subfields: [{ code: "a", value: "Due" }] },
      { tag: "245", ind1: "1", ind2: "0", subfields: [{ code: "a", value: "T" }, { code: "a", value: "ripetuto" }] },
    ];
    const r = await create(A, { title: "Con MARC", marcFields, marcLeader: "00000nam a2200000 a 4500" });
    expect(r.json.marcFields).toEqual(marcFields);
    expect((await call("GET", `/api/books/${r.json.id}`, { user: A })).json.marcFields).toEqual(marcFields);
    expect((await create(A, { title: "x", marcFields: { a: 1 } })).status).toBe(400);
    expect((await create(A, { title: "x", marcFields: [{ tag: "245" }] })).status).toBe(400);
  });
  it("modifica e cancellazione, con 404 sulla seconda cancellazione", async () => {
    const id = (await create(A, { title: "Da modificare", subjects: ["Uno"] })).json.id;
    const up = await call("PUT", `/api/books/${id}`, { user: A, body: { title: "Modificato", status: "catalogato", subjects: ["Due", "Tre"] } });
    expect(up.json).toMatchObject({ title: "Modificato", status: "catalogato", subjects: ["Due", "Tre"] });
    expect((await call("DELETE", `/api/books/${id}`, { user: A })).json).toEqual({ deleted: true });
    expect((await call("DELETE", `/api/books/${id}`, { user: A })).status).toBe(404);
    expect((await call("GET", `/api/books/${id}`, { user: A })).status).toBe(404);
  });
  it("identificativi non UUID → 404, mai errori SQL", async () => {
    for (const id of ["abc", "1%20or%201=1", "'; drop table books;--"]) {
      expect((await call("GET", `/api/books/${id}`, { user: A })).status).toBe(404);
      expect((await call("DELETE", `/api/books/${id}`, { user: A })).status).toBe(404);
    }
    expect((await raw.query("select count(*)::int as n from books")).rows[0]).not.toEqual({ n: 0 });
  });
});

describe("Ricerca, filtri, ordinamento, paginazione, statistiche", () => {
  const U = "user-search";
  beforeAll(async () => {
    for (const b of [
      { title: "Introduzione alla chimica", authors: ["Rossi, Anna"], isbn: "978-0-306-40615-7", publisher: "Alfa", publicationYear: "2001", status: "catalogato", subjects: ["Chimica"] },
      { title: "Astronomia per tutti", authors: ["Bianchi, Luca"], publicationYear: "1999", status: "bozza" },
      { title: "Storia del libro 100%", authors: ["Verdi, Gino"], publisher: "Alfa", status: "da revisionare", subjects: ["Libri", "chimica"], dewey: "002.09" },
    ]) await create(U, b);
  });
  const list = (q: string) => call("GET", `/api/books?${q}`, { user: U });
  it("titolo, autore, ISBN (con e senza trattini), Dewey; ignora maiuscole e spazi", async () => {
    expect((await list("query=%20%20ASTRONOMIA%20")).json.total).toBe(1);
    expect((await list("query=bianchi")).json.total).toBe(1);
    expect((await list("query=9780306406157")).json.total).toBe(1);
    expect((await list("query=978-0-306-40615-7")).json.total).toBe(1);
    expect((await list("query=002.09")).json.total).toBe(1);
    expect((await list("query=alfa%20chimica")).json.total).toBe(2);
    expect((await list("query=alfa%20chimica%20rossi")).json.total).toBe(1);
  });
  it("% e _ sono letterali; tentativi di SQL injection non hanno effetto", async () => {
    expect((await list("query=100%25")).json.total).toBe(1);
    expect((await list("query=%25")).json.total).toBe(1); // solo la scheda con un "%" vero nel titolo, non "tutto"
    expect((await list("query=_")).json.total).toBe(0);
    for (const q of ["'%20or%201=1--", "';drop%20table%20books;--", "%5C"]) expect((await list(`query=${q}`)).status).toBe(200);
    expect((await list("query=")).json.total).toBe(3);
  });
  it("filtro per stato, ordinamento (whitelist) e paginazione", async () => {
    expect((await list("status=bozza")).json.total).toBe(1);
    expect((await list("sort=titolo&dir=asc")).json.items.map((b: any) => b.title)).toEqual(["Astronomia per tutti", "Introduzione alla chimica", "Storia del libro 100%"]);
    expect((await list("sort=titolo&dir=desc")).json.items[0].title).toBe("Storia del libro 100%");
    expect((await list("sort=anno&dir=asc")).json.items[2].publicationYear).toBe("");
    expect((await list("sort=1;drop table books&dir=sideways&status=boh")).status).toBe(200);
    const p2 = (await list("sort=titolo&pageSize=2&page=2")).json;
    expect(p2).toMatchObject({ total: 3, page: 2, pageSize: 2 });
    expect(p2.items).toHaveLength(1);
    expect((await list("pageSize=100000&page=-5")).json).toMatchObject({ pageSize: 100, page: 1 });
  });
  it("statistiche reali", async () => {
    expect((await call("GET", "/api/stats", { user: U })).json).toEqual({ total: 3, byStatus: { bozza: 1, "da revisionare": 1, catalogato: 1 }, publishers: 1, subjects: 2 });
  });
});

describe("Protezione CSRF, metodi, risposte", () => {
  it("le scritture senza intestazione di sicurezza, con Origin diversa o non JSON sono rifiutate (403)", async () => {
    expect((await call("POST", "/api/books", { user: A, body: { title: "x" }, headers: { "x-bibliotheca": "0" } })).status).toBe(403);
    expect((await call("POST", "/api/books", { user: A, body: { title: "x" }, headers: { origin: "https://evil.example" } })).status).toBe(403);
    expect((await call("POST", "/api/books", { user: A, body: { title: "x" }, headers: { "sec-fetch-site": "cross-site" } })).status).toBe(403);
    expect((await call("POST", "/api/books", { user: A, raw: "title=x", headers: { "content-type": "application/x-www-form-urlencoded" } })).status).toBe(403);
    expect((await raw.query("select count(*)::int as n from books where owner_id = $1 and title = 'x'", [A])).rows[0]).toEqual({ n: 0 });
  });
  it("percorsi e metodi sconosciuti; risposte non cacheabili", async () => {
    expect((await call("GET", "/api/altro", { user: A })).status).toBe(404);
    expect((await call("PATCH", "/api/books", { user: A, body: {} })).status).toBe(405);
    const r = await call("GET", "/api/books", { user: A });
    expect(r.headers.get("cache-control")).toBe("no-store");
  });
  it("database non configurato: 401 senza sessione, 503 con sessione (mai dati)", async () => {
    const noDb = api(makeDeps(null));
    expect((await noDb("GET", "/api/books")).status).toBe(401);
    expect((await noDb("GET", "/api/books", { user: A })).status).toBe(503);
  });
  it("errori interni: risposta generica senza dettagli, loggata senza dati dell'utente", async () => {
    const logs: string[] = [];
    const broken = { async query() { throw new Error('relation "books" does not exist; password=segreta'); } };
    const r = await api(makeDeps(broken as unknown as Db, { log: (m) => logs.push(m) }))("GET", "/api/books", { user: A });
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.json)).not.toMatch(/relation|segreta/);
    expect(logs).toHaveLength(1);
  });
});

describe("Persistenza dopo un nuovo accesso, con il client reale dell'app", () => {
  const session = { current: "user-persist" as string | null };
  const client = (refresh?: () => Promise<boolean>, expired?: () => void) =>
    createHttpBooksApi({
      fetch: async (url, init) => {
        const headers = new Headers(init?.headers);
        if (session.current) headers.set("x-test-session", session.current);
        return handle(new Request(`https://bibliotheca.test${url as string}`, { ...init, headers: { ...Object.fromEntries(headers), origin: "https://bibliotheca.test" } }), makeDeps(db));
      },
      ...(refresh ? { refreshSession: refresh } : {}),
      ...(expired ? { onSessionExpired: expired } : {}),
    });
  it("CRUD completo tramite il client HTTP", async () => {
    const c = client();
    const b = await c.createBook({ ...emptyBookInput(), title: "Persistente", authors: ["Neri, Marta"] });
    expect(b.id).toMatch(/^[0-9a-f-]{36}$/);
    await c.updateBook(b.id, { ...emptyBookInput(), title: "Persistente 2", status: "catalogato" });
    expect((await c.getBook(b.id))?.title).toBe("Persistente 2");
    expect((await c.listBooks({ query: "persistente" })).total).toBe(1);
    expect((await c.getStats()).byStatus.catalogato).toBe(1);
    expect((await c.listAllBooks()).map((x) => x.id)).toContain(b.id);
  });
  it("dopo uscita e nuovo accesso (nuova sessione, stesso utente) i dati ci sono ancora; un altro utente non li vede", async () => {
    session.current = null;
    await expect(client().listBooks()).rejects.toMatchObject({ kind: "auth" });
    session.current = "user-persist";
    expect((await client().listBooks({ query: "persistente" })).total).toBe(1);
    session.current = "altro-utente";
    expect((await client().listBooks({ query: "persistente" })).total).toBe(0);
    expect(await client().getBook("11111111-1111-1111-1111-111111111111")).toBeNull();
  });
  it("sessione scaduta: tenta il rinnovo una volta; se riesce riprova, altrimenti segnala la scadenza", async () => {
    session.current = null;
    let refreshed = 0, expired = 0;
    await expect(client(async () => { refreshed++; return false; }, () => expired++).listBooks()).rejects.toMatchObject({ kind: "auth" });
    expect({ refreshed, expired }).toEqual({ refreshed: 1, expired: 1 });
    const ok = client(async () => { session.current = "user-persist"; return true; }, () => expired++);
    expect((await ok.listBooks()).total).toBeGreaterThan(0);
    expect(expired).toBe(1);
  });
  it("errore di rete: messaggio chiaro", async () => {
    const c = createHttpBooksApi({ fetch: async () => { throw new TypeError("Failed to fetch"); } });
    await expect(c.createBook({ ...emptyBookInput(), title: "x" })).rejects.toMatchObject({ kind: "network", message: expect.stringContaining("non sono stati modificati") });
  });
});
