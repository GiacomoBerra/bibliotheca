// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { summarizeAvailability } from "../src/lib/api/loans";
import type { Db } from "./db";
import * as loansRepo from "./loansRepo";
import { api, makeDeps, makeTestDb } from "./testHarness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

let raw: PGlite; let db: Db; let call: ReturnType<typeof api>;
let TODAY = "2026-10-15";
const queries: string[] = [];
beforeAll(async () => {
  const t = await makeTestDb(); raw = t.raw;
  db = { query: async (text, params) => { queries.push(text); try { return await t.db.query(text, params); } catch (e) { throw new Error(`${String(e)} :: ${text.slice(0, 120)}`); } } };
  call = api(makeDeps(db, { today: () => TODAY }));
});
afterAll(async () => { await raw.close(); });

const ADMIN = "admin-1", VIEWER = "viewer-1";
const admin = (m: string, p: string, body?: object) => call(m, p, { user: ADMIN, roles: ["admin"], ...(body ? { body } : {}) });
const viewer = (m: string, p: string) => call(m, p, { user: VIEWER, roles: ["viewer"] });
const newBook = async (title: string, extra: object = {}) => (await admin("POST", "/api/books", { title, ...extra })).json.id as string;
const lend = (bookId: string, over: object = {}) => admin("POST", `/api/books/${bookId}/loans`, { borrower: "Marta Rossi", contact: "m@example.org", notes: "nota privata", loanDate: "2026-10-01", plannedDays: 14, ...over });
const avail = async (id: string, who = admin) => (await who("GET", "/api/books?pageSize=100")).json.availability[id];
const input = (borrower: string, loanDate = "2026-10-01", plannedDays = 14) => ({ borrower, contact: "", loanDate, plannedDays, notes: "" });

describe("regola di calcolo (pura)", () => {
  it("priorità: in ritardo > disponibilità parziale > in prestito > disponibile; almeno una copia", () => {
    expect(summarizeAvailability(0, 0, 0)).toEqual({ state: "disponibile", totalCopies: 1, availableCopies: 1 });
    expect(summarizeAvailability(1, 1, 0)).toEqual({ state: "in prestito", totalCopies: 1, availableCopies: 0 });
    expect(summarizeAvailability(1, 1, 1).state).toBe("in ritardo");
    expect(summarizeAvailability(3, 1, 0)).toEqual({ state: "disponibilità parziale", totalCopies: 3, availableCopies: 2 });
    expect(summarizeAvailability(3, 3, 0).state).toBe("in prestito");
    expect(summarizeAvailability(3, 2, 1).state).toBe("in ritardo");
    expect(summarizeAvailability(2, 5, 0)).toMatchObject({ availableCopies: 0 }); // dati incoerenti non producono numeri negativi
  });
});

describe("Stato prestito nel catalogo (Postgres reale)", () => {
  it("1–4: senza prestiti disponibile; attivo non scaduto in prestito; attivo scaduto in ritardo; solo storico disponibile", async () => {
    const free = await newBook("Libero"), out = await newBook("Fuori"), late = await newBook("Scaduto"), past = await newBook("Storico");
    await lend(out, { loanDate: "2026-10-10", plannedDays: 30 });
    await lend(late, { loanDate: "2026-09-01", plannedDays: 10 });
    const p = (await lend(past)).json;
    await admin("POST", `/api/loans/${p.id}/return`, { returnedDate: "2026-10-05" });
    expect(await avail(free)).toEqual({ state: "disponibile", totalCopies: 1, availableCopies: 1 });
    expect(await avail(out)).toEqual({ state: "in prestito", totalCopies: 1, availableCopies: 0 });
    expect(await avail(late)).toMatchObject({ state: "in ritardo", availableCopies: 0 });
    expect(await avail(past)).toMatchObject({ state: "disponibile", availableCopies: 1 });
  });

  it("regola del ritardo e fuso: il giorno stesso della scadenza NON è in ritardo, il giorno dopo sì", async () => {
    const id = await newBook("Scadenza");
    await lend(id, { loanDate: "2026-11-01", plannedDays: 10 }).then(async (r) => { expect(r.status).toBe(400); }); // data futura rispetto a TODAY: rifiutata
    TODAY = "2026-11-01"; await lend(id, { loanDate: "2026-11-01", plannedDays: 10 }); // scade il 11/11
    TODAY = "2026-11-11"; expect((await avail(id))!.state).toBe("in prestito");
    TODAY = "2026-11-12"; expect((await avail(id))!.state).toBe("in ritardo");
    TODAY = "2026-10-15";
  });

  it("5: un prestito annullato non rende il libro «in prestito» né «in ritardo»", async () => {
    const id = await newBook("Annullato");
    const l = (await lend(id, { loanDate: "2026-09-01", plannedDays: 5 })).json;
    expect((await avail(id))!.state).toBe("in ritardo");
    await admin("POST", `/api/loans/${l.id}/void`, { reason: "registrato per errore" });
    expect(await avail(id)).toEqual({ state: "disponibile", totalCopies: 1, availableCopies: 1 });
    const other = (await lend(id, { borrower: "Nuovo", loanDate: "2026-10-10", plannedDays: 30 })).json; // la copia è di nuovo prestabile
    expect((await avail(id))!.state).toBe("in prestito");
    await admin("POST", `/api/loans/${other.id}/return`, {});
    expect((await avail(id))!.state).toBe("disponibile");
  });

  it("6: più copie fisiche — conteggio, disponibilità parziale, ritardo di una sola copia, tutte fuori", async () => {
    const id = await newBook("Due copie");
    const three = await newBook("Tre copie");
    await raw.query(`insert into book_copies (book_id, copy_no) values ($1, 2), ($2, 1), ($2, 2), ($2, 3)`, [id, three]);
    expect(await avail(id)).toEqual({ state: "disponibile", totalCopies: 2, availableCopies: 2 });
    const a = await loansRepo.createLoan(db, ADMIN, id, input("A", "2026-10-10", 30), TODAY, 1);
    expect(await avail(id)).toEqual({ state: "disponibilità parziale", totalCopies: 2, availableCopies: 1 });
    const b = await loansRepo.createLoan(db, ADMIN, id, input("B", "2026-10-11", 30), TODAY, 2);
    expect(await avail(id)).toEqual({ state: "in prestito", totalCopies: 2, availableCopies: 0 });
    await loansRepo.returnLoan(db, ADMIN, a.id, null, TODAY);
    expect((await avail(id))!.state).toBe("disponibilità parziale");
    await loansRepo.returnLoan(db, ADMIN, b.id, null, TODAY);
    expect((await avail(id))!.state).toBe("disponibile");
    // tre copie: una scaduta e due libere = «in ritardo» con 2 di 3 disponibili
    await loansRepo.createLoan(db, ADMIN, three, input("C", "2026-09-01", 5), TODAY, 3);
    expect(await avail(three)).toEqual({ state: "in ritardo", totalCopies: 3, availableCopies: 2 });
  });

  it("7: si aggiorna dopo prestito, restituzione, annullamento del prestito e correzione della restituzione", async () => {
    const id = await newBook("Ciclo");
    const states: string[] = [(await avail(id))!.state];
    const l = (await lend(id, { loanDate: "2026-10-10", plannedDays: 30 })).json; states.push((await avail(id))!.state);
    await admin("POST", `/api/loans/${l.id}/return`, { returnedDate: "2026-10-12" }); states.push((await avail(id))!.state);
    await admin("POST", `/api/loans/${l.id}/undo-return`, { reason: "data errata" }); states.push((await avail(id))!.state);
    await admin("POST", `/api/loans/${l.id}/void`, { reason: "registrato per errore" }); states.push((await avail(id))!.state);
    expect(states).toEqual(["disponibile", "in prestito", "disponibile", "in prestito", "disponibile"]);
  });

  it("8–9: admin e viewer vedono lo stesso risultato; il viewer non riceve alcun dato personale", async () => {
    const id = await newBook("Privacy catalogo");
    await lend(id, { borrower: "Nome Riservatissimo", contact: "tel 0791234567", notes: "nota privata", loanDate: "2026-09-01", plannedDays: 5 });
    const a = await admin("GET", "/api/books?pageSize=100"), v = await viewer("GET", "/api/books?pageSize=100");
    expect(v.status).toBe(200);
    expect(v.json.availability).toEqual(a.json.availability);
    expect(v.json.availability[id].state).toBe("in ritardo");
    const body = JSON.stringify(v.json);
    expect(body).not.toMatch(/Nome Riservatissimo|tel 0791234567|nota privata|m@example\.org|admin-1/);
    expect(Object.keys(v.json.availability[id]).sort()).toEqual(["availableCopies", "state", "totalCopies"]);
    // il filtro non apre vie traverse: il viewer può filtrare, ma resta senza dati personali e non può scrivere
    const f = await viewer("GET", "/api/books?loan=in%20ritardo");
    expect(f.status).toBe(200);
    expect(JSON.stringify(f.json)).not.toMatch(/Nome Riservatissimo/);
    expect((await viewer("GET", "/api/loans")).status).toBe(403);
    expect((await call("GET", "/api/books")).status).toBe(401);
  });

  it("10: filtri per disponibilità (e combinati con ricerca, stato scheda, paginazione) con totali corretti", async () => {
    const mk = async (t: string) => newBook(`Filtro ${t}`, { status: "catalogato" });
    const d = await mk("alfa"), p = await mk("beta"), r = await mk("gamma"), par = await mk("delta"), d2 = await mk("epsilon");
    await lend(p, { loanDate: "2026-10-10", plannedDays: 30 });
    await lend(r, { loanDate: "2026-09-01", plannedDays: 5 });
    await raw.query(`insert into book_copies (book_id, copy_no) values ($1, 1), ($1, 2)`, [par]);
    await loansRepo.createLoan(db, ADMIN, par, input("P", "2026-10-10", 30), TODAY, 1);
    const ids = async (q: string) => (await admin("GET", `/api/books?${q}&query=Filtro&pageSize=100`)).json.items.map((b: any) => b.id).sort();
    expect(await ids("loan=tutti")).toEqual([d, p, r, par, d2].sort());
    expect(await ids("loan=disponibili")).toEqual([d, d2].sort());
    expect(await ids("loan=in%20prestito")).toEqual([p]);
    expect(await ids("loan=in%20ritardo")).toEqual([r]);
    expect(await ids("loan=parziale")).toEqual([par]);
    expect(await ids("loan=sconosciuto")).toHaveLength(5); // valore non valido = nessun filtro
    // ricerca + filtro + stato scheda
    const c = (await admin("GET", `/api/books?loan=disponibili&query=epsilon&status=catalogato`)).json;
    expect(c.total).toBe(1); expect(c.items[0].id).toBe(d2);
    expect((await admin("GET", `/api/books?loan=disponibili&query=epsilon&status=bozza`)).json.total).toBe(0);
    // paginazione: il totale riguarda il filtro, non la pagina
    const pg = (await admin("GET", `/api/books?loan=disponibili&query=Filtro&pageSize=1&page=2`)).json;
    expect(pg.total).toBe(2); expect(pg.items).toHaveLength(1); expect(Object.keys(pg.availability)).toEqual([pg.items[0].id]);
  });

  it("prestazioni: il numero di query non dipende dal numero di libri (nessuna query per libro)", async () => {
    for (let i = 0; i < 30; i++) await newBook(`Massa ${i}`);
    const count = async (url: string) => { queries.length = 0; const r = await admin("GET", url); expect(r.status, JSON.stringify(r.json) + queries.join(' | ')).toBe(200); return queries.length; };
    const few = await count("/api/books?query=Massa&pageSize=2");
    const many = await count("/api/books?query=Massa&pageSize=30");
    expect(many).toBe(few);
    expect(many).toBeLessThanOrEqual(6); // sessione/ruolo esclusi: conteggio, elenco, disponibilità
    const filtered = await count("/api/books?query=Massa&pageSize=30&loan=disponibili");
    expect(filtered).toBe(many);
  });
});
