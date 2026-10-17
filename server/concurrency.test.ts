// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { api, makeDeps, makeTestDb } from "./testHarness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });
let raw: PGlite; let call: ReturnType<typeof api>;
beforeAll(async () => { const t = await makeTestDb(); raw = t.raw; call = api(makeDeps(t.db, { today: () => "2026-10-15" })); });
afterAll(async () => { await raw.close(); });
const as = (user: string) => (m: string, p: string, body?: object) => call(m, p, { user, roles: ["admin"], ...(body ? { body } : {}) });
const A = as("admin-a"), B = as("admin-b");

describe("modifiche simultanee di due amministratori", () => {
  it("la seconda modifica basata su una versione superata è rifiutata (409) e non sovrascrive nulla", async () => {
    const created = (await A("POST", "/api/books", { title: "Originale" })).json;
    const opened = (await A("GET", `/api/books/${created.id}`)).json; // entrambi aprono la stessa versione
    const first = await A("PUT", `/api/books/${created.id}`, { title: "Modifica di A", expectedUpdatedAt: opened.updatedAt });
    expect(first.status).toBe(200);
    const second = await B("PUT", `/api/books/${created.id}`, { title: "Modifica di B", expectedUpdatedAt: opened.updatedAt });
    expect(second.status).toBe(409);
    expect(second.json.error.code).toBe("edit_conflict");
    expect((await A("GET", `/api/books/${created.id}`)).json.title).toBe("Modifica di A");
    // dopo aver ricaricato, B può salvare
    const fresh = (await B("GET", `/api/books/${created.id}`)).json;
    expect((await B("PUT", `/api/books/${created.id}`, { title: "Modifica di B", expectedUpdatedAt: fresh.updatedAt })).status).toBe(200);
  });

  it("senza versione indicata il salvataggio funziona come prima (importazioni, strumenti); versione non valida = 400; scheda sparita = 404", async () => {
    const id = (await A("POST", "/api/books", { title: "Libera" })).json.id;
    expect((await A("PUT", `/api/books/${id}`, { title: "Libera 2" })).status).toBe(200);
    expect((await A("PUT", `/api/books/${id}`, { title: "x", expectedUpdatedAt: "non-una-data" })).status).toBe(400);
    expect((await A("DELETE", `/api/books/${id}`)).status).toBe(200);
    expect((await A("PUT", `/api/books/${id}`, { title: "x", expectedUpdatedAt: new Date().toISOString() })).status).toBe(404);
  });

  it("il visualizzatore non può modificare nemmeno con la versione giusta", async () => {
    const created = (await A("POST", "/api/books", { title: "Protetta" })).json;
    const v = await call("PUT", `/api/books/${created.id}`, { user: "v", roles: ["viewer"], body: { title: "Hack", expectedUpdatedAt: created.updatedAt } });
    expect(v.status).toBe(403);
  });
});
