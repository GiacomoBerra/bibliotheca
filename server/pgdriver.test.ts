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
  await ndb.applyMigrations("./db/migrations");
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
  it("le migrazioni sono state applicate dal motore di Netlify (schema atteso)", async () => {
    const client = new pg.Client({ connectionString });
    await client.connect();
    const cols = await client.query("select column_name from information_schema.columns where table_name = 'books' and column_name in ('created_by','marc_fields','search_text')");
    await client.end();
    expect(cols.rowCount).toBe(3);
  });
});
