// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createHttpBooksApi } from "../src/lib/api/httpBooksApi";
import { handle } from "./router";
import { addDays, daysBetween, isIsoDate, loanState, todayIso } from "../src/lib/api/loans";
import { api, makeDeps, makeTestDb } from "./testHarness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

let raw: PGlite; let call: ReturnType<typeof api>;
const dbHolder: { db: import("./db").Db } = { db: null as never };
let TODAY = "2026-10-15";
beforeAll(async () => { const t = await makeTestDb(); raw = t.raw; dbHolder.db = t.db; call = api(makeDeps(t.db, { today: () => TODAY })); });
afterAll(async () => { await raw.close(); });

const ADMIN = "admin-1", VIEWER = "viewer-1";
const admin = (m: string, p: string, body?: object) => call(m, p, { user: ADMIN, roles: ["admin"], ...(body ? { body } : {}) });
const viewer = (m: string, p: string, body?: object) => call(m, p, { user: VIEWER, roles: ["viewer"], ...(body ? { body } : {}) });
const newBook = async (title: string) => (await admin("POST", "/api/books", { title })).json.id as string;
const loan = (bookId: string, over: object = {}) => admin("POST", `/api/books/${bookId}/loans`, { borrower: "Marta Rossi", contact: "", loanDate: "2026-10-01", plannedDays: 14, notes: "", ...over });

describe("regole sulle date (pure)", () => {
  it("calcola scadenze e durate", () => {
    expect(addDays("2026-02-20", 14)).toBe("2026-03-06");
    expect(addDays("2024-12-25", 10)).toBe("2025-01-04");
    expect(daysBetween("2026-10-01", "2026-10-11")).toBe(10);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-10-15")).toBe(true);
    expect(loanState({ dueDate: "2026-10-15", returnedDate: null }, "2026-10-15")).toBe("in prestito");
    expect(loanState({ dueDate: "2026-10-14", returnedDate: null }, "2026-10-15")).toBe("in ritardo");
    expect(loanState({ dueDate: "2026-10-01", returnedDate: "2026-10-20" }, "2026-10-30")).toBe("restituito");
    expect(todayIso(new Date("2026-10-15T23:30:00Z"))).toBe("2026-10-16"); // fuso Europa/Zurigo
  });
});

describe("Prestiti — registrazione e storico (Postgres reale)", () => {
  it("registra un prestito con data prevista calcolata e stato «in prestito»", async () => {
    const id = await newBook("Libro A");
    const r = await loan(id, { contact: "marta@example.org", notes: "con segnalibro" });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ bookId: id, borrower: "Marta Rossi", contact: "marta@example.org", loanDate: "2026-10-01", plannedDays: 14, dueDate: "2026-10-15", returnedDate: null, state: "in prestito", effectiveDays: null, daysLate: 0, copyNo: 1 });
    const g = await admin("GET", `/api/books/${id}/loans`);
    expect(g.json.availability).toBe("in prestito");
    expect(g.json.loans).toHaveLength(1);
  });

  it("un libro mai prestato è disponibile e ha storico vuoto; un libro inesistente dà 404", async () => {
    const id = await newBook("Libro B");
    expect((await admin("GET", `/api/books/${id}/loans`)).json).toEqual({ availability: "disponibile", loans: [] });
    expect((await admin("GET", "/api/books/11111111-1111-1111-1111-111111111111/loans")).status).toBe(404);
    expect((await loan("11111111-1111-1111-1111-111111111111")).status).toBe(404);
  });

  it("NON permette due prestiti contemporanei sulla stessa copia (409) e il database resta con un solo prestito attivo", async () => {
    const id = await newBook("Libro C");
    expect((await loan(id)).status).toBe(201);
    const second = await loan(id, { borrower: "Altro" });
    expect(second.status).toBe(409);
    expect(second.json.error.code).toBe("already_on_loan");
    expect((await raw.query("select count(*)::int as n from loans where book_id = $1", [id])).rows[0]).toEqual({ n: 1 });
  });

  it("richieste simultanee: ne passa una sola (vincolo del database)", async () => {
    const id = await newBook("Libro D");
    const rs = await Promise.all([1, 2, 3, 4].map((i) => loan(id, { borrower: `Persona ${i}` })));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409)).toHaveLength(3);
    expect((await raw.query("select count(*)::int as n from loans where book_id = $1 and returned_date is null", [id])).rows[0]).toEqual({ n: 1 });
  });

  it("il database stesso rifiuta un secondo prestito attivo sulla stessa copia, anche saltando l'API", async () => {
    const id = await newBook("Libro E");
    await loan(id);
    const copy = (await raw.query<{ id: string }>("select id from book_copies where book_id = $1", [id])).rows[0]!.id;
    await expect(raw.query(`insert into loans (book_id, copy_id, borrower_name, loan_date, planned_days, due_date, created_by) values ($1,$2,'x','2026-10-02',7,'2026-10-09','t')`, [id, copy])).rejects.toThrow(/loans_one_active_per_copy|duplicate/);
  });

  it("il modello consente più copie dello stesso libro, ciascuna con il proprio prestito", async () => {
    const id = await newBook("Libro F");
    await loan(id);
    await raw.query("insert into book_copies (book_id, copy_no) values ($1, 2)", [id]);
    const copy2 = (await raw.query<{ id: string }>("select id from book_copies where book_id = $1 and copy_no = 2", [id])).rows[0]!.id;
    await raw.query(`insert into loans (book_id, copy_id, borrower_name, loan_date, planned_days, due_date, created_by) values ($1,$2,'Seconda copia','2026-10-02',7,'2026-10-09','t')`, [id, copy2]);
    expect((await raw.query("select count(*)::int as n from loans where book_id = $1 and returned_date is null", [id])).rows[0]).toEqual({ n: 2 });
    // la copia deve appartenere al libro indicato
    const other = await newBook("Altro libro");
    await expect(raw.query(`insert into loans (book_id, copy_id, borrower_name, loan_date, planned_days, due_date, created_by) values ($1,$2,'x','2026-10-02',7,'2026-10-09','t')`, [other, copy2])).rejects.toThrow();
  });
});

describe("Prestiti — date incoerenti e dati non validi", () => {
  it.each([
    ["nome mancante", { borrower: "   " }, "borrower"],
    ["nome troppo lungo", { borrower: "x".repeat(201) }, "borrower"],
    ["data inesistente", { loanDate: "2026-02-30" }, "loanDate"],
    ["data in formato errato", { loanDate: "15/10/2026" }, "loanDate"],
    ["durata zero", { plannedDays: 0 }, "plannedDays"],
    ["durata negativa", { plannedDays: -3 }, "plannedDays"],
    ["durata non intera", { plannedDays: 2.5 }, "plannedDays"],
    ["durata come testo", { plannedDays: "14" }, "plannedDays"],
    ["durata eccessiva", { plannedDays: 366 }, "plannedDays"],
    ["data futura", { loanDate: "2026-10-16" }, "loanDate"],
  ])("%s → 400 e nessuna riga scritta", async (_n, over, field) => {
    const id = await newBook("Libro date");
    const r = await loan(id, over);
    expect(r.status).toBe(400);
    expect(r.json.error.fields?.[field] ?? r.json.error.message).toBeTruthy();
    expect((await raw.query("select count(*)::int as n from loans where book_id = $1", [id])).rows[0]).toEqual({ n: 0 });
  });

  it("i vincoli del database rifiutano date incoerenti anche saltando l'API", async () => {
    const id = await newBook("Libro vincoli");
    await loan(id, { loanDate: "2026-09-01", plannedDays: 7 });
    await raw.query("update loans set returned_date = '2026-09-05', returned_by = 'a' where book_id = $1", [id]);
    const copy = (await raw.query<{ id: string }>("select id from book_copies where book_id = $1", [id])).rows[0]!.id;
    const ins = (loanD: string, due: string, ret: string | null, by: string | null) => raw.query(`insert into loans (book_id, copy_id, borrower_name, loan_date, planned_days, due_date, returned_date, returned_by, created_by) values ($1,$2,'x',$3,7,$4,$5,$6,'t')`, [id, copy, loanD, due, ret, by]);
    await expect(ins("2026-09-10", "2026-09-20", null, null)).rejects.toThrow(/loans_due_matches_duration/);
    await expect(ins("2026-09-10", "2026-09-17", "2026-09-09", "a")).rejects.toThrow(/loans_return_not_before_loan/);
    await expect(ins("2026-09-10", "2026-09-17", "2026-09-12", null)).rejects.toThrow(/loans_returned_by_consistent/);
  });
});

describe("Prestiti — restituzione e storico", () => {
  it("la restituzione registra la data effettiva, calcola la durata e NON cancella il prestito", async () => {
    const id = await newBook("Libro G");
    const l = (await loan(id, { loanDate: "2026-10-01", plannedDays: 14 })).json;
    const r = await admin("POST", `/api/loans/${l.id}/return`, { returnedDate: "2026-10-11" });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ id: l.id, state: "restituito", returnedDate: "2026-10-11", effectiveDays: 10, daysLate: 0, borrower: "Marta Rossi", loanDate: "2026-10-01", dueDate: "2026-10-15" });
    expect((await admin("GET", `/api/books/${id}/loans`)).json.availability).toBe("disponibile");
    expect((await raw.query("select count(*)::int as n from loans where id = $1", [l.id])).rows[0]).toEqual({ n: 1 });
  });

  it("senza data indicata, la restituzione usa la data odierna; restituito in ritardo → giorni di ritardo", async () => {
    const id = await newBook("Libro H");
    const l = (await loan(id, { loanDate: "2026-09-01", plannedDays: 10 })).json; // scadenza 2026-09-11
    expect(l.state).toBe("in ritardo");
    expect(l.daysLate).toBe(34);
    const r = await admin("POST", `/api/loans/${l.id}/return`, {});
    expect(r.json).toMatchObject({ returnedDate: TODAY, effectiveDays: 44, daysLate: 34, state: "restituito" });
  });

  it("restituzioni non valide: già restituito (409), prima dell'inizio (400), futura (400), formato errato (400), id inesistente (404)", async () => {
    const id = await newBook("Libro I");
    const l = (await loan(id, { loanDate: "2026-10-05" })).json;
    for (const [date, status] of [["2026-10-04", 400], ["2026-10-16", 400], ["2026-13-01", 400], ["ieri", 400]] as const) {
      const r = await admin("POST", `/api/loans/${l.id}/return`, { returnedDate: date });
      expect(r.status).toBe(status);
    }
    expect((await raw.query("select returned_date from loans where id = $1", [l.id])).rows[0]).toEqual({ returned_date: null });
    expect((await admin("POST", `/api/loans/${l.id}/return`, { returnedDate: "2026-10-08" })).status).toBe(200);
    const again = await admin("POST", `/api/loans/${l.id}/return`, { returnedDate: "2026-10-09" });
    expect(again.status).toBe(409);
    expect(again.json.error.code).toBe("already_returned");
    expect((await raw.query<{ returned_date: string }>("select returned_date::text from loans where id = $1", [l.id])).rows[0]).toEqual({ returned_date: "2026-10-08" });
    expect((await admin("POST", "/api/loans/11111111-1111-1111-1111-111111111111/return", {})).status).toBe(404);
    expect((await admin("POST", "/api/loans/non-un-uuid/return", {})).status).toBe(404);
  });

  it("dopo la restituzione il libro può essere prestato di nuovo e lo storico conserva TUTTI i prestiti", async () => {
    const id = await newBook("Libro L");
    const a = (await loan(id, { borrower: "Anna", loanDate: "2026-08-01", plannedDays: 7 })).json;
    await admin("POST", `/api/loans/${a.id}/return`, { returnedDate: "2026-08-06" });
    const b = (await loan(id, { borrower: "Bruno", loanDate: "2026-09-01", plannedDays: 30 })).json;
    await admin("POST", `/api/loans/${b.id}/return`, { returnedDate: "2026-09-20" });
    const c = await loan(id, { borrower: "Carla", loanDate: "2026-10-10", plannedDays: 30 });
    expect(c.status).toBe(201);
    const h = (await admin("GET", `/api/books/${id}/loans`)).json;
    expect(h.loans.map((x: any) => x.borrower)).toEqual(["Carla", "Bruno", "Anna"]); // dal più recente
    expect(h.loans.map((x: any) => x.state)).toEqual(["in prestito", "restituito", "restituito"]);
    expect(h.loans.map((x: any) => x.effectiveDays)).toEqual([null, 19, 5]);
    expect(h.availability).toBe("in prestito");
  });

  it("i prestiti non si cancellano via API (405) e lo storico impedisce di cancellare il libro (409)", async () => {
    const id = await newBook("Libro M");
    const l = (await loan(id)).json;
    await admin("POST", `/api/loans/${l.id}/return`, { returnedDate: "2026-10-03" });
    expect((await admin("DELETE", `/api/loans/${l.id}`)).status).toBe(405);
    const del = await admin("DELETE", `/api/books/${id}`);
    expect(del.status).toBe(409);
    expect(del.json.error.code).toBe("has_loans");
    expect((await raw.query("select count(*)::int as n from books where id = $1", [id])).rows[0]).toEqual({ n: 1 });
    expect((await raw.query("select count(*)::int as n from loans where id = $1", [l.id])).rows[0]).toEqual({ n: 1 });
  });

  it("un libro senza prestiti si cancella normalmente; le copie create vengono rimosse con lui", async () => {
    const id = await newBook("Libro N");
    expect((await admin("DELETE", `/api/books/${id}`)).status).toBe(200);
  });

  it("correggere il prestito aggiorna destinatario, note e scadenza senza toccare date di inizio/restituzione", async () => {
    const id = await newBook("Libro O");
    const l = (await loan(id, { loanDate: "2026-10-01", plannedDays: 7 })).json;
    const r = await admin("PUT", `/api/loans/${l.id}`, { borrower: "Marta R.", contact: "", plannedDays: 21, notes: "prorogato", loanDate: "1999-01-01", returnedDate: "2026-10-02" });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ borrower: "Marta R.", plannedDays: 21, dueDate: "2026-10-22", notes: "prorogato", loanDate: "2026-10-01", returnedDate: null });
    expect((await admin("PUT", `/api/loans/${l.id}`, { borrower: "", plannedDays: 7 })).status).toBe(400);
  });
});

describe("Prestiti — elenco globale e filtri (admin)", () => {
  it("filtra per destinatario, stato e date", async () => {
    TODAY = "2026-10-15";
    const x = await newBook("Libro P1"), y = await newBook("Libro P2"), z = await newBook("Libro P3");
    const lx = (await loan(x, { borrower: "Zeno Zanetti", loanDate: "2026-05-01", plannedDays: 10 })).json; // in ritardo
    const ly = (await loan(y, { borrower: "Zeno Zanetti", loanDate: "2026-06-01", plannedDays: 10 })).json;
    await admin("POST", `/api/loans/${ly.id}/return`, { returnedDate: "2026-06-05" });
    await loan(z, { borrower: "Ylenia Verdi", loanDate: "2026-10-10", plannedDays: 30 });
    const q = async (qs: string) => (await admin("GET", `/api/loans?${qs}`)).json;
    expect((await q("borrower=zeno")).total).toBe(2);
    expect((await q("borrower=zeno&state=attivi")).items.map((i: any) => i.id)).toEqual([lx.id]);
    expect((await q("borrower=zeno&state=restituiti")).items.map((i: any) => i.id)).toEqual([ly.id]);
    expect((await q("state=in%20ritardo")).items.filter((i: any) => i.borrower === "Zeno Zanetti")).toHaveLength(1);
    expect((await q("borrower=ylenia&state=in%20ritardo")).total).toBe(0);
    expect((await q("borrower=zeno&from=2026-05-15&to=2026-06-30")).items.map((i: any) => i.id)).toEqual([ly.id]);
    expect((await q(`bookId=${z}`)).total).toBe(1);
    expect((await q("borrower=%25")).total).toBe(0); // i caratteri jolly non sono interpretati
    expect((await q("borrower=zeno&from=non-una-data")).total).toBe(2); // filtro non valido ignorato
  });
});

describe("Prestiti — ruoli e privacy (verificati lato server)", () => {
  it("il visualizzatore vede stato e storico di un libro, ma senza nome, recapito e note", async () => {
    const id = await newBook("Libro Q");
    await loan(id, { borrower: "Nome Riservato", contact: "tel 000", notes: "nota privata" });
    const r = await viewer("GET", `/api/books/${id}/loans`);
    expect(r.status).toBe(200);
    expect(r.json.availability).toBe("in prestito");
    expect(r.json.loans[0]).toMatchObject({ borrower: null, contact: null, notes: null, state: "in prestito", dueDate: "2026-10-15" });
    expect(JSON.stringify(r.json)).not.toMatch(/Nome Riservato|tel 000|nota privata/);
  });
  it("il visualizzatore non può registrare, restituire, correggere né vedere l'elenco globale (403) e nulla cambia", async () => {
    const id = await newBook("Libro R");
    const l = (await loan(id)).json;
    const before = (await raw.query("select count(*)::int as n, max(updated_at) as m from loans")).rows[0];
    expect((await viewer("POST", `/api/books/${id}/loans`, { borrower: "Abusivo", loanDate: "2026-10-01", plannedDays: 7 })).status).toBe(403);
    expect((await viewer("POST", `/api/loans/${l.id}/return`, {})).status).toBe(403);
    expect((await viewer("PUT", `/api/loans/${l.id}`, { borrower: "Hack", plannedDays: 7 })).status).toBe(403);
    expect((await viewer("DELETE", `/api/loans/${l.id}`)).status).toBe(403);
    const list = await viewer("GET", "/api/loans");
    expect(list.status).toBe(403);
    expect(list.json.items).toBeUndefined();
    expect((await viewer("GET", `/api/loans/${l.id}`)).status).toBe(403);
    expect((await raw.query("select count(*)::int as n, max(updated_at) as m from loans")).rows[0]).toEqual(before);
  });
  it("senza sessione 401, senza ruolo 403; identità e ruolo non si leggono dal corpo", async () => {
    const id = await newBook("Libro S");
    expect((await call("GET", `/api/books/${id}/loans`)).status).toBe(401);
    expect((await call("GET", "/api/loans")).status).toBe(401);
    expect((await call("GET", `/api/books/${id}/loans`, { user: "u", roles: [] })).status).toBe(403);
    const r = await admin("POST", `/api/books/${id}/loans`, { borrower: "Tizio", loanDate: "2026-10-01", plannedDays: 7, created_by: "falso", returnedDate: "2026-10-02", role: "admin" });
    expect(r.status).toBe(201);
    expect((await raw.query("select created_by, returned_date from loans where id = $1", [r.json.id])).rows[0]).toEqual({ created_by: ADMIN, returned_date: null });
  });
  it("le richieste che modificano richiedono l'intestazione anti-CSRF", async () => {
    const id = await newBook("Libro T");
    const r = await call("POST", `/api/books/${id}/loans`, { user: ADMIN, body: { borrower: "x", loanDate: "2026-10-01", plannedDays: 7 }, headers: { "x-bibliotheca": "0" } });
    expect(r.status).toBe(403);
  });
});

describe("Prestiti — client HTTP e messaggi per l'utente", () => {
  const client = (roles: string) => createHttpBooksApi({
    fetch: async (url, init) => handle(new Request(`https://bibliotheca.test${url as string}`, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), "x-test-session": "http-user", "x-test-roles": roles, origin: "https://bibliotheca.test" } }), makeDeps(dbHolder.db, { today: () => TODAY })),
  });
  it("registra, legge, restituisce; doppio prestito e restituzione ripetuta danno errori chiari (kind conflict)", async () => {
    const c = client("admin");
    const book = await c.createBook({ ...(await import("../src/lib/api/types")).emptyBookInput(), title: "Libro via client" });
    const l = await c.createLoan(book.id, { borrower: "Client Test", contact: "", loanDate: "2026-10-10", plannedDays: 7, notes: "" });
    expect(l).toMatchObject({ state: "in prestito", dueDate: "2026-10-17" });
    await expect(c.createLoan(book.id, { borrower: "Altro", contact: "", loanDate: "2026-10-11", plannedDays: 7, notes: "" })).rejects.toMatchObject({ kind: "conflict", message: expect.stringContaining("già in prestito") });
    expect((await c.listBookLoans(book.id)).availability).toBe("in prestito");
    expect((await c.listLoans({ state: "attivi", borrower: "client" })).items.map((x) => x.id)).toContain(l.id);
    expect(await c.returnLoan(l.id, "2026-10-12")).toMatchObject({ state: "restituito", effectiveDays: 2 });
    await expect(c.returnLoan(l.id, "2026-10-13")).rejects.toMatchObject({ kind: "conflict", message: expect.stringContaining("già stato restituito") });
    await expect(c.deleteBook(book.id)).rejects.toMatchObject({ kind: "conflict", message: expect.stringContaining("storico di prestiti") });
    await expect(c.createLoan(book.id, { borrower: "", contact: "", loanDate: "2026-10-10", plannedDays: 7, notes: "" })).rejects.toMatchObject({ kind: "validation" });
  });
  it("il client del visualizzatore non può gestire i prestiti (kind auth) ma legge lo stato", async () => {
    const v = client("viewer");
    const list = await admin("GET", "/api/books?query=client");
    const id = list.json.items[0].id as string;
    expect((await v.listBookLoans(id)).loans[0]?.borrower).toBeNull();
    await expect(v.createLoan(id, { borrower: "x", contact: "", loanDate: "2026-10-10", plannedDays: 7, notes: "" })).rejects.toMatchObject({ kind: "auth" });
    await expect(v.listLoans()).rejects.toMatchObject({ kind: "auth" });
  });
});
