// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createHttpBooksApi } from "../src/lib/api/httpBooksApi";
import { emptyBookInput, type Book, type BookInput, type MarcField } from "../src/lib/api/types";
import { applyRestore, parseBackup, planRestore } from "../src/lib/backup";
import { booksToCsv, booksToJson, booksToMarcText } from "../src/lib/export";
import { handle } from "./router";
import { makeDeps, makeTestDb } from "./testHarness";
import type { Db } from "./db";

const dbs: { db: Db; raw: PGlite }[] = [];
const newDb = async () => { const d = await makeTestDb(); dbs.push(d); return d.db; };
afterAll(async () => { await Promise.all(dbs.map((d) => d.raw.close())); });

const client = (db: Db, roles = "admin") =>
  createHttpBooksApi({
    fetch: async (url, init) => {
      const headers = new Headers(init?.headers);
      headers.set("x-test-session", "u1"); headers.set("x-test-roles", roles);
      return handle(new Request(`https://bibliotheca.test${url as string}`, { ...init, headers: { ...Object.fromEntries(headers), origin: "https://bibliotheca.test" } }), makeDeps(db));
    },
  });

const marc: MarcField[] = [
  { tag: "001", value: "ctl" },
  { tag: "245", ind1: "1", ind2: "0", subfields: [{ code: "a", value: "Titolo" }, { code: "b", value: "sotto" }] },
  { tag: "650", ind1: " ", ind2: "7", subfields: [{ code: "a", value: "Uno" }, { code: "2", value: "x" }] },
  { tag: "650", ind1: " ", ind2: "7", subfields: [{ code: "a", value: "Due" }] },
];
const full = (over: Partial<BookInput> = {}): BookInput => ({
  ...emptyBookInput(), title: "Completo", authors: ["Rossi, Anna", "Verdi, Luca"], isbn: "9780306406157", publisher: "Alfa", publicationPlace: "Milano", publicationYear: "1980",
  language: "italiano", physicalDescription: "300 p.", notes: "Nota", subjects: ["Uno", "Due"], dewey: "853.914", deweyNotes: "DDC da controllare", deweySource: "fonte-esterna", shelfMark: "A1",
  status: "catalogato", marcLeader: "00000nam a2200000 a 4500", marcFields: marc, ...over,
});
const strip = (b: Book | BookInput) => { const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = b as Book; return rest; };

import { vi } from "vitest";
vi.setConfig({ testTimeout: 30_000 });
describe("Backup JSON: esportazione e ripristino su database reale", () => {
  it("ripristino completo: tutti i campi, MARC21 (ordine, ripetizioni, indicatori), soggetti e Dewey tornano identici", async () => {
    const src = client(await newDb());
    await src.createBook(full());
    await src.createBook(full({ title: "Secondo", isbn: "", authors: ["Bianchi, Marco"], marcLeader: null, marcFields: null, dewey: "", deweySource: "", deweyNotes: "" }));
    const json = booksToJson(await src.listAllBooks());

    const dstDb = await newDb();
    const dst = client(dstDb);
    const parsed = parseBackup(json);
    if (!parsed.ok) throw new Error(parsed.message);
    expect(parsed.issues).toEqual([]);
    const plan = planRestore(parsed.items, await dst.listAllBooks());
    expect(plan.every((p) => p.relation === "nuova" && p.resolution === "crea")).toBe(true);
    const res = await applyRestore(dst, plan);
    expect(res).toMatchObject({ created: 2, updated: 0, skipped: 0, failed: [], aborted: false });

    const a = (await src.listAllBooks()).map(strip).sort((x, y) => x.title.localeCompare(y.title));
    const b = (await dst.listAllBooks()).map(strip).sort((x, y) => x.title.localeCompare(y.title));
    expect(b).toEqual(a);
    expect(b.find((x) => x.title === "Completo")!.marcFields).toEqual(marc);
  });

  it("secondo ripristino dello stesso file: tutto in conflitto, di default salta, nulla duplicato né cancellato", async () => {
    const db = await newDb();
    const c = client(db);
    await c.createBook(full());
    const parsed = parseBackup(booksToJson(await c.listAllBooks()));
    if (!parsed.ok) throw new Error();
    const plan = planRestore(parsed.items, await c.listAllBooks());
    expect(plan[0]).toMatchObject({ relation: "stesso-id", resolution: "salta" });
    const res = await applyRestore(c, plan);
    expect(res).toMatchObject({ created: 0, updated: 0, skipped: 1 });
    expect((await c.listAllBooks())).toHaveLength(1);
  });

  it("«aggiorna» sostituisce i dati della scheda esistente senza crearne di nuove; «crea comunque» aggiunge un duplicato scelto dall'utente", async () => {
    const c = client(await newDb());
    const orig = await c.createBook(full());
    const parsed = parseBackup(booksToJson([{ ...orig, title: "Titolo corretto" }]));
    if (!parsed.ok) throw new Error();
    let plan = planRestore(parsed.items, await c.listAllBooks());
    plan = plan.map((p) => ({ ...p, resolution: "aggiorna" as const }));
    expect(await applyRestore(c, plan)).toMatchObject({ updated: 1, created: 0 });
    expect((await c.getBook(orig.id))!.title).toBe("Titolo corretto");
    plan = plan.map((p) => ({ ...p, resolution: "crea" as const }));
    await applyRestore(c, plan);
    expect(await c.listAllBooks()).toHaveLength(2);
  });

  it("rileva duplicati per ISBN e per titolo+autore, e duplicati dentro il file", async () => {
    const c = client(await newDb());
    await c.createBook(full());
    await c.createBook(full({ title: "Altro libro", isbn: "", authors: ["Neri, Paola"] }));
    const items = [
      { index: 0, input: full({ title: "Titolo diverso", isbn: "978-0-306-40615-7" }) },
      { index: 1, input: full({ title: "ALTRO libro!", isbn: "", authors: ["Neri, Paola"] }) },
      { index: 2, input: full({ title: "Nuovo", isbn: "9781234567897", authors: ["Gialli, Eva"] }) },
      { index: 3, input: full({ title: "Nuovo", isbn: "9781234567897", authors: ["Gialli, Eva"] }) },
    ];
    expect(planRestore(items, await c.listAllBooks()).map((p) => p.relation)).toEqual(["stesso-isbn", "stesso-titolo-autore", "nuova", "duplicato-nel-file"]);
  });

  it("file non valido o danneggiato: errore chiaro, nessuna scrittura", async () => {
    expect(parseBackup("{non json")).toMatchObject({ ok: false, message: expect.stringContaining("non è un JSON valido") });
    expect(parseBackup(JSON.stringify({ format: "altro", version: 1, books: [] }))).toMatchObject({ ok: false });
    expect(parseBackup(JSON.stringify({ format: "bibliotheca-backup", version: 99, books: [] }))).toMatchObject({ ok: false, message: expect.stringContaining("non supportata") });
    expect(parseBackup(JSON.stringify({ format: "bibliotheca-backup", version: 1 }))).toMatchObject({ ok: false });
    expect(parseBackup("[]")).toMatchObject({ ok: false });
  });

  it("schede non valide (titolo mancante, MARC malformato) escluse e spiegate; le valide restano; conteggio incoerente segnalato", () => {
    const text = JSON.stringify({
      format: "bibliotheca-backup", version: 1, count: 5,
      books: [full(), { title: "" }, full({ title: "MARC rotto", marcFields: [{ tag: "245", ind1: "10", ind2: "0", subfields: [{ code: "a", value: "x" }] }] }), { title: 5 }],
    });
    const p = parseBackup(text);
    if (!p.ok) throw new Error();
    expect(p.items).toHaveLength(1);
    expect(p.issues.map((i) => i.index)).toEqual([1, 2, 3]);
    expect(p.warnings.join(" ")).toMatch(/dichiara 5 schede ma ne contiene 4/);
  });

  it("il file non può imporre autori o identificatori: i campi sconosciuti sono ignorati e l'id originale non viene riusato", async () => {
    const c = client(await newDb());
    const fid = "11111111-1111-4111-8111-111111111111";
    const p = parseBackup(JSON.stringify({ format: "bibliotheca-backup", version: 1, books: [{ ...full(), id: fid, createdBy: "intruso", owner_id: "x" }] }));
    if (!p.ok) throw new Error();
    await applyRestore(c, planRestore(p.items, []));
    const [b] = await c.listAllBooks();
    expect(b!.id).not.toBe(fid);
    expect(JSON.stringify(b)).not.toMatch(/intruso/);
  });

  it("un visualizzatore non può ripristinare: il server rifiuta (403) e il ripristino si interrompe senza scrivere", async () => {
    const db = await newDb();
    const viewer = client(db, "viewer");
    const p = parseBackup(booksToJson([{ ...(await client(db).createBook(full())), id: "x" } as Book]));
    if (!p.ok) throw new Error();
    const before = (await client(db).listAllBooks()).length;
    const res = await applyRestore(viewer, planRestore(p.items, []));
    expect(res).toMatchObject({ created: 0, aborted: true });
    expect(res.failed).toHaveLength(1);
    expect((await client(db).listAllBooks()).length).toBe(before);
  });
});

describe("Esportazioni", () => {
  it("l'esportazione completa dal server è riservata agli admin; CSV neutralizza le formule; MARC testuale non è ISO 2709", async () => {
    const db = await newDb();
    const admin = client(db);
    await admin.createBook(full({ title: "=SOMMA(A1)" }));
    const books = await admin.listAllBooks();
    expect(booksToCsv(books)).toContain("'=SOMMA(A1)");
    expect(booksToCsv(books).split("\r\n")[0]).toContain("dewey_fonte");
    const m = booksToMarcText(books);
    expect(m.count).toBe(1);
    expect(m.text).toContain("=245  10$aTitolo$bsotto");
    expect(m.text).not.toMatch(/\u001e|\u001d/); // nessun separatore ISO 2709
    await expect(client(db, "viewer").listAllBooks()).rejects.toMatchObject({ kind: "auth" });
  });
});
