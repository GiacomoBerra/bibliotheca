import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { createSupabaseBooksApi } from "./supabaseBooksApi";
import { emptyBookInput } from "./types";

type Call = [string, ...unknown[]];

/** Finto query builder: registra le chiamate concatenate e risolve con un risultato prestabilito. */
function fakeClient(result: { data?: unknown; error?: unknown; count?: number | null }) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "insert", "update", "delete", "eq", "ilike", "order", "range", "maybeSingle", "single"]) {
    builder[m] = (...args: unknown[]) => { calls.push([m, ...args]); return builder; };
  }
  builder["then"] = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve({ data: null, error: null, count: null, ...result }).then(res, rej);
  const client = { from: (t: string) => { calls.push(["from", t]); return builder; } } as unknown as SupabaseClient;
  return { client, calls };
}

describe("createSupabaseBooksApi", () => {
  it("la ricerca usa un filtro ilike per ogni termine, con caratteri speciali neutralizzati, su search_text", async () => {
    const { client, calls } = fakeClient({ data: [], count: 0 });
    await createSupabaseBooksApi(client).listBooks({ query: "100%_ rossi,(x)", status: "bozza", sort: "titolo", dir: "asc", page: 2, pageSize: 10 });
    expect(calls).toContainEqual(["ilike", "search_text", "%100\\%\\_%"]);
    expect(calls).toContainEqual(["ilike", "search_text", "%rossi,(x)%"]);
    expect(calls).toContainEqual(["eq", "status", "bozza"]);
    expect(calls).toContainEqual(["order", "title", { ascending: true, nullsFirst: false }]);
    expect(calls).toContainEqual(["range", 10, 19]);
  });

  it("la scrittura non invia mai user_id", async () => {
    const { client, calls } = fakeClient({ data: { id: "1", title: "T", status: "bozza", created_at: "c", updated_at: "u" } });
    await createSupabaseBooksApi(client).createBook({ ...emptyBookInput(), title: "T" });
    const insert = calls.find((c) => c[0] === "insert");
    expect(insert?.[1]).not.toHaveProperty("user_id");
  });

  it("errore RLS/JWT → messaggio italiano e tipo auth", async () => {
    const { client } = fakeClient({ error: { message: "JWT expired", code: "PGRST301" } });
    await expect(createSupabaseBooksApi(client).listBooks()).rejects.toMatchObject({ kind: "auth", message: expect.stringMatching(/sessione è scaduta/) });
  });

  it("modifica/cancellazione di una scheda non visibile (0 righe) → errore 'notfound', non un falso successo", async () => {
    const upd = fakeClient({ data: null });
    await expect(createSupabaseBooksApi(upd.client).updateBook("x", { ...emptyBookInput(), title: "T" })).rejects.toMatchObject({ kind: "notfound" });
    const del = fakeClient({ data: [] });
    await expect(createSupabaseBooksApi(del.client).deleteBook("x")).rejects.toMatchObject({ kind: "notfound" });
  });

  it("identificativo non valido (22P02) → scheda inesistente", async () => {
    const { client } = fakeClient({ error: { message: "invalid input syntax for type uuid", code: "22P02" } });
    expect(await createSupabaseBooksApi(client).getBook("zzz")).toBeNull();
  });
});
