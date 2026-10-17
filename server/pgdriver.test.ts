// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NetlifyDB } from "@netlify/database-dev";
import pg from "pg";
import { createPgDb } from "./db";
import { api, makeDeps } from "./testHarness";

/**
 * Stesso motore locale usato da `netlify dev` (@netlify/database-dev) raggiunto con il driver `pg` di produzione
 * (createPgDb) e le migrazioni vere: prova il percorso Function → pg → Postgres, non solo PGlite diretto.
 */
const pools: ReturnType<typeof createPgDb>[] = [];
const mk = () => { const d = createPgDb(connectionString); pools.push(d); return d; };
let ndb: NetlifyDB; let call: ReturnType<typeof api>; let connectionString = "";
beforeAll(async () => {
  ndb = new NetlifyDB();
  connectionString = await ndb.start();
  await ndb.applyMigrations("./netlify/database/migrations");
  call = api(makeDeps(mk()));
}, 60_000);
afterAll(async () => { await Promise.all(pools.map((p) => p.close?.())); await ndb.stop(); });

describe("Driver pg di produzione su Postgres locale Netlify", () => {
  it("CRUD, MARC jsonb, array e ricerca funzionano col driver reale", async () => {
    const marc = [{ tag: "650", ind1: " ", ind2: "7", subfields: [{ code: "a", value: "x" }] }, { tag: "650", ind1: " ", ind2: "7", subfields: [{ code: "a", value: "y" }] }];
    const c = await call("POST", "/api/books", { user: "u1", body: { title: "Driver pg", authors: ["Rossi, Anna"], subjects: ["S1", "S2"], isbn: "978-0-306-40615-7", marcFields: marc } });
    expect(c.status).toBe(201);
    const g = await call("GET", `/api/books/${c.json.id}`, { user: "u1" });
    expect(g.json).toMatchObject({ authors: ["Rossi, Anna"], subjects: ["S1", "S2"], marcFields: marc });
    expect((await call("GET", "/api/books?query=9780306406157", { user: "u1" })).json.total).toBe(1);
    const u = await call("PUT", `/api/books/${c.json.id}`, { user: "u1", body: { title: "Driver pg 2", status: "catalogato" } });
    expect(u.json).toMatchObject({ title: "Driver pg 2", status: "catalogato", marcFields: null });
    expect((await call("GET", "/api/stats", { user: "u1" })).json.total).toBe(1);
    expect((await call("DELETE", `/api/books/${c.json.id}`, { user: "u1" })).status).toBe(200);
  });
  it("ruoli e catalogo condiviso anche col driver reale", async () => {
    const c = await call("POST", "/api/books", { user: "u1", body: { title: "Condiviso" } });
    expect((await call("GET", `/api/books/${c.json.id}`, { user: "u2", roles: ["admin"] })).status).toBe(200);
    expect((await call("GET", `/api/books/${c.json.id}`, { user: "v1", roles: ["viewer"] })).status).toBe(200);
    expect((await call("DELETE", `/api/books/${c.json.id}`, { user: "v1", roles: ["viewer"] })).status).toBe(403);
    expect((await call("GET", "/api/export", { user: "v1", roles: ["viewer"] })).status).toBe(403);
    expect((await call("GET", "/api/books", { user: "n1", roles: [] })).status).toBe(403);
    expect((await call("GET", "/api/books")).status).toBe(401);
    expect((await call("GET", `/api/books/${c.json.id}`, { user: "u1" })).status).toBe(200);
  });
  it("la persistenza sopravvive a una nuova connessione (nuovo pool = nuova istanza della Function)", async () => {
    const fresh = api(makeDeps(mk()));
    expect((await fresh("GET", "/api/books?query=condiviso", { user: "u1" })).json.total).toBe(1);
  });
  it("prestiti col driver reale: richieste davvero concorrenti → un solo prestito; storico conservato; viewer senza dati personali", async () => {
    const b = await call("POST", "/api/books", { user: "u1", body: { title: "Libro prestiti pg" } });
    const loanBody = (n: number) => ({ borrower: `Persona ${n}`, contact: "", notes: "", loanDate: "2026-10-01", plannedDays: 14 });
    const rs = await Promise.all([1, 2, 3, 4, 5, 6].map((n) => api(makeDeps(mk(), { today: () => "2026-10-15" }))("POST", `/api/books/${b.json.id}/loans`, { user: "u1", body: loanBody(n) })));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409)).toHaveLength(5);
    const ok = rs.find((r) => r.status === 201)!;
    expect((await call("POST", `/api/loans/${ok.json.id}/return`, { user: "u1", body: { returnedDate: "2026-10-05" } })).json).toMatchObject({ state: "restituito", effectiveDays: 4 });
    expect((await call("DELETE", `/api/books/${b.json.id}`, { user: "u1" })).status).toBe(409);
    const v = await call("GET", `/api/books/${b.json.id}/loans`, { user: "v1", roles: ["viewer"] });
    expect(v.json.loans).toHaveLength(1);
    expect(v.json.loans[0].borrower).toBeNull();
    expect((await call("GET", "/api/loans", { user: "v1", roles: ["viewer"] })).status).toBe(403);
  });
  it("ripristino v4 con driver reale: prestito con due correzioni, ordine conservato, provenienza e atomicità", async () => {
    const b = await call("POST", "/api/books", { user: "u1", body: { title: "Ripristino pg" } });
    const bad = { bookId: b.json.id, id: "55555555-5555-4555-8555-555555555555", copyNo: 1, borrower: "A", contact: "", notes: "", loanDate: "2026-09-01", plannedDays: 10, returnedDate: null,
      createdBy: "orig", createdAt: "2026-09-01T08:00:00Z", voided: { at: "2026-09-04T10:00:00Z", by: "orig2", reason: "errore" },
      corrections: [
        { action: "annulla_restituzione", reason: "prima", correctedBy: "orig2", correctedAt: "2026-09-03T10:00:00Z", before: { state: "restituito", returnedDate: "2026-09-02", returnedBy: "orig", voided: false }, after: { state: "attivo", returnedDate: null, returnedBy: null, voided: false } },
        { action: "annulla_prestito", reason: "errore", correctedBy: "orig2", correctedAt: "2026-09-04T10:00:00Z", before: { state: "attivo", returnedDate: null, returnedBy: null, voided: false }, after: { state: "annullato", returnedDate: null, returnedBy: null, voided: true } },
      ] };
    const r = await call("POST", "/api/loans/restore", { user: "restorer", body: { loans: [bad] } });
    expect(r.json).toMatchObject({ created: 1, corrections: 2, skipped: 0 });
    const c = await call("GET", `/api/loans/${bad.id}/corrections`, { user: "u1" });
    expect(c.json.items.map((x: { reason: string }) => x.reason)).toEqual(["errore", "prima"]); // dalla più recente
    const l = await call("GET", `/api/loans/${bad.id}`, { user: "u1" });
    expect(l.json).toMatchObject({ state: "annullato", createdBy: "orig", createdAt: "2026-09-01T08:00:00Z", voidedBy: "orig2" });
    expect((await call("POST", "/api/loans/restore", { user: "restorer", body: { loans: [bad] } })).json).toMatchObject({ created: 0, skipped: 1 });
    const other = { ...bad, id: "66666666-6666-4666-8666-666666666666" };
    const fail = await call("POST", "/api/loans/restore", { user: "restorer", body: { loans: [other, { ...other, id: "77777777-7777-4777-8777-777777777777", bookId: "88888888-8888-4888-8888-888888888888" }] } });
    expect(fail.status).toBe(404);
    expect((await call("GET", `/api/loans/${other.id}`, { user: "u1" })).status).toBe(404);
  });
  it("le migrazioni sono state applicate dal motore di Netlify (schema atteso)", async () => {
    const client = new pg.Client({ connectionString });
    await client.connect();
    const cols = await client.query("select column_name from information_schema.columns where table_name = 'books' and column_name in ('created_by','marc_fields','search_text')");
    await client.end();
    expect(cols.rowCount).toBe(3);
  });
});
