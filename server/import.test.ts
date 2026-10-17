// @vitest-environment node
import { afterAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createHttpBooksApi } from "../src/lib/api/httpBooksApi";
import { checkIsbn } from "../src/lib/api/isbn";
import { BooksApiError } from "../src/lib/api/errors";
import { emptyBookInput, type BookInput, type BooksApi } from "../src/lib/api/types";
import { applyLoanRestore, applyRestore, listEveryLoan, parseBackup, planLoanRestore, planRestore } from "../src/lib/backup";
import { csvTemplate, MAX_CSV_ROWS, parseCsv, parseCsvCatalog } from "../src/lib/csv";
import { booksToCsv, booksToJson } from "../src/lib/export";
import { lookupIsbnList, parseIsbnList } from "../src/lib/isbnImport";
import { TEST_BOOKS, testBackupJson, testCatalogCsv, testLoans } from "../src/lib/testData";
import type { LookupResponse, ResultGroup, SourceRecord } from "../src/lib/sources/types";
import { handle } from "./router";
import { makeDeps, makeTestDb } from "./testHarness";
import type { Db } from "./db";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
const dbs: { db: Db; raw: PGlite }[] = [];
const fresh = async () => { const d = await makeTestDb(); dbs.push(d); return d.db; };
afterAll(async () => { await Promise.all(dbs.map((d) => d.raw.close())); });
const TODAY = "2026-10-15";
const client = (db: Db, roles = "admin") => createHttpBooksApi({
  fetch: async (url, init) => {
    const h = new Headers(init?.headers); h.set("x-test-session", "importer"); h.set("x-test-roles", roles);
    return handle(new Request(`https://bibliotheca.test${url as string}`, { ...init, headers: { ...Object.fromEntries(h), origin: "https://bibliotheca.test" } }), makeDeps(db, { today: () => TODAY }));
  },
});
const book = (over: Partial<BookInput>): BookInput => ({ ...emptyBookInput(), ...over });

describe("CSV: lettura", () => {
  it("gestisce BOM, CRLF, separatore «;», virgolette, virgolette doppie e a capo dentro un campo", () => {
    const rows = parseCsv('﻿titolo;note\r\n"Titolo; con punto e virgola";"riga1\nriga2 ""citata"""\r\nSemplice;x\r\n\r\n');
    expect(rows).toEqual([["titolo", "note"], ["Titolo; con punto e virgola", 'riga1\nriga2 "citata"'], ["Semplice", "x"]]);
  });
  it("virgolette non chiuse: errore chiaro", () => {
    expect(parseCsvCatalog('titolo\n"aperto')).toMatchObject({ ok: false, message: expect.stringContaining("Virgolette non chiuse") });
  });
  it("errori di struttura: file vuoto, senza colonna titolo, colonne ripetute, troppe righe", () => {
    expect(parseCsvCatalog("")).toMatchObject({ ok: false });
    expect(parseCsvCatalog("autori,isbn\nx,y")).toMatchObject({ ok: false, message: expect.stringContaining("«titolo»") });
    expect(parseCsvCatalog("titolo,Titolo\na,b")).toMatchObject({ ok: false, message: expect.stringContaining("ripetute") });
    expect(parseCsvCatalog("titolo\n" + Array.from({ length: MAX_CSV_ROWS + 1 }, (_, i) => `t${i}`).join("\n"))).toMatchObject({ ok: false, message: expect.stringContaining("massimo") });
  });
  it("righe: titolo obbligatorio, stato non valido, celle in eccesso, ISBN sospetto, colonne ignorate", () => {
    const r = parseCsvCatalog("Titolo,ISBN,Stato,colonna_strana\n,111,,\nA,9780306406158,bozza,x\nB,9780306406157,inventato,\nC,12345,,,extra\nD,9780306406157,catalogato,");
    if (!r.ok) throw new Error(r.message);
    expect(r.warnings.join(" ")).toMatch(/colonna_strana/);
    const msgs = r.issues.map((i) => i.errors.join(" "));
    expect(msgs.some((m) => /Riga 2.*titolo è obbligatorio/.test(m))).toBe(true);
    expect(msgs.some((m) => /Riga 4.*Stato non valido/.test(m))).toBe(true);
    expect(msgs.some((m) => /Riga 5.*più celle/.test(m))).toBe(true);
    expect(r.items.map((i) => i.input.title)).toEqual(["A", "D"]);
    expect(r.items[0]!.notes?.join(" ")).toMatch(/cifra di controllo/);
    expect(r.items[1]!.notes?.join(" ")).toMatch(/catalogato/);
  });
  it("il modello scaricabile ha le intestazioni giuste e la sua riga d'esempio viene rifiutata", () => {
    const r = parseCsvCatalog(csvTemplate());
    if (!r.ok) throw new Error(r.message);
    expect(r.items).toEqual([]);
    expect(r.issues[0]!.errors[0]).toMatch(/riga di esempio/);
  });
});

describe("CSV: esportazione → importazione su Postgres (andata e ritorno)", () => {
  it("i campi che il CSV porta tornano identici, comprese formule neutralizzate, accenti, virgole, virgolette e a capo", async () => {
    const src = client(await fresh());
    const items: BookInput[] = [
      book({ title: "=SOMMA(A1)", authors: ["Zürcher, Jörg", "Dupont, Éloïse"], isbn: "9780306406157", publisher: 'Ed. "Alfa", Beta', publicationPlace: "Lugano", publicationYear: "2001", language: "tedesco", physicalDescription: "300 p.", subjects: ["Uno; due", "Tre"], dewey: "", deweySource: "manuale", deweyNotes: "nota\ncon a capo", shelfMark: "A1", notes: "+nota con più", status: "da revisionare" }),
      book({ title: "Solo titolo" }),
    ];
    for (const i of items) await src.createBook(i);
    const csv = booksToCsv(await src.listAllBooks());
    const parsed = parseCsvCatalog(csv);
    if (!parsed.ok) throw new Error(parsed.message);
    expect(parsed.issues).toEqual([]);
    const dst = client(await fresh());
    const res = await applyRestore(dst, planRestore(parsed.items, await dst.listAllBooks()));
    expect(res).toMatchObject({ created: 2, failed: [], aborted: false });
    const strip = (b: BookInput & Record<string, unknown>) => { const { id: _i, createdAt: _c, updatedAt: _u, marcLeader: _l, marcFields: _m, ...r } = b; return r; };
    const a = (await src.listAllBooks()).map((b) => strip(b as never)).sort((x, y) => String(x["title"]).localeCompare(String(y["title"])));
    const b = (await dst.listAllBooks()).map((x) => strip(x as never)).sort((x, y) => String(x["title"]).localeCompare(String(y["title"])));
    expect(b).toEqual(a);
  });
  it("CSV con duplicati interni e già presenti: segnalati, saltati di default, nessuna perdita", async () => {
    const api = client(await fresh());
    await api.createBook(book({ title: "Già presente", authors: ["Rossi, Anna"], isbn: "9780306406157" }));
    const parsed = parseCsvCatalog("titolo,autori,isbn\nAltro titolo,,9780306406157\nGià presente,\"Rossi, Anna\",\nNuovo,,\nNuovo,,\n");
    if (!parsed.ok) throw new Error(parsed.message);
    const plan = planRestore(parsed.items, await api.listAllBooks());
    expect(plan.map((p) => p.relation)).toEqual(["stesso-isbn", "stesso-titolo-autore", "nuova", "duplicato-nel-file"]);
    const res = await applyRestore(api, plan);
    expect(res).toMatchObject({ created: 1, skipped: 3 });
    expect((await api.listAllBooks()).map((b) => b.title).sort()).toEqual(["Già presente", "Nuovo"]);
  });
});

describe("File di prova [TEST]", () => {
  it("sono chiaramente fittizi, con ISBN formalmente validi e record MARC21 validi", () => {
    for (const b of TEST_BOOKS) {
      expect(b.input.title.startsWith("[TEST]")).toBe(true);
      expect(b.input.notes).toMatch(/RECORD DI PROVA/);
      expect(b.input.status).toBe("bozza");
      if (b.input.isbn) expect(checkIsbn(b.input.isbn)).toBe("ok");
    }
    const p = parseBackup(testBackupJson(new Date(`${TODAY}T10:00:00Z`)));
    if (!p.ok) throw new Error(p.message);
    expect(p).toMatchObject({ version: 2, issues: [], loanIssues: [] });
    expect(p.items).toHaveLength(TEST_BOOKS.length);
    expect(p.loans).toHaveLength(4);
    const c = parseCsvCatalog(testCatalogCsv());
    if (!c.ok) throw new Error(c.message);
    expect(c.issues).toEqual([]);
    expect(c.items.map((i) => i.input.title)).toEqual(TEST_BOOKS.map((b) => b.input.title));
  });

  it("importazione completa su Postgres: schede, MARC21 identico, edizioni da scegliere, prestiti (storico, in corso, in ritardo); seconda importazione = nessun duplicato", async () => {
    const api = client(await fresh());
    const p = parseBackup(testBackupJson(new Date(`${TODAY}T10:00:00Z`)));
    if (!p.ok) throw new Error(p.message);
    const plan = planRestore(p.items, []);
    // le due edizioni della stessa opera sono segnalate come possibile duplicato nel file: l'utente sceglie «crea comunque»
    const second = plan.find((x) => x.item.input.publisher === "Editore Seconda")!;
    expect(second.relation).toBe("duplicato-nel-file");
    expect(second.resolution).toBe("salta");
    second.resolution = "crea";
    const r1 = await applyRestore(api, plan);
    expect(r1).toMatchObject({ created: 6, failed: [] });
    const l1 = await applyLoanRestore(api, await planLoanRestore(api, p.loans!, r1.idMap));
    expect(l1).toMatchObject({ created: 4, duplicates: 0, noBook: 0, failed: [] });

    const books = await api.listAllBooks();
    const full = books.find((b) => b.title === "[TEST] Libro completo con MARC21")!;
    expect(full.marcFields).toEqual(TEST_BOOKS[0]!.input.marcFields);
    expect(full.marcFields!.filter((f) => f.tag === "650")).toHaveLength(2);
    const loans = await listEveryLoan(api);
    expect(loans).toHaveLength(4);
    expect(loans.filter((l) => l.state === "restituito")).toHaveLength(2);
    expect(loans.filter((l) => l.state === "in prestito")).toHaveLength(1);
    expect(loans.filter((l) => l.state === "in ritardo")).toHaveLength(1);
    const hist = await api.listBookLoans(full.id);
    expect(hist.availability).toBe("in prestito");
    expect(hist.loans.map((l) => l.effectiveDays).sort()).toEqual([20, 25, null]);

    // il backup v2 del catalogo appena popolato contiene tutto e si rilegge senza perdite
    const back = parseBackup(booksToJson(books, new Date(), loans));
    if (!back.ok) throw new Error(back.message);
    expect(back.loans).toHaveLength(4);
    expect(back.items).toHaveLength(6);
    expect(back.loanIssues).toEqual([]);

    // seconda importazione dello stesso file: nessuna scheda e nessun prestito duplicato
    const plan2 = planRestore(p.items, books);
    expect(plan2.every((x) => x.resolution === "salta")).toBe(true);
    const r2 = await applyRestore(api, plan2);
    expect(r2).toMatchObject({ created: 0, skipped: 6 });
    const l2 = await applyLoanRestore(api, await planLoanRestore(api, p.loans!, r2.idMap));
    expect(l2).toMatchObject({ created: 0, duplicates: 4 });
    expect((await api.listAllBooks())).toHaveLength(6);
    expect(await listEveryLoan(api)).toHaveLength(4);
  });
});

describe("Prestiti nel backup: casi limite", () => {
  const base = { bookTitle: "X", copyNo: 1, borrower: "Anna", contact: "", notes: "", loanDate: "2026-09-01", plannedDays: 14, dueDate: "2026-09-15", returnedDate: "2026-09-10" };
  it("copia n. 2 ripristinata, scheda non importata e prestito attivo in conflitto segnalati: nessun danno, motivi chiari", async () => {
    const api = client(await fresh());
    const b = await api.createBook(book({ title: "Esistente" }));
    await api.createLoan(b.id, { borrower: "Già in prestito", contact: "", loanDate: "2026-10-01", plannedDays: 30, notes: "" });
    const plan = await planLoanRestore(api, [
      { ...base, bookId: "id-file-1", copyNo: 2 },
      { ...base, bookId: "id-sconosciuto" },
      { ...base, bookId: "id-file-1", borrower: "Storico" }, // restituito: ammesso anche se ora il libro è in prestito
      { ...base, bookId: "id-file-1", borrower: "Altro attivo", loanDate: "2026-10-05", returnedDate: null, dueDate: "2026-11-04", plannedDays: 30 },
    ], { "id-file-1": b.id });
    expect(plan.blocked).toHaveLength(1);
    expect(plan.blocked[0]!.reason).toMatch(/già in prestito/);
    const res = await applyLoanRestore(api, plan);
    expect(res).toMatchObject({ created: 2, noBook: 1, blocked: 1, failed: [] });
    const h = await api.listBookLoans(b.id);
    expect(h.loans.map((l) => l.borrower).sort()).toEqual(["Anna", "Già in prestito", "Storico"]);
    expect(h.loans.find((l) => l.borrower === "Anna")!.copyNo).toBe(2);
  });
  it("API: prestito già concluso — date coerenti e nessun conflitto con un prestito attivo; date incoerenti rifiutate", async () => {
    const api = client(await fresh());
    const b = await api.createBook(book({ title: "Libro" }));
    await api.createLoan(b.id, { borrower: "Attivo", contact: "", loanDate: "2026-10-01", plannedDays: 30, notes: "" });
    const old = await api.createLoan(b.id, { borrower: "Vecchio", contact: "", loanDate: "2026-01-01", plannedDays: 10, notes: "", returnedDate: "2026-01-09" });
    expect(old).toMatchObject({ state: "restituito", effectiveDays: 8 });
    await expect(api.createLoan(b.id, { borrower: "x", contact: "", loanDate: "2026-02-01", plannedDays: 10, notes: "", returnedDate: "2026-01-31" })).rejects.toBeInstanceOf(BooksApiError);
    await expect(api.createLoan(b.id, { borrower: "x", contact: "", loanDate: "2026-02-01", plannedDays: 10, notes: "", returnedDate: "2026-10-16" })).rejects.toBeInstanceOf(BooksApiError);
    expect((await api.listBookLoans(b.id)).loans).toHaveLength(2);
  });
  it("il visualizzatore non può importare né scrivere prestiti: 403, importazione interrotta, nulla scritto", async () => {
    const db = await fresh();
    const v = client(db, "viewer");
    const p = parseBackup(testBackupJson(new Date(`${TODAY}T10:00:00Z`)));
    if (!p.ok) throw new Error(p.message);
    const res = await applyRestore(v, planRestore(p.items, []));
    expect(res.aborted).toBe(true);
    expect(res.created).toBe(0);
    expect((await client(db).listAllBooks())).toHaveLength(0);
    await expect(v.listLoans()).rejects.toMatchObject({ kind: "auth" });
  });
  it("backup v1 avvisa che non contiene prestiti; backup v2 incoerente è segnalato", () => {
    const v1 = parseBackup(booksToJson([]));
    expect(v1).toMatchObject({ ok: true, warnings: [expect.stringContaining("NON copie fisiche né prestiti")] });
    const bad = parseBackup(JSON.stringify({ format: "bibliotheca-backup", version: 2, books: [], loanCount: 3, loans: [{ bookId: "a", borrower: "", loanDate: "x", plannedDays: 0, copyNo: 1 }] }));
    if (!bad.ok) throw new Error(bad.message);
    expect(bad.loanIssues).toHaveLength(1);
    expect(bad.warnings.join(" ")).toMatch(/dichiara 3 prestiti/);
    expect(testLoans("2026-10-15")).toHaveLength(4);
  });
});

/* ---------- elenco di ISBN con fonti simulate ---------- */
const rec = (over: Partial<SourceRecord>): SourceRecord => ({ source: "openlibrary", sourceLabel: "Open Library", externalId: "1", granularity: "edizione", title: "Titolo fonte", authors: ["Nome Autore"], subjects: [], ...over });
const group = (over: Partial<ResultGroup>, records: SourceRecord[]): ResultGroup => ({ id: "g", match: "esatta", reason: "stesso ISBN", incomplete: false, missing: [], records, ...over });
const resp = (groups: ResultGroup[], sources: LookupResponse["sources"] = []): LookupResponse => ({ groups, sources, cached: false });
const noSleep = vi.fn(async () => {});
const stub = (fn: (isbn: string) => LookupResponse | Error): Pick<BooksApi, "lookupSources"> => ({ lookupSources: async (q) => { const r = fn(q.isbn!); if (r instanceof Error) throw r; return r; } });

describe("Elenco di ISBN", () => {
  it("lettura dell'elenco: separatori, trattini, ISBN-10, duplicati, formati e cifre di controllo errati", () => {
    const r = parseIsbnList("978-0-306-40615-7\n0306406152\n9780306406157; 123\n9780306406158,\r\n\n9781234567897");
    expect(r.isbns).toEqual(["9780306406157", "9781234567897"]);
    expect(r.issues.map((i) => i.title)).toEqual(["123", "9780306406158"]);
    expect(r.issues[1]!.errors[0]).toMatch(/cifra di controllo/);
    expect(r.warnings.join(" ")).toMatch(/ripetuto/);
  });
  it("accetta solo corrispondenze ESATTE, imposta «da revisionare», cita le fonti, segnala discordanze e non trovati", async () => {
    const api = stub((isbn) => isbn === "9780306406157"
      ? resp([group({}, [rec({ isbn13: isbn, publisher: "Editore A", publicationDate: "2001-05", language: "it", pages: 250, subjects: ["non importato"], description: "descrizione non importata" }), rec({ source: "googlebooks", sourceLabel: "Google Books", isbn13: isbn, publisher: "Editore B", publicationDate: "2001" })]), group({ match: "simile", id: "s" }, [rec({ title: "Altro libro" })])])
      : resp([group({ match: "simile" }, [rec({})])], [{ id: "loc", label: "Library of Congress", status: "timeout", count: 0 }]));
    const r = await lookupIsbnList(api, "9780306406157\n9781234567897", { sleep: noSleep, now: new Date("2026-10-15T10:00:00Z") });
    if (!r.ok) throw new Error(r.message);
    expect(r.items).toHaveLength(1);
    const it = r.items[0]!;
    expect(it.input).toMatchObject({ title: "Titolo fonte", authors: ["Nome Autore"], isbn: "9780306406157", publisher: "Editore A", publicationYear: "2001", status: "da revisionare", subjects: [] });
    expect(it.input.notes).toMatch(/15\/10\/2026|2026-10-15/);
    expect(it.input.notes).toMatch(/Open Library, Google Books/);
    expect(it.input.notes).not.toMatch(/descrizione non importata/);
    expect(it.notes?.join(" ")).toMatch(/non concordano su: .*Editore/);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]!.errors[0]).toMatch(/Nessuna corrispondenza esatta.*Library of Congress: timeout/);
  });
  it("dati solo d'opera: editore e anno non vengono importati; con una pausa tra le ricerche e senza cercare gli ISBN non validi", async () => {
    const calls: string[] = [];
    const sleep = vi.fn(async () => {});
    const api = stub((isbn) => { calls.push(isbn); return resp([group({}, [rec({ granularity: "opera", publisher: "Non edizione", publicationDate: "1999", isbn13: isbn })])]); });
    const r = await lookupIsbnList(api, "9780306406157\n9781234567897\n12\n", { sleep });
    if (!r.ok) throw new Error(r.message);
    expect(calls).toEqual(["9780306406157", "9781234567897"]);
    expect(sleep).toHaveBeenCalledTimes(1); // una pausa tra due ricerche
    expect(r.items[0]!.input.publisher).toBe("");
    expect(r.items[0]!.notes?.join(" ")).toMatch(/descrivono l'opera/);
    expect(r.issues).toHaveLength(1);
  });
  it("limite di ricerche al minuto: attende e riprova; errori diversi non fermano gli altri ISBN; errore di permessi interrompe tutto", async () => {
    let n = 0;
    const sleep = vi.fn(async () => {});
    const ok = resp([group({}, [rec({})])]);
    const api = stub((isbn) => { if (isbn === "9780306406157" && n++ === 0) return new BooksApiError("unavailable", "Troppe ricerche in poco tempo. Attendi un minuto e riprova."); if (isbn === "9781234567897") return new BooksApiError("network", "Rete assente."); return ok; });
    const r = await lookupIsbnList(api, "9780306406157\n9781234567897", { sleep });
    if (!r.ok) throw new Error(r.message);
    expect(sleep).toHaveBeenCalledWith(62_000);
    expect(r.items).toHaveLength(1);
    expect(r.issues[0]!.errors[0]).toMatch(/Rete assente/);
    const denied = await lookupIsbnList(stub(() => new BooksApiError("auth", "Operazione non consentita.")), "9780306406157", { sleep });
    expect(denied).toMatchObject({ ok: false, message: "Operazione non consentita." });
    expect(await lookupIsbnList(stub(() => resp([])), "   \n", { sleep })).toMatchObject({ ok: false });
  });
  it("interruzione volontaria: gli ISBN non cercati sono dichiarati", async () => {
    let stopAfter = 1;
    const r = await lookupIsbnList(stub(() => resp([group({}, [rec({})])])), "9780306406157\n9781234567897", { sleep: noSleep, shouldStop: () => stopAfter-- <= 0 });
    if (!r.ok) throw new Error(r.message);
    expect(r.items).toHaveLength(1);
    expect(r.warnings.join(" ")).toMatch(/interrotta.*dopo 1 ISBN su 2/);
  });
  it("tramite l'API reale: i record trovati entrano nel catalogo solo dopo il piano di importazione, come «da revisionare»", async () => {
    const api = client(await fresh());
    const r = await lookupIsbnList(stub(() => resp([group({}, [rec({ isbn13: "9780306406157" })])])), "9780306406157", { sleep: noSleep });
    if (!r.ok) throw new Error(r.message);
    expect(await api.listAllBooks()).toHaveLength(0); // trovare un risultato non crea nulla
    await applyRestore(api, planRestore(r.items, []));
    const [b] = await api.listAllBooks();
    expect(b).toMatchObject({ title: "Titolo fonte", status: "da revisionare", isbn: "9780306406157" });
  });
});
