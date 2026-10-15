import { describe, expect, it } from "vitest";
import { parseSpokenRequest } from "./spoken";
import { applyPlan, buildPlan, undoImport, type ImportField, type PlanRow } from "./importPlan";
import { emptyBookInput } from "@/lib/api/types";
import type { ResultGroup, SourceRecord } from "./types";

describe("Interpretazione della richiesta dettata", () => {
  it("italiano: esempio della specifica", () => {
    expect(parseSpokenRequest("Voglio catalogare Il nome della rosa di Umberto Eco, pubblicato da Bompiani nel 1980.", "it")).toEqual({ title: "Il nome della rosa", author: "Umberto Eco", publisher: "Bompiani", year: "1980", isbn: "" });
  });
  it("italiano: ISBN dettato con spazi e parola «ISBN»", () => {
    expect(parseSpokenRequest("cerca ISBN 978 0 306 40615 7", "it")).toMatchObject({ isbn: "9780306406157", title: "" });
  });
  it("inglese, tedesco, francese", () => {
    expect(parseSpokenRequest("I want to catalog The Name of the Rose by Umberto Eco published by Bompiani in 1980", "en")).toMatchObject({ title: "The Name of the Rose", author: "Umberto Eco", publisher: "Bompiani", year: "1980" });
    expect(parseSpokenRequest("Ich möchte Der Name der Rose von Umberto Eco katalogisieren", "de").title).not.toBe("");
    expect(parseSpokenRequest("Ich möchte Der Name der Rose von Umberto Eco hinzufügen, erschienen bei Hanser im 1982", "de")).toMatchObject({ title: "Der Name der Rose", author: "Umberto Eco", publisher: "Hanser", year: "1982" });
    expect(parseSpokenRequest("Je veux cataloguer Le nom de la rose de Umberto Eco, publié par Grasset en 1982", "fr")).toMatchObject({ title: "Le nom de la rose", author: "Umberto Eco", publisher: "Grasset", year: "1982" });
  });
  it("un titolo che inizia con «Libro» non viene scambiato per la parola introduttiva", () => {
    expect(parseSpokenRequest("Libro di prova di Anna Rossi", "it")).toMatchObject({ title: "Libro di prova", author: "Anna Rossi" });
  });
  it("solo titolo, testo vuoto o senza schema: non inventa nulla", () => {
    expect(parseSpokenRequest("Il nome della rosa", "it")).toEqual({ title: "Il nome della rosa", author: "", publisher: "", year: "", isbn: "" });
    expect(parseSpokenRequest("   ", "it")).toEqual({ title: "", author: "", publisher: "", year: "", isbn: "" });
  });
});

const rec = (o: Partial<SourceRecord>): SourceRecord => ({ source: "googlebooks", sourceLabel: "Google Books", externalId: "1", granularity: "edizione", title: "Libro", authors: ["Anna Rossi"], subjects: [], ...o });
const group = (records: SourceRecord[]): ResultGroup => ({ id: "g1", match: "probabile", reason: "", incomplete: false, missing: [], records });

describe("Piano di importazione", () => {
  const g = group([
    rec({ title: "Libro", subtitle: "sottotitolo", isbn13: "9780306406157", publisher: "Alfa", publicationDate: "1980-05-01", language: "it", pages: 320, subjects: ["Prova"], description: "Descr." }),
    rec({ source: "openlibrary", sourceLabel: "Open Library", externalId: "2", title: "Libro", publisher: "Alfa", publicationDate: "1981", publicationPlace: "Milano" }),
  ]);
  it("propone solo valori presenti nelle fonti, con provenienza; segnala valori discordanti", () => {
    const rows = buildPlan(g, emptyBookInput());
    const by = Object.fromEntries(rows.map((r) => [r.field, r])) as Record<ImportField, PlanRow>;
    expect(by.publisher.candidates).toEqual([{ value: "Alfa", sources: ["Google Books", "Open Library"] }]);
    expect(by.publicationYear.candidates.map((c) => [c.value, c.sources])).toEqual([["1980", ["Google Books"]], ["1981", ["Open Library"]]]);
    expect(by.publicationPlace.candidates[0]!.sources).toEqual(["Open Library"]);
    expect(by.physicalDescription.candidates[0]!.value).toBe("320 pagine");
    expect(by.title.candidates.map((c) => c.value)).toEqual(["Libro", "Libro: sottotitolo"]);
    expect(by.authors.candidates[0]!.note).toMatch(/non invertiti/);
    expect(by.subjects.defaultUse).toBe(false);
    expect(by.notes.defaultUse).toBe(false);
    expect(by.publisher.defaultUse).toBe(true);
  });
  it("campi senza dati: nessun candidato (segnalati come «non trovato»)", () => {
    const res = applyPlan(emptyBookInput(), buildPlan(group([rec({})]), emptyBookInput()), {});
    expect(res.notFound).toEqual(expect.arrayContaining(["isbn", "publisher", "publicationYear", "publicationPlace", "language", "physicalDescription", "notes", "subjects"]));
  });
  it("un record a livello di opera propone solo titolo, autori e soggetti", () => {
    const rows = buildPlan(group([rec({ source: "openlibrary", sourceLabel: "Open Library", granularity: "opera", isbns: ["9780306406157"], publisher: "Alfa", publicationDate: "1980", language: "ita", pages: 300, subjects: ["Prova"] })]), emptyBookInput());
    expect(rows.filter((r) => r.candidates.length).map((r) => r.field)).toEqual(["title", "authors", "subjects"]);
  });
  it("i valori già compilati a mano non vengono sovrascritti senza conferma esplicita", () => {
    const cur = { ...emptyBookInput(), title: "Titolo mio", publisher: "Mio editore", authors: ["Mio, Autore"] };
    const rows = buildPlan(g, cur);
    const by = Object.fromEntries(rows.map((r) => [r.field, r])) as Record<ImportField, PlanRow>;
    expect(by.title.conflict && !by.title.defaultUse).toBe(true);
    expect(by.publisher.conflict && !by.publisher.defaultUse).toBe(true);
    // selezione di default: i campi in conflitto restano intatti
    const sel = Object.fromEntries(rows.map((r) => [r.field, { use: r.defaultUse, choice: 0 }]));
    const res = applyPlan(cur, rows, sel);
    expect(res.next).toMatchObject({ title: "Titolo mio", publisher: "Mio editore", authors: ["Mio, Autore"], publicationYear: "1980" });
    // con la spunta esplicita il campo viene sostituito
    const res2 = applyPlan(cur, rows, { ...sel, publisher: { use: true, choice: 0 } });
    expect(res2.next.publisher).toBe("Alfa");
    expect(res2.applied.find((a) => a.field === "publisher")).toMatchObject({ previous: "Mio editore", sources: ["Google Books", "Open Library"] });
  });
  it("la scelta tra valori discordanti viene rispettata", () => {
    const rows = buildPlan(g, emptyBookInput());
    const res = applyPlan(emptyBookInput(), rows, { publicationYear: { use: true, choice: 1 } });
    expect(res.next.publicationYear).toBe("1981");
  });
  it("la struttura MARC21, Dewey, collocazione e stato non vengono mai toccati", () => {
    const marc = [{ tag: "650", ind1: " ", ind2: "7", subfields: [{ code: "a", value: "Uno" }, { code: "a", value: "Due" }] }, { tag: "650", ind1: " ", ind2: "7", subfields: [{ code: "a", value: "Tre" }] }];
    const cur = { ...emptyBookInput(), marcLeader: "00000nam a2200000 a 4500", marcFields: marc, dewey: "002.09", shelfMark: "A1", status: "catalogato" as const };
    const rows = buildPlan(g, cur);
    const all = Object.fromEntries(rows.map((r) => [r.field, { use: true, choice: 0 }]));
    const res = applyPlan(cur, rows, all);
    expect(res.next.marcFields).toBe(cur.marcFields);
    expect(res.next).toMatchObject({ marcLeader: cur.marcLeader, marcFields: marc, dewey: "002.09", shelfMark: "A1", status: "catalogato" });
  });
  it("annullamento: ripristina i valori precedenti dei soli campi importati", () => {
    const cur = { ...emptyBookInput(), publisher: "Vecchio", notes: "Mie note" };
    const rows = buildPlan(g, cur);
    const res = applyPlan(cur, rows, { publisher: { use: true, choice: 0 }, publicationYear: { use: true, choice: 0 } });
    expect(res.next.publisher).toBe("Alfa");
    const back = undoImport({ ...res.next, notes: "Modificate dopo" }, res.applied);
    expect(back).toMatchObject({ publisher: "Vecchio", publicationYear: "", notes: "Modificate dopo" });
  });
});
