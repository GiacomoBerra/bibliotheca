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
const count = async (sql: string, p: unknown[] = []) => Number((await raw.query<{ n: string }>(sql, p)).rows[0]!.n);

async function bookWithHistory(title: string) {
  const id = (await admin("POST", "/api/books", { title })).json.id as string;
  await admin("POST", `/api/books/${id}/copies`, { inventoryCode: `INV-${title}` });
  const l1 = (await admin("POST", `/api/books/${id}/loans`, { borrower: "A", contact: "", loanDate: "2026-10-01", plannedDays: 10, notes: "" })).json;
  await admin("POST", `/api/loans/${l1.id}/return`, { returnedDate: "2026-10-05" });
  await admin("POST", `/api/loans/${l1.id}/undo-return`, { reason: "data errata" });
  const l2 = (await admin("POST", `/api/books/${id}/loans`, { borrower: "B", contact: "", loanDate: "2026-10-02", plannedDays: 10, notes: "" })).json;
  await admin("POST", `/api/loans/${l2.id}/void`, { reason: "registrato per errore" });
  return id;
}

describe("cancellazione definitiva di una scheda con storico", () => {
  it("la cancellazione normale resta rifiutata (409 has_loans); quella completa richiede il titolo esatto", async () => {
    const id = await bookWithHistory("Da eliminare");
    const plain = await admin("DELETE", `/api/books/${id}`);
    expect(plain.status).toBe(409);
    expect(plain.json.error.code).toBe("has_loans");
    expect((await admin("DELETE", `/api/books/${id}?withHistory=1`, { confirmTitle: "Altro titolo" })).status).toBe(400);
    expect((await admin("DELETE", `/api/books/${id}?withHistory=1`, {})).status).toBe(400);
    expect(await count(`select count(*) n from books where id = $1`, [id])).toBe(1); // nulla è sparito
  });

  it("con il titolo esatto cancella scheda, copie, prestiti e correzioni — e solo di quella scheda", async () => {
    const keep = await bookWithHistory("Da tenere");
    const id = await bookWithHistory("Da cancellare");
    const before = await count(`select count(*) n from loan_corrections`);
    const r = await admin("DELETE", `/api/books/${id}?withHistory=1`, { confirmTitle: " Da cancellare " });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ deleted: true, loans: 2, corrections: 2, copies: 2 });
    expect(await count(`select count(*) n from books where id = $1`, [id])).toBe(0);
    expect(await count(`select count(*) n from book_copies where book_id = $1`, [id])).toBe(0);
    expect(await count(`select count(*) n from loans where book_id = $1`, [id])).toBe(0);
    expect(await count(`select count(*) n from loan_corrections`)).toBe(before - 2);
    // l'altra scheda è intatta
    expect(await count(`select count(*) n from loans where book_id = $1`, [keep])).toBe(2);
    expect((await admin("GET", `/api/books/${keep}`)).status).toBe(200);
    expect((await admin("DELETE", `/api/books/${id}?withHistory=1`, { confirmTitle: "Da cancellare" })).status).toBe(404);
  });

  it("il visualizzatore non può cancellare; la traccia resta immutabile fuori da questa operazione", async () => {
    const id = await bookWithHistory("Protetta");
    expect((await viewer("DELETE", `/api/books/${id}?withHistory=1`, { confirmTitle: "Protetta" })).status).toBe(403);
    await expect(raw.query(`delete from loan_corrections`)).rejects.toThrow(/non può essere modificata né cancellata/);
    await expect(raw.query(`update loan_corrections set reason = 'xxx'`)).rejects.toThrow(/non può essere modificata né cancellata/);
    expect(await count(`select count(*) n from books where id = $1`, [id])).toBe(1);
  });
});
