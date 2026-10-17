// @vitest-environment node
import { afterAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createHttpBooksApi } from "../src/lib/api/httpBooksApi";
import { emptyBookInput, type BooksApi } from "../src/lib/api/types";
import type { LoanRestoreRecord } from "../src/lib/api/loans";
import { applyLoanRestore, applyRestore, listEveryCorrection, listEveryLoan, loanHistoryDigest, parseBackup, planLoanRestore, planRestore, verifyLoanRestore, type ParsedBackup } from "../src/lib/backup";
import { booksToJson } from "../src/lib/export";
import * as copiesRepo from "./copiesRepo";
import * as loansRepo from "./loansRepo";
import { handle } from "./router";
import { makeDeps, makeTestDb } from "./testHarness";
import type { Db } from "./db";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
const dbs: { db: Db; raw: PGlite }[] = [];
const fresh = async () => { const d = await makeTestDb(); dbs.push(d); return d; };
afterAll(async () => { await Promise.all(dbs.map((d) => d.raw.close())); });
const TODAY = "2026-10-15";
const client = (db: Db, roles = "admin", user = "admin-1"): BooksApi => createHttpBooksApi({
  fetch: async (url, init) => {
    const h = new Headers(init?.headers); h.set("x-test-session", user); h.set("x-test-roles", roles);
    return handle(new Request(`https://bibliotheca.test${url as string}`, { ...init, headers: { ...Object.fromEntries(h), origin: "https://bibliotheca.test" } }), makeDeps(db, { today: () => TODAY }));
  },
});
const raw = (db: Db, roles: string | null, path: string, body: unknown, headers: Record<string, string> = {}) =>
  handle(new Request(`https://bibliotheca.test${path}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", "x-bibliotheca": "1", origin: "https://bibliotheca.test", ...(roles ? { "x-test-session": "u", "x-test-roles": roles } : {}), ...headers } }), makeDeps(db, { today: () => TODAY }));

/** Esattamente la procedura del pulsante «Esporta backup». */
async function makeBackup(api: BooksApi): Promise<string> {
  const books = await api.listAllBooks();
  const loans = await listEveryLoan(api);
  return booksToJson(books, new Date("2026-10-15T10:00:00Z"), loans, await listEveryCorrection(api, loans), await api.listAllCopies());
}
const parsed = (text: string): Extract<ParsedBackup, { ok: true }> => { const p = parseBackup(text); if (!p.ok) throw new Error(p.message); return p; };

/** Catalogo di partenza con TUTTI i casi: attivo, restituito, annullato, restituzione annullata (e poi di nuovo restituito), restituzione annullata + prestito annullato, seconda copia. */
async function seed() {
  const { db, raw: pg } = await fresh();
  const a = client(db, "admin", "admin-1"), b = client(db, "admin", "admin-2");
  const mk = async (title: string) => (await a.createBook({ ...emptyBookInput(), title, isbn: "" })).id;
  const [b1, b2, b3, b4, b5] = [await mk("RT Attivo"), await mk("RT Restituito"), await mk("RT Annullato"), await mk("RT Restituzione annullata"), await mk("RT Doppia correzione")];
  const lend = (id: string, over: object = {}) => a.createLoan(id, { borrower: "Marta Rossi", contact: "m@example.org", loanDate: "2026-09-01", plannedDays: 14, notes: "nota", ...over });
  await lend(b1, { borrower: "Attivo Anna", loanDate: "2026-10-01", plannedDays: 30 });
  await copiesRepo.addCopy(db, b1, { inventoryCode: "RT-INV-2", notes: "seconda copia" }, TODAY);
  await loansRepo.createLoan(db, "admin-1", b1, { borrower: "Seconda Copia", contact: "", loanDate: "2026-10-05", plannedDays: 10, notes: "" }, TODAY, 2);
  const l2 = await lend(b2, { borrower: "Restituito Luca" });
  await a.returnLoan(l2.id, "2026-09-12");
  const l3 = await lend(b3, { borrower: "Errore Elena", loanDate: "2026-10-02" });
  await b.voidLoan(l3.id, "registrato sul libro sbagliato");
  const l4 = await lend(b4, { borrower: "Data Dario", loanDate: "2026-09-10" });
  await a.returnLoan(l4.id, "2026-09-20");
  await b.undoLoanReturn(l4.id, "data di restituzione errata");
  await a.returnLoan(l4.id, "2026-09-22");
  const l5 = await lend(b5, { borrower: "Doppia Dora", loanDate: "2026-09-15" });
  await a.returnLoan(l5.id, "2026-09-18");
  await b.undoLoanReturn(l5.id, "non era stato restituito");
  await a.voidLoan(l5.id, "il prestito non è mai avvenuto");
  return { db, pg, a, b, books: { b1, b2, b3, b4, b5 } };
}

describe("Backup v4: ripristino integrale di prestiti, annullamenti e correzioni", () => {
  it("andata e ritorno: attivo, restituito, annullato, restituzione annullata, seconda copia; il backup ripristinato è equivalente all'originale", async () => {
    const src = await seed();
    const textA = await makeBackup(src.a);
    const A = parsed(textA);
    expect(A).toMatchObject({ version: 4, loanIssues: [], issues: [] });
    expect(A.loans).toHaveLength(6);
    expect(A.loans!.filter((l) => l.voided)).toHaveLength(2);
    expect(A.loans!.reduce((n, l) => n + (l.corrections?.length ?? 0), 0)).toBe(4); // l3: annulla; l4: undo; l5: undo + annulla
    expect(JSON.parse(textA)).toMatchObject({ loanCount: 6, voidedLoanCount: 2, correctionCount: 4 });

    // database vuoto NUOVO: schede poi prestiti
    const dst = await fresh();
    const api = client(dst.db, "admin", "restorer");
    const r = await applyRestore(api, planRestore(A.items, []));
    expect(r).toMatchObject({ created: 5, failed: [] });
    expect(A.copies!.length).toBe(6); // 5 schede (copia 1 automatica) + la seconda copia con codice
    expect(A.copies!.find((c) => c.inventoryCode === "RT-INV-2")).toMatchObject({ copyNo: 2, notes: "seconda copia" });
    expect(JSON.parse(textA)).toMatchObject({ copyCount: 6 });
    const plan = await planLoanRestore(api, A.loans!, r.idMap, A.copies!);
    expect(plan).toMatchObject({ same: 0, probableDuplicates: [], differing: [], blocked: [], noBook: 0 });
    expect(plan.toCreate).toHaveLength(6);
    const res = await applyLoanRestore(api, plan);
    expect(res).toMatchObject({ created: 6, voidedCreated: 2, corrections: 4, duplicates: 0, failed: [] });
    expect(res.copiesCreated).toBe(1); // la copia 1 esiste già alla creazione della scheda; manca solo la n. 2

    // verifica finale sul database reale (6 prestiti + 6 copie)
    expect(await verifyLoanRestore(api, A.loans!, r.idMap, new Set(), A.copies!)).toEqual({ checked: 6, copiesChecked: 6, mismatches: [] });
    const restored = parsed(await makeBackup(api));
    expect(restored.copies!.map((c) => [c.copyNo, c.inventoryCode, c.notes]).sort()).toEqual(A.copies!.map((c) => [c.copyNo, c.inventoryCode, c.notes]).sort());

    // equivalenza dei due backup (stesse storie, indipendentemente dagli id delle schede)
    const C = parsed(await makeBackup(api));
    const back = Object.fromEntries(Object.entries(r.idMap).map(([o, n]) => [n, o]));
    expect(C.loans).toHaveLength(6);
    expect(loanHistoryDigest(C.loans!, (id) => back[id] ?? id)).toEqual(loanHistoryDigest(A.loans!, (id) => id));
    expect(JSON.parse(await makeBackup(api))).toMatchObject({ loanCount: 6, voidedLoanCount: 2, correctionCount: 4 });

    // tracce nel dettaglio: autore, data e motivo originali; ordine delle correzioni; stato
    const byTitle = (t: string) => C.loans!.find((l) => l.bookTitle === t)!;
    const dora = byTitle("RT Doppia correzione");
    expect(dora.corrections!.map((c) => [c.action, c.correctedBy, c.reason])).toEqual([
      ["annulla_restituzione", "admin-2", "non era stato restituito"],
      ["annulla_prestito", "admin-1", "il prestito non è mai avvenuto"],
    ]);
    expect(dora.voided).toMatchObject({ by: "admin-1", reason: "il prestito non è mai avvenuto" });
    expect(dora.createdBy).toBe("admin-1");
    expect(byTitle("RT Annullato").voided).toMatchObject({ by: "admin-2", reason: "registrato sul libro sbagliato" });
    const dario = byTitle("RT Restituzione annullata");
    expect(dario).toMatchObject({ returnedDate: "2026-09-22", returnedBy: "admin-1" });
    expect(dario.corrections).toHaveLength(1);
    expect(dario.corrections![0]).toMatchObject({ action: "annulla_restituzione", correctedBy: "admin-2", reason: "data di restituzione errata", before: { state: "restituito", returnedDate: "2026-09-20" }, after: { state: "attivo", returnedDate: null } });

    // disponibilità e stato derivati identici
    for (const [orig, nuovo] of Object.entries(r.idMap)) {
      const x = await src.a.listBookLoans(orig), y = await api.listBookLoans(nuovo);
      expect(y.availability).toBe(x.availability);
      expect(y.loans.map((l) => [l.state, l.copyNo, l.correctionCount]).sort()).toEqual(x.loans.map((l) => [l.state, l.copyNo, l.correctionCount]).sort());
    }
    // provenienza del ripristino: registrata, senza toccare autori e date originali
    const prov = (await dst.raw.query<{ n: number }>(`select count(*)::int as n from loan_corrections where restored_by = 'restorer' and restored_at is not null`)).rows[0]!.n;
    expect(prov).toBe(4);
    expect((await dst.raw.query<{ n: number }>(`select count(*)::int as n from loans where restored_by = 'restorer'`)).rows[0]!.n).toBe(6);
    // la traccia ripristinata resta immutabile
    await expect(dst.raw.query(`update loan_corrections set reason = 'manomessa'`)).rejects.toThrow(/non può essere modificata/);
    await expect(dst.raw.query(`delete from loan_corrections`)).rejects.toThrow();
  });

  it("importazioni ripetute: secondo ripristino nello stesso database = nessun duplicato e nessuna modifica; con dati diversi nel database non sovrascrive", async () => {
    const src = await seed();
    const A = parsed(await makeBackup(src.a));
    const dst = await fresh();
    const api = client(dst.db, "admin", "restorer");
    const r = await applyRestore(api, planRestore(A.items, []));
    await applyLoanRestore(api, await planLoanRestore(api, A.loans!, r.idMap));
    const before = await makeBackup(api);

    const plan2 = await planLoanRestore(api, A.loans!, r.idMap);
    expect(plan2).toMatchObject({ same: 6, toCreate: [], differing: [], blocked: [] });
    const res2 = await applyLoanRestore(api, plan2);
    expect(res2).toMatchObject({ created: 0, duplicates: 6, failed: [] });
    expect(JSON.parse(await makeBackup(api)).loanCount).toBe(6);
    expect(await makeBackup(api)).toEqual(before.replace(/"exportedAt": "[^"]+"/, '"exportedAt": "2026-10-15T10:00:00.000Z"'));

    // stessa richiesta inviata due volte direttamente al server: il secondo invio salta tutto (idempotente)
    const direct = await api.restoreLoans(A.loans!.slice(0, 2).map((l) => ({ ...(l as object), bookId: r.idMap[l.bookId]!, corrections: l.corrections ?? [] }) as unknown as LoanRestoreRecord));
    expect(direct).toMatchObject({ created: 0, skipped: 2 });

    // qualcuno ha cambiato un prestito dopo il backup: il ripristino lo segnala e NON lo sovrascrive
    await dst.raw.query(`update loans set borrower_name = 'Modificato dopo' where borrower_name = 'Restituito Luca'`);
    const plan3 = await planLoanRestore(api, A.loans!, r.idMap);
    expect(plan3.differing).toHaveLength(1);
    expect(plan3.differing[0]!.reason).toMatch(/non è stato sovrascritto/);
    expect((await verifyLoanRestore(api, A.loans!, r.idMap)).mismatches.join(" ")).toMatch(/Restituito Luca.*diversi dal file/);
    expect((await listEveryLoan(api)).some((l) => l.borrower === "Modificato dopo")).toBe(true);
  });

  it("atomicità: se un solo prestito non è ripristinabile, NON viene scritto nulla (né prestiti né correzioni né copie)", async () => {
    const src = await seed();
    const A = parsed(await makeBackup(src.a));
    const dst = await fresh();
    const api = client(dst.db, "admin", "restorer");
    const r = await applyRestore(api, planRestore(A.items, []));
    const recs = (await planLoanRestore(api, A.loans!, r.idMap)).toCreate;
    const count = async () => (await dst.raw.query<{ l: number; c: number; k: number }>(`select (select count(*) from loans)::int as l, (select count(*) from loan_corrections)::int as c, (select count(*) from book_copies)::int as k`)).rows[0]!;
    const zero = await count();
    // l'ultimo prestito punta a una scheda inesistente
    await expect(api.restoreLoans([...recs, { ...recs[0]!, id: "11111111-1111-4111-8111-111111111111", bookId: "22222222-2222-4222-8222-222222222222" }])).rejects.toMatchObject({ kind: "notfound" });
    expect(await count()).toEqual(zero);
    // un prestito attivo in conflitto con uno già in corso sulla stessa copia, in fondo all'elenco
    const target = r.idMap[A.loans!.find((l) => l.bookTitle === "RT Attivo" && l.copyNo === 1)!.bookId]!;
    await api.createLoan(target, { borrower: "Già fuori", contact: "", loanDate: "2026-10-10", plannedDays: 10, notes: "" });
    const before = await count();
    await expect(api.restoreLoans(recs)).rejects.toMatchObject({ kind: "conflict" });
    expect(await count()).toEqual(before);
    // e dal punto di vista dell'utente il piano lo segnala PRIMA, senza tentare la scrittura
    const plan = await planLoanRestore(api, A.loans!, r.idMap);
    expect(plan.blocked).toHaveLength(1);
    expect(plan.toCreate).toHaveLength(5);
    expect(await applyLoanRestore(api, plan)).toMatchObject({ created: 5, blocked: 1, failed: [] });
  });

  it("validazione prima di scrivere: file con cronologia incoerente rifiutato; server e client usano le stesse regole", async () => {
    const src = await seed();
    const text = await makeBackup(src.a);
    const obj = JSON.parse(text);
    // 1) annullato senza la correzione che lo spiega
    const t1 = structuredClone(obj);
    t1.loans.find((l: any) => l.voided && l.bookTitle === "RT Annullato").corrections = [];
    const p1 = parseBackup(JSON.stringify(t1));
    if (!p1.ok) throw new Error();
    expect(p1.loanIssues!.join(" ")).toMatch(/RT Annullato.*annullato ma l'ultima correzione/);
    expect(p1.loans).toHaveLength(5);
    // 2) correzioni in ordine cronologico inverso
    const t2 = structuredClone(obj);
    const dora = t2.loans.find((l: any) => l.bookTitle === "RT Doppia correzione");
    dora.corrections[0].correctedAt = "2030-01-01T00:00:00Z";
    expect((parseBackup(JSON.stringify(t2)) as any).loanIssues.join(" ")).toMatch(/ordine cronologico/);
    // 3) correzione senza motivo
    const t3 = structuredClone(obj);
    t3.loans.find((l: any) => l.bookTitle === "RT Restituzione annullata").corrections[0].reason = "";
    expect((parseBackup(JSON.stringify(t3)) as any).loanIssues.join(" ")).toMatch(/motivo mancante/);
    // 4) due prestiti attivi sulla stessa copia nel file
    const t4 = structuredClone(obj);
    const att = t4.loans.find((l: any) => l.borrower === "Attivo Anna");
    t4.loans.push({ ...att, id: "33333333-3333-4333-8333-333333333333", borrower: "Doppione" });
    expect((parseBackup(JSON.stringify(t4)) as any).loanIssues.join(" ")).toMatch(/2 prestiti attivi sulla copia/);
    // 5) lo stesso controllo sul server (nulla scritto): riceve direttamente un record incoerente
    const dst = await fresh();
    const api = client(dst.db);
    const bk = await api.createBook({ ...emptyBookInput(), title: "x" });
    const bad = { id: "44444444-4444-4444-8444-444444444444", bookId: bk.id, copyNo: 1, borrower: "A", contact: "", notes: "", loanDate: "2026-09-01", plannedDays: 10, returnedDate: null, voided: { at: "2026-09-02T10:00:00Z", by: "u", reason: "errore" }, corrections: [] };
    await expect(api.restoreLoans([bad as unknown as LoanRestoreRecord])).rejects.toMatchObject({ kind: "validation" });
    expect((await dst.raw.query(`select 1 from loans`)).rows).toHaveLength(0);
  });

  it("permessi: il visualizzatore non può ripristinare (403), senza sessione 401, senza intestazione CSRF 403; nulla scritto", async () => {
    const { db, raw: pg } = await fresh();
    const bk = await client(db).createBook({ ...emptyBookInput(), title: "x" });
    const body = { loans: [{ bookId: bk.id, copyNo: 1, borrower: "A", contact: "", notes: "", loanDate: "2026-09-01", plannedDays: 10, returnedDate: null, corrections: [] }] };
    expect((await raw(db, "viewer", "/api/loans/restore", body)).status).toBe(403);
    expect((await raw(db, null, "/api/loans/restore", body)).status).toBe(401);
    expect((await raw(db, "admin", "/api/loans/restore", body, { "x-bibliotheca": "0" })).status).toBe(403);
    expect((await raw(db, "admin", "/api/loans/restore", { loans: [] })).status).toBe(400);
    expect((await pg.query(`select 1 from loans`)).rows).toHaveLength(0);
    expect((await raw(db, "admin", "/api/loans/restore", body)).status).toBe(200);
    expect((await pg.query(`select 1 from loans`)).rows).toHaveLength(1);
    // il visualizzatore resta in sola lettura anche per lo storico: nessun autore/data/motivo
    const v = client(db, "viewer");
    const h = await v.listBookLoans(bk.id);
    expect(h.loans[0]).toMatchObject({ borrower: null, createdBy: null, createdAt: null, returnedBy: null, voidedBy: null });
    await expect(v.restoreLoans(JSON.parse(JSON.stringify(body.loans)))).rejects.toMatchObject({ kind: "auth" });
  });

  it("compatibilità: backup v3 (annullato senza cronologia) si ripristina conservando autore, data e motivo dell'annullamento; v2 resta leggibile", async () => {
    const dst = await fresh();
    const api = client(dst.db, "admin", "restorer");
    const bk = await api.createBook({ ...emptyBookInput(), title: "Libro v3" });
    const v3 = { format: "bibliotheca-backup", version: 3, count: 0, loanCount: 2, books: [], loans: [
      { bookId: bk.id, bookTitle: "Libro v3", copyNo: 1, borrower: "Errore", contact: "", notes: "", loanDate: "2026-09-01", plannedDays: 14, dueDate: "2026-09-15", returnedDate: null, voided: { at: "2026-09-02T08:00:00Z", by: "vecchio-admin", reason: "doppia registrazione" } },
      { bookId: bk.id, bookTitle: "Libro v3", copyNo: 1, borrower: "Vero", contact: "", notes: "", loanDate: "2026-09-03", plannedDays: 14, dueDate: "2026-09-17", returnedDate: "2026-09-10" },
    ] };
    const p = parsed(JSON.stringify(v3));
    expect(p.loanIssues).toEqual([]);
    expect(p.warnings.join(" ")).toMatch(/versione 3/);
    const res = await applyLoanRestore(api, await planLoanRestore(api, p.loans!, { [bk.id]: bk.id }));
    expect(res).toMatchObject({ created: 2, voidedCreated: 1, corrections: 1, failed: [] });
    const h = await api.listBookLoans(bk.id);
    const err = h.loans.find((l) => l.borrower === "Errore")!;
    expect(err).toMatchObject({ state: "annullato", voidedAt: "2026-09-02T08:00:00Z", voidedBy: "vecchio-admin", voidReason: "doppia registrazione" });
    const c = await api.listLoanCorrections(err.id);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ action: "annulla_prestito", correctedBy: "vecchio-admin", correctedAt: "2026-09-02T08:00:00Z", reason: "doppia registrazione" });
    // v3 ripetuto: nessun duplicato
    expect(await planLoanRestore(api, p.loans!, { [bk.id]: bk.id })).toMatchObject({ toCreate: [] });
    const v2 = parseBackup(JSON.stringify({ format: "bibliotheca-backup", version: 2, count: 0, books: [], loans: [] }));
    expect(v2).toMatchObject({ ok: true, version: 2 });
  });
});
