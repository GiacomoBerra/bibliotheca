import { describe, expect, it } from "vitest";
import { checkIsbn } from "./isbn";
import { bookToRow, escapeLike, rowToBook, searchTerms, type BookRow } from "./mapping";
import { mapSupabaseError } from "./errors";
import { validateBook, warnings } from "./validation";
import { emptyBookInput } from "./types";
import { booksToCsv, booksToJson, csvCell } from "../export";
import { makeBook } from "@/test/memoryApi";

describe("ISBN", () => {
  it.each([["978-88-04-12345-6", "controllo"], ["9780306406157", "ok"], ["0-306-40615-2", "ok"], ["080442957X", "ok"], ["123", "formato"], ["", "vuoto"], ["97803064061570", "formato"]])("%s → %s", (v, r) => {
    expect(checkIsbn(v)).toBe(r);
  });
});

describe("validazione", () => {
  it("solo il titolo è obbligatorio", () => {
    expect(validateBook({ ...emptyBookInput(), title: "Solo titolo" })).toEqual({});
    expect(validateBook(emptyBookInput()).title).toMatch(/obbligatorio/);
    expect(validateBook({ ...emptyBookInput(), title: "   " }).title).toBeDefined();
  });
  it("ISBN: formato errato blocca, cifra di controllo errata solo avvisa", () => {
    expect(validateBook({ ...emptyBookInput(), title: "x", isbn: "12ab" }).isbn).toBeDefined();
    const sbagliato = { ...emptyBookInput(), title: "x", isbn: "9780306406158" };
    expect(validateBook(sbagliato).isbn).toBeUndefined();
    expect(warnings(sbagliato).isbn).toMatch(/cifra di controllo/);
  });
  it("limiti di lunghezza uguali a quelli del database", () => {
    expect(validateBook({ ...emptyBookInput(), title: "x".repeat(501) }).title).toMatch(/massimo 500/);
    expect(validateBook({ ...emptyBookInput(), title: "x", notes: "n".repeat(5001) }).notes).toBeDefined();
  });
});

describe("mapping righe ↔ schede", () => {
  const row: BookRow = { id: "1", title: "T", authors: null, isbn: null, publisher: null, publication_place: null, publication_year: null, language: null, physical_description: null, notes: null, subjects: null, dewey: null, shelf_mark: null, status: "strano", marc_leader: null, marc_fields: null, created_at: "c", updated_at: "u" };
  it("record incompleto: NULL → stringhe vuote e liste vuote; stato sconosciuto → bozza", () => {
    const b = rowToBook(row);
    expect(b).toMatchObject({ authors: [], isbn: "", subjects: [], status: "bozza", marcFields: null });
  });
  it("scrittura: stringhe vuote → NULL, liste ripulite, nessun user_id", () => {
    const r = bookToRow({ ...emptyBookInput(), title: "  Titolo ", authors: [" A ", ""], isbn: " " });
    expect(r).toMatchObject({ title: "Titolo", authors: ["A"], isbn: null });
    expect(r).not.toHaveProperty("user_id");
  });
  it("MARC valido è conservato con ordine, ripetizioni e indicatori; MARC malformato è ignorato", () => {
    const fields = [{ tag: "650", ind1: " ", ind2: "7", subfields: [{ code: "a", value: "x" }, { code: "a", value: "y" }] }, { tag: "001", value: "id" }];
    expect(rowToBook({ ...row, marc_fields: fields }).marcFields).toEqual(fields);
    expect(rowToBook({ ...row, marc_fields: [{ tag: 1 }] }).marcFields).toBeNull();
    expect(bookToRow({ ...emptyBookInput(), title: "t", marcFields: fields }).marc_fields).toEqual(fields);
  });
});

describe("ricerca", () => {
  it("termini normalizzati e limitati", () => {
    expect(searchTerms("  ASTRONOMIA   per ")).toEqual(["astronomia", "per"]);
    expect(searchTerms("a b c d e f g h i j")).toHaveLength(8);
    expect(searchTerms("978-0-306-40615-7")).toEqual(["9780306406157"]);
    expect(searchTerms("1999-2001")).toEqual(["1999-2001"]);
  });
  it("escapeLike neutralizza % _ e \\", () => {
    expect(escapeLike("100%_a\\b")).toBe("100\\%\\_a\\\\b");
  });
});

describe("errori", () => {
  it("messaggi italiani senza dettagli interni", () => {
    expect(mapSupabaseError({ message: "JWT expired", code: "PGRST301" }).kind).toBe("auth");
    expect(mapSupabaseError({ message: "new row violates row-level security policy", code: "42501" }).kind).toBe("auth");
    expect(mapSupabaseError({ message: "TypeError: Failed to fetch" }).kind).toBe("network");
    expect(mapSupabaseError({ message: "violates check constraint", code: "23514" }).kind).toBe("validation");
    expect(mapSupabaseError({ message: "relation \"books\" secret detail" }).message).not.toMatch(/relation|secret/);
  });
});

describe("esportazione", () => {
  const b = makeBook({ id: "1", title: "=HYPERLINK(\"x\")", authors: ["Rossi, Anna", "Verdi, Luca"], notes: "riga1\nriga2, con virgola" });
  it("JSON: formato, versione e conteggio", () => {
    const j = JSON.parse(booksToJson([b], new Date("2026-01-02T03:04:05Z")));
    expect(j).toMatchObject({ format: "bibliotheca-backup", version: 1, count: 1, exportedAt: "2026-01-02T03:04:05.000Z" });
    expect(j.books[0].id).toBe("1");
  });
  it("CSV: BOM, intestazione, virgolette e protezione dalle formule", () => {
    const csv = booksToCsv([b]);
    expect(csv.startsWith("﻿titolo,autori")).toBe(true);
    expect(csv).toContain("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csv).toContain("\"riga1\nriga2, con virgola\"");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("normale")).toBe("normale");
  });
});
