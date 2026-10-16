// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { booksToJson } from "../src/lib/export";
import { parseBackup } from "../src/lib/backup";
import { api, makeDeps, makeTestDb } from "./testHarness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

let raw: PGlite; let call: ReturnType<typeof api>;
const TODAY = "2026-10-15";
beforeAll(async () => { const t = await makeTestDb(); raw = t.raw; call = api(makeDeps(t.db, { today: () => TODAY })); });
afterAll(async () => { await raw.close(); });

const ADMIN = "admin-1", OTHER_ADMIN = "admin-2", VIEWER = "viewer-1";
const as = (user: string, roles: string[]) => (m: string, p: string, body?: object) => call(m, p, { user, roles, ...(body ? { body } : {}) });
const admin = as(ADMIN, ["admin"]), admin2 = as(OTHER_ADMIN, ["admin"]), viewer = as(VIEWER, ["viewer"]);
const newBook = async (title: string) => (await admin("POST", "/api/books", { title })).json.id as string;
const lend = (bookId: string, over: object = {}) => admin("POST", `/api/books/${bookId}/loans`, { borrower: "Marta Rossi", contact: "m@example.org", loanDate: "2026-10-01", plannedDays: 14, notes: "", ...over });
const giveBack = (id: string, returnedDate?: string) => admin("POST", `/api/loans/${id}/return`, returnedDate ? { returnedDate } : {});
const rows = async (sql: string, p: unknown[] = []) => (await raw.query<any>(sql, p)).rows;
const corrections = (loanId: string) => rows(`select * from loan_corrections where loan_id = $1 order by seq`, [loanId]);

describe("Restituzione: azione chiara, stato e storico dal database", () => {
  it("restituisce con data effettiva, calcola durata e ritardo, la copia torna disponibile e un nuovo prestito è possibile", async () => {
    const b = await newBook("Restituzione");
    const l = (await lend(b, { loanDate: "2026-09-01", plannedDays: 10 })).json; // scadenza 11/09
    expect((await admin("GET", `/api/books/${b}/loans`)).json.availability).toBe("restituzione in ritardo");
    const r = await giveBack(l.id, "2026-09-14");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ state: "restituito", returnedDate: "2026-09-14", effectiveDays: 13, daysLate: 3 });
    expect((await admin("GET", `/api/books/${b}/loans`)).json).toMatchObject({ availability: "disponibile" });
    expect((await lend(b, { borrower: "Luca", loanDate: "2026-10-02" })).status).toBe(201);
    const hist = (await admin("GET", `/api/books/${b}/loans`)).json.loans;
    expect(hist).toHaveLength(2);
    expect(hist.find((x: any) => x.id === l.id)).toMatchObject({ state: "restituito", borrower: "Marta Rossi" }); // storico conservato
  });
  it("data di default = oggi; non nel futuro, non prima dell'inizio; seconda restituzione rifiutata senza modificare la prima", async () => {
    const b = await newBook("Date");
    const l = (await lend(b)).json;
    expect((await giveBack(l.id, "2026-10-16")).status).toBe(400);
    expect((await giveBack(l.id, "2026-09-30")).status).toBe(400);
    expect((await giveBack(l.id)).json.returnedDate).toBe(TODAY);
    const again = await giveBack(l.id, "2026-10-03");
    expect(again.status).toBe(409);
    expect((await admin("GET", `/api/loans/${l.id}`)).json.returnedDate).toBe(TODAY);
  });
  it("due prestiti attivi sulla stessa copia: rifiutato anche con richieste simultanee", async () => {
    const b = await newBook("Simultanei");
    const res = await Promise.all([lend(b, { borrower: "A" }), lend(b, { borrower: "B" }), lend(b, { borrower: "C" })]);
    expect(res.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    expect((await rows(`select count(*)::int as n from loans where book_id = $1 and returned_date is null and voided_at is null`, [b]))[0].n).toBe(1);
  });
});

describe("Annulla prestito registrato per errore", () => {
  it("prestito attivo: annullato (non cancellato), copia disponibile, motivo/autore/data, traccia con valori prima e dopo", async () => {
    const b = await newBook("Errore 1");
    const l = (await lend(b, { borrower: "Persona sbagliata", notes: "nota privata" })).json;
    const r = await admin("POST", `/api/loans/${l.id}/void`, { reason: "  Libro sbagliato  " });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ id: l.id, state: "annullato", voidReason: "Libro sbagliato", correctionCount: 1, effectiveDays: null, daysLate: 0, borrower: "Persona sbagliata" });
    expect(r.json.voidedAt).toMatch(/^2026-|^20\d\d-/);
    expect((await admin("GET", `/api/books/${b}/loans`)).json).toMatchObject({ availability: "disponibile" });
    expect(await rows(`select 1 from loans where id = $1`, [l.id])).toHaveLength(1); // non cancellato
    const [row] = await rows(`select voided_by, void_reason from loans where id = $1`, [l.id]);
    expect(row).toEqual({ voided_by: ADMIN, void_reason: "Libro sbagliato" });
    const c = await corrections(l.id);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ action: "annulla_prestito", reason: "Libro sbagliato", corrected_by: ADMIN, before_state: { state: "attivo", voided: false }, after_state: { state: "annullato", voided: true } });
    expect(c[0].corrected_at).toBeTruthy();
    // un nuovo prestito sulla stessa copia ora è possibile
    expect((await lend(b, { borrower: "Persona giusta", loanDate: "2026-10-05" })).status).toBe(201);
    // restituzione, modifica e doppio annullamento sono rifiutati
    expect((await giveBack(l.id)).status).toBe(409);
    expect((await admin("PUT", `/api/loans/${l.id}`, { borrower: "x", contact: "", notes: "", plannedDays: 5 })).status).toBe(409);
    const twice = await admin("POST", `/api/loans/${l.id}/void`, { reason: "di nuovo" });
    expect(twice).toMatchObject({ status: 409, json: { error: { code: "already_voided" } } });
    expect(await corrections(l.id)).toHaveLength(1);
  });
  it("motivo obbligatorio (3–500 caratteri): senza motivo non cambia nulla", async () => {
    const b = await newBook("Errore 2");
    const l = (await lend(b)).json;
    for (const body of [{}, { reason: "" }, { reason: "  a " }, { reason: "x".repeat(501) }, { reason: 5 }]) {
      const r = await admin("POST", `/api/loans/${l.id}/void`, body);
      expect(r.status).toBe(400);
    }
    expect((await admin("GET", `/api/loans/${l.id}`)).json.state).toBe("in prestito");
    expect(await corrections(l.id)).toHaveLength(0);
  });
  it("id inesistente o non valido: 404", async () => {
    expect((await admin("POST", `/api/loans/00000000-0000-4000-8000-000000000000/void`, { reason: "prova" })).status).toBe(404);
    expect((await admin("POST", `/api/loans/non-un-id/void`, { reason: "prova" })).status).toBe(404);
  });
  it("prestito già restituito registrato per errore: si può annullare e non viene contato come prestito; lo storico lo distingue", async () => {
    const b = await newBook("Errore 3");
    const l = (await lend(b)).json;
    await giveBack(l.id, "2026-10-03");
    const r = await admin("POST", `/api/loans/${l.id}/void`, { reason: "Inserito due volte" });
    expect(r.json.state).toBe("annullato");
    expect((await corrections(l.id))[0].before_state).toMatchObject({ state: "restituito", returnedDate: "2026-10-03" });
    const f = (s: string) => admin("GET", `/api/loans?state=${s}`).then((x) => x.json.items.filter((i: any) => i.bookId === b));
    expect(await f("restituiti")).toHaveLength(0);
    expect(await f("attivi")).toHaveLength(0);
    expect(await f("annullati")).toHaveLength(1);
    expect(await f("tutti")).toHaveLength(1);
  });
});

describe("Annulla registrazione della restituzione", () => {
  it("riporta il prestito attivo, conserva i valori precedenti nella traccia e rende la copia di nuovo in prestito", async () => {
    const b = await newBook("Rest. errata");
    const l = (await lend(b)).json;
    await giveBack(l.id, "2026-10-03");
    const r = await admin2("POST", `/api/loans/${l.id}/undo-return`, { reason: "Restituzione registrata sul libro sbagliato" });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ state: "in prestito", returnedDate: null, correctionCount: 1 });
    expect((await admin("GET", `/api/books/${b}/loans`)).json.availability).toBe("in prestito");
    const [row] = await rows(`select returned_date, returned_by from loans where id = $1`, [l.id]);
    expect(row).toEqual({ returned_date: null, returned_by: null });
    const [c] = await corrections(l.id);
    expect(c).toMatchObject({ action: "annulla_restituzione", corrected_by: OTHER_ADMIN, reason: "Restituzione registrata sul libro sbagliato", before_state: { state: "restituito", returnedDate: "2026-10-03", returnedBy: ADMIN, voided: false }, after_state: { state: "attivo", returnedDate: null, voided: false } });
    // si può registrare di nuovo la restituzione, con la data giusta; la traccia cresce
    expect((await giveBack(l.id, "2026-10-08")).json).toMatchObject({ state: "restituito", returnedDate: "2026-10-08" });
    expect((await admin("GET", `/api/loans/${l.id}`)).json.correctionCount).toBe(1);
  });
  it("bloccata se la copia è stata prestata di nuovo (anche se quel prestito è già restituito) e spiega come risolvere", async () => {
    const b = await newBook("Prestata di nuovo");
    const a = (await lend(b, { borrower: "Anna" })).json;
    await giveBack(a.id, "2026-10-03");
    const second = (await lend(b, { borrower: "Bruno", loanDate: "2026-10-05" })).json;
    const blocked = await admin("POST", `/api/loans/${a.id}/undo-return`, { reason: "errore" });
    expect(blocked.status).toBe(409);
    expect(blocked.json.error).toMatchObject({ code: "later_loan" });
    expect(blocked.json.error.message).toMatch(/prestata di nuovo.*annullalo prima/s);
    await giveBack(second.id, "2026-10-07");
    expect((await admin("POST", `/api/loans/${a.id}/undo-return`, { reason: "errore" })).status).toBe(409); // ancora bloccata
    // se anche il prestito successivo era un errore e viene annullato, la correzione diventa possibile
    expect((await admin("POST", `/api/loans/${second.id}/void`, { reason: "Registrato per errore" })).status).toBe(200);
    expect((await admin("POST", `/api/loans/${a.id}/undo-return`, { reason: "errore" })).status).toBe(200);
    expect(await corrections(a.id)).toHaveLength(1);
  });
  it("rifiuti: prestito non restituito, annullato, inesistente; indice univoco come ultima difesa", async () => {
    const b = await newBook("Rifiuti");
    const active = (await lend(b)).json;
    expect((await admin("POST", `/api/loans/${active.id}/undo-return`, { reason: "errore" })).json.error.code).toBe("not_returned");
    await admin("POST", `/api/loans/${active.id}/void`, { reason: "errore" });
    expect((await admin("POST", `/api/loans/${active.id}/undo-return`, { reason: "errore" })).json.error.code).toBe("voided");
    expect((await admin("POST", `/api/loans/00000000-0000-4000-8000-000000000000/undo-return`, { reason: "errore" })).status).toBe(404);
    // prestito retrodatato ancora attivo, di data precedente: il controllo «prestiti successivi» non lo vede, lo ferma il database
    const c = await newBook("Indice");
    const a = (await lend(c, { borrower: "A", loanDate: "2026-10-05" })).json;
    await giveBack(a.id, "2026-10-06");
    const older = (await lend(c, { borrower: "B", loanDate: "2026-09-01" })).json;
    expect(older.state).toMatch(/prestito|ritardo/);
    const r = await admin("POST", `/api/loans/${a.id}/undo-return`, { reason: "errore" });
    expect(r).toMatchObject({ status: 409, json: { error: { code: "already_on_loan" } } });
    expect((await admin("GET", `/api/loans/${a.id}`)).json).toMatchObject({ state: "restituito", returnedDate: "2026-10-06", correctionCount: 0 });
    expect(await corrections(a.id)).toHaveLength(0);
  });
});

describe("Tracciabilità e integrità", () => {
  it("la traccia è leggibile dall'admin (più recente prima) e immutabile: update e delete rifiutati dal database", async () => {
    const b = await newBook("Traccia");
    const l = (await lend(b)).json;
    await giveBack(l.id, "2026-10-02");
    await admin("POST", `/api/loans/${l.id}/undo-return`, { reason: "prima correzione" });
    await admin("POST", `/api/loans/${l.id}/void`, { reason: "seconda correzione" });
    const r = await admin("GET", `/api/loans/${l.id}/corrections`);
    expect(r.status).toBe(200);
    expect(r.json.items.map((x: any) => x.reason)).toEqual(["seconda correzione", "prima correzione"]);
    expect(r.json.items[0]).toMatchObject({ loanId: l.id, action: "annulla_prestito", correctedBy: ADMIN, before: { state: "attivo" }, after: { state: "annullato" } });
    await expect(raw.query(`update loan_corrections set reason = 'manomessa' where loan_id = $1`, [l.id])).rejects.toThrow(/non può essere modificata/);
    await expect(raw.query(`delete from loan_corrections where loan_id = $1`, [l.id])).rejects.toThrow(/non può essere modificata né cancellata/);
    await expect(raw.query(`delete from loans where id = $1`, [l.id])).rejects.toThrow(); // restrict: la traccia protegge il prestito
    expect((await admin("GET", `/api/loans/00000000-0000-4000-8000-000000000000/corrections`)).status).toBe(404);
    expect(await corrections(l.id)).toHaveLength(2);
  });
  it("un libro con prestiti annullati o corretti resta non cancellabile (storico protetto)", async () => {
    const b = await newBook("Protetto");
    const l = (await lend(b)).json;
    await admin("POST", `/api/loans/${l.id}/void`, { reason: "errore" });
    const del = await admin("DELETE", `/api/books/${b}`);
    expect(del).toMatchObject({ status: 409, json: { error: { code: "has_loans" } } });
  });
  it("errore nel salvataggio della traccia: nessun aggiornamento parziale (prestito non annullato, restituzione non toccata)", async () => {
    const b = await newBook("Atomicità");
    const l = (await lend(b)).json;
    const done = (await lend(await newBook("Atomicità 2"), { borrower: "Z" })).json;
    await giveBack(done.id, "2026-10-04");
    await raw.exec(`create function fail_audit() returns trigger language plpgsql as $$ begin raise exception 'guasto simulato'; end; $$;
                    create trigger fail_audit_t before insert on loan_corrections for each row execute function fail_audit();`);
    try {
      const v = await admin("POST", `/api/loans/${l.id}/void`, { reason: "errore" });
      const u = await admin("POST", `/api/loans/${done.id}/undo-return`, { reason: "errore" });
      expect(v.status).toBe(500);
      expect(u.status).toBe(500);
    } finally {
      await raw.exec(`drop trigger fail_audit_t on loan_corrections; drop function fail_audit();`);
    }
    expect((await rows(`select voided_at, void_reason, voided_by from loans where id = $1`, [l.id]))[0]).toEqual({ voided_at: null, void_reason: null, voided_by: null });
    expect((await rows(`select returned_date::text as d from loans where id = $1`, [done.id]))[0].d).toBe("2026-10-04");
    expect(await corrections(l.id)).toHaveLength(0);
    expect(await corrections(done.id)).toHaveLength(0);
    expect((await admin("GET", `/api/books/${b}/loans`)).json.availability).toBe("in prestito");
  });
  it("annullamenti simultanei dello stesso prestito: una sola traccia", async () => {
    const b = await newBook("Doppio");
    const l = (await lend(b)).json;
    const rs = await Promise.all([admin("POST", `/api/loans/${l.id}/void`, { reason: "uno" }), admin2("POST", `/api/loans/${l.id}/void`, { reason: "due" })]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await corrections(l.id)).toHaveLength(1);
  });
  it("il vincolo del database impedisce annullamenti incompleti (data senza motivo)", async () => {
    const b = await newBook("Vincolo");
    const l = (await lend(b)).json;
    await expect(raw.query(`update loans set voided_at = now() where id = $1`, [l.id])).rejects.toThrow();
  });
});

describe("Permessi: verificati lato server", () => {
  it("il visualizzatore non può registrare, restituire, annullare, correggere né leggere la traccia (403), neppure con chiamate dirette", async () => {
    const b = await newBook("Viewer");
    const l = (await lend(b)).json;
    await giveBack(l.id, "2026-10-02");
    const attempts: [string, string, object?][] = [
      ["POST", `/api/books/${b}/loans`, { borrower: "x", loanDate: "2026-10-01", plannedDays: 5 }],
      ["POST", `/api/loans/${l.id}/return`, {}],
      ["POST", `/api/loans/${l.id}/void`, { reason: "prova" }],
      ["POST", `/api/loans/${l.id}/undo-return`, { reason: "prova" }],
      ["GET", `/api/loans/${l.id}/corrections`],
      ["GET", `/api/loans/${l.id}`],
      ["PUT", `/api/loans/${l.id}`, { borrower: "x", contact: "", notes: "", plannedDays: 5 }],
    ];
    for (const [m, p, body] of attempts) expect((await viewer(m, p, body)).status, `${m} ${p}`).toBe(403);
    expect((await call("POST", `/api/loans/${l.id}/void`, { body: { reason: "prova" } })).status).toBe(401);
    expect((await call("POST", `/api/loans/${l.id}/void`, { user: "u", roles: [], body: { reason: "prova" } })).status).toBe(403);
    expect((await admin("GET", `/api/loans/${l.id}`)).json).toMatchObject({ state: "restituito", voidedAt: null, correctionCount: 0 });
    expect(await corrections(l.id)).toHaveLength(0);
  });
  it("il visualizzatore vede lo stato «annullato» ma non nome, recapito, note né motivo; l'identità dell'autore non viene mai esposta a lui", async () => {
    const b = await newBook("Privacy");
    const l = (await lend(b, { borrower: "Nome Riservato", contact: "tel 123", notes: "nota riservata" })).json;
    await admin("POST", `/api/loans/${l.id}/void`, { reason: "motivo riservato" });
    const r = await viewer("GET", `/api/books/${b}/loans`);
    expect(r.status).toBe(200);
    expect(r.json.availability).toBe("disponibile");
    expect(r.json.loans[0]).toMatchObject({ state: "annullato", borrower: null, contact: null, notes: null, voidReason: null });
    expect(JSON.stringify(r.json)).not.toMatch(/Nome Riservato|tel 123|nota riservata|motivo riservato|admin-1/);
  });
  it("le route di correzione rifiutano metodi non previsti e le richieste senza intestazione anti-CSRF", async () => {
    const b = await newBook("Metodi");
    const l = (await lend(b)).json;
    expect((await admin("GET", `/api/loans/${l.id}/void`)).status).toBe(405);
    expect((await admin("POST", `/api/loans/${l.id}/corrections`, {})).status).toBe(405);
    expect((await call("POST", `/api/loans/${l.id}/void`, { user: ADMIN, roles: ["admin"], body: { reason: "prova" }, headers: { "x-bibliotheca": "0" } })).status).toBe(403);
    expect((await admin("POST", `/api/books/${b}/void`, {})).status).toBe(404);
    expect((await admin("GET", `/api/loans/${l.id}`)).json.state).toBe("in prestito");
  });
});
