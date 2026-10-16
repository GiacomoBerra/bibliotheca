// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { api, makeDeps, makeTestDb } from "./testHarness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

let raw: PGlite; let call: ReturnType<typeof api>;
beforeAll(async () => { const t = await makeTestDb(); raw = t.raw; call = api(makeDeps(t.db, { today: () => "2026-10-15" })); });
afterAll(async () => { await raw.close(); });

const admin = (m: string, p: string, body?: object) => call(m, p, { user: "a1", roles: ["admin"], ...(body ? { body } : {}) });
const viewer = (m: string, p: string, body?: object) => call(m, p, { user: "v1", roles: ["viewer"], ...(body ? { body } : {}) });
const newBook = async (title: string) => (await admin("POST", "/api/books", { title })).json.id as string;
const lend = (id: string, over: object = {}) => admin("POST", `/api/books/${id}/loans`, { borrower: "Marta", contact: "", loanDate: "2026-10-01", plannedDays: 30, notes: "", ...over });
const state = async (id: string) => (await admin("GET", "/api/books?pageSize=100")).json.availability[id];

describe("copie fisiche", () => {
  it("una scheda nuova ha già la copia 1; si aggiungono copie con codice univoco", async () => {
    const id = await newBook("Con copie");
    expect((await admin("GET", `/api/books/${id}/copies`)).json.items).toHaveLength(1);
    const c2 = await admin("POST", `/api/books/${id}/copies`, { inventoryCode: "INV-001", notes: "dorso rovinato" });
    expect(c2.status).toBe(201);
    expect(c2.json).toMatchObject({ copyNo: 2, inventoryCode: "INV-001" });
    const dup = await admin("POST", `/api/books/${id}/copies`, { inventoryCode: " inv-001 " });
    expect(dup.status).toBe(409);
    expect((await admin("GET", `/api/books/${id}/copies`)).json.items).toHaveLength(2);
  });

  it("modifica di codice e note; codice duplicato rifiutato; le copie non si cancellano", async () => {
    const id = await newBook("Modifica");
    const c2 = (await admin("POST", `/api/books/${id}/copies`, { inventoryCode: "X-1" })).json;
    const ok = await admin("PUT", `/api/copies/${c2.id}`, { inventoryCode: "X-2", notes: "ok" });
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({ inventoryCode: "X-2", notes: "ok" });
    const other = await newBook("Altro");
    const o2 = (await admin("POST", `/api/books/${other}/copies`, { inventoryCode: "Y-1" })).json;
    expect((await admin("PUT", `/api/copies/${o2.id}`, { inventoryCode: "x-2" })).status).toBe(409);
    expect((await admin("DELETE", `/api/copies/${c2.id}`)).status).toBe(405);
    expect((await admin("POST", `/api/books/${id}/copies`, { inventoryCode: "z".repeat(51) })).status).toBe(400);
  });

  it("permessi: il visualizzatore legge ma non scrive; /api/copies è solo admin", async () => {
    const id = await newBook("Permessi");
    expect((await viewer("GET", `/api/books/${id}/copies`)).status).toBe(200);
    expect((await viewer("POST", `/api/books/${id}/copies`, { inventoryCode: "V-1" })).status).toBe(403);
    expect((await viewer("GET", "/api/copies")).status).toBe(403);
    expect((await admin("GET", "/api/copies")).status).toBe(200);
  });

  it("prestiti per copia: disponibilità parziale, scelta automatica della copia libera, restituzione per copia", async () => {
    const id = await newBook("Tre copie");
    await admin("POST", `/api/books/${id}/copies`, {}); await admin("POST", `/api/books/${id}/copies`, {});
    expect(await state(id)).toMatchObject({ state: "disponibile", totalCopies: 3, availableCopies: 3 });
    const l1 = (await lend(id)).json, l2 = (await lend(id)).json;
    expect([l1.copyNo, l2.copyNo].sort()).toEqual([1, 2]);
    expect(await state(id)).toMatchObject({ state: "disponibilità parziale", availableCopies: 1 });
    const l3 = await lend(id, { copyNo: 3 });
    expect(l3.json.copyNo).toBe(3);
    expect(await state(id)).toMatchObject({ state: "in prestito", availableCopies: 0 });
    expect((await lend(id)).status).toBe(409);
    expect((await lend(id, { copyNo: 3 })).status).toBe(409);
    expect((await admin("POST", `/api/loans/${l2.id}/return`, { returnedDate: "2026-10-10" })).status).toBe(200);
    expect(await state(id)).toMatchObject({ state: "disponibilità parziale", availableCopies: 1 });
    const again = await lend(id);
    expect(again.json.copyNo).toBe(l2.copyNo);
  });

  it("una copia inesistente è rifiutata", async () => {
    const id = await newBook("Inesistente");
    expect((await lend(id, { copyNo: 7 })).status).toBeGreaterThanOrEqual(400);
  });

  it("ripristino con copie: crea le copie mancanti, non sovrascrive codice o note già presenti, è idempotente", async () => {
    const id = await newBook("Ripristino");
    const first = await admin("POST", "/api/loans/restore", { loans: [], copies: [{ bookId: id, copyNo: 1, inventoryCode: "R-1", notes: null }, { bookId: id, copyNo: 2, inventoryCode: "R-2", notes: "n" }] });
    expect(first.status).toBe(200);
    expect(first.json.copiesCreated).toBe(1);
    const again = await admin("POST", "/api/loans/restore", { loans: [], copies: [{ bookId: id, copyNo: 1, inventoryCode: "ALTRO", notes: null }, { bookId: id, copyNo: 2, inventoryCode: "R-2", notes: "n" }] });
    expect(again.json.copiesCreated).toBe(0);
    const list = (await admin("GET", `/api/books/${id}/copies`)).json.items;
    expect(list.map((c: { inventoryCode: string | null }) => c.inventoryCode)).toEqual(["R-1", "R-2"]);
    expect((await viewer("POST", "/api/loans/restore", { loans: [], copies: [] })).status).toBe(403);
  });

  it("ripristino con codici duplicati nel file: rifiutato prima di scrivere", async () => {
    const id = await newBook("Dup file");
    const r = await admin("POST", "/api/loans/restore", { loans: [], copies: [{ bookId: id, copyNo: 1, inventoryCode: "D-1" }, { bookId: id, copyNo: 2, inventoryCode: "d-1" }] });
    expect(r.status).toBe(400);
    expect((await admin("GET", `/api/books/${id}/copies`)).json.items[0].inventoryCode).toBeNull();
  });
});
