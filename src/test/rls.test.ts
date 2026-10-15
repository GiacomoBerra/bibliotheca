// @vitest-environment node
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Test reali di Row Level Security su Postgres (PGlite, WASM) con la migrazione vera.
 * Si simulano solo le parti di Supabase: schema `auth`, `auth.uid()` e i ruoli `anon`/`authenticated`.
 * NON sostituiscono un test sul progetto Supabase reale (vedi docs/supabase-setup.md).
 */
const USER_A = "11111111-1111-1111-1111-111111111111";
const USER_B = "22222222-2222-2222-2222-222222222222";

let db: PGlite;

async function as(role: "anon" | "authenticated", uid: string | null, sql: string, params: unknown[] = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ""}', false); set role ${role};`);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec("reset role");
  }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    grant usage on schema public to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    insert into auth.users values ('${USER_A}'), ('${USER_B}');
  `);
  await db.exec(readFileSync("supabase/migrations/20261015000001_books.sql", "utf8"));
});
afterAll(async () => { await db.close(); });

describe("RLS su public.books", () => {
  let bookA = "";
  it("l'utente A può inserire e leggere il proprio libro (user_id da auth.uid())", async () => {
    const ins = await as("authenticated", USER_A, "insert into books (title, authors) values ($1, $2) returning id, user_id", ["Libro di A", ["Rossi, Anna"]]);
    bookA = (ins.rows[0] as { id: string }).id;
    expect((ins.rows[0] as { user_id: string }).user_id).toBe(USER_A);
    const sel = await as("authenticated", USER_A, "select id from books");
    expect(sel.rows).toHaveLength(1);
  });

  it("senza autenticazione (anon) non si può né leggere né scrivere", async () => {
    await expect(as("anon", null, "select * from books")).rejects.toThrow(/permission denied/i);
    await expect(as("anon", null, "insert into books (title) values ('x')")).rejects.toThrow(/permission denied/i);
  });

  it("authenticated senza identità valida (uid nullo) non può inserire", async () => {
    await expect(as("authenticated", null, "insert into books (title) values ('x')")).rejects.toThrow();
    const sel = await as("authenticated", null, "select * from books");
    expect(sel.rows).toHaveLength(0);
  });

  it("l'utente B non vede i libri di A", async () => {
    const sel = await as("authenticated", USER_B, "select * from books");
    expect(sel.rows).toHaveLength(0);
  });

  it("l'utente B non può modificare né cancellare il libro di A (0 righe toccate)", async () => {
    const upd = await as("authenticated", USER_B, "update books set title = 'hack' where id = $1 returning id", [bookA]);
    expect(upd.rows).toHaveLength(0);
    const del = await as("authenticated", USER_B, "delete from books where id = $1 returning id", [bookA]);
    expect(del.rows).toHaveLength(0);
    const still = await as("authenticated", USER_A, "select title from books where id = $1", [bookA]);
    expect((still.rows[0] as { title: string }).title).toBe("Libro di A");
  });

  it("B non può inserire un libro a nome di A", async () => {
    await expect(as("authenticated", USER_B, "insert into books (title, user_id) values ('x', $1)", [USER_A])).rejects.toThrow(/row-level security/i);
  });

  it("A non può cedere un proprio libro a B", async () => {
    await expect(as("authenticated", USER_A, "update books set user_id = $1 where id = $2", [USER_B, bookA])).rejects.toThrow(/row-level security/i);
  });

  it("record incompleto: basta il titolo; titolo vuoto rifiutato", async () => {
    const ok = await as("authenticated", USER_A, "insert into books (title) values ('Solo titolo') returning status, authors, marc_fields");
    expect(ok.rows[0]).toMatchObject({ status: "bozza", authors: [], marc_fields: null });
    await expect(as("authenticated", USER_A, "insert into books (title) values ('   ')")).rejects.toThrow(/check/i);
  });

  it("MARC21: ordine, campi ripetuti, indicatori e sottocampi si conservano", async () => {
    const fields = [
      { tag: "650", ind1: " ", ind2: "7", subfields: [{ code: "a", value: "Uno" }, { code: "2", value: "x" }] },
      { tag: "650", ind1: " ", ind2: "7", subfields: [{ code: "a", value: "Due" }] },
      { tag: "245", ind1: "1", ind2: "0", subfields: [{ code: "a", value: "T" }, { code: "a", value: "ripetuto" }] },
    ];
    const ins = await as("authenticated", USER_A, "insert into books (title, marc_fields) values ('M', $1::jsonb) returning marc_fields", [JSON.stringify(fields)]);
    expect((ins.rows[0] as { marc_fields: unknown }).marc_fields).toEqual(fields);
    await expect(as("authenticated", USER_A, "insert into books (title, marc_fields) values ('M', '{\"a\":1}'::jsonb)")).rejects.toThrow(/check/i);
  });

  it("search_text include ISBN con e senza trattini e viene aggiornato", async () => {
    await as("authenticated", USER_A, "insert into books (title, isbn) values ('ISBN test', '978-88-04-12345-6')");
    const r1 = await as("authenticated", USER_A, "select title from books where search_text like $1", ["%9788804123456%"]);
    const r2 = await as("authenticated", USER_A, "select title from books where search_text like $1", ["%978-88-04%"]);
    expect(r1.rows).toHaveLength(1);
    expect(r2.rows).toHaveLength(1);
  });

  it("anon non ha privilegi sulla tabella e RLS è forzata", async () => {
    const r = await db.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>("select relrowsecurity, relforcerowsecurity from pg_class where relname = 'books'");
    expect(r.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });
});
