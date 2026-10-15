import type { BackupLoan } from "./export";
import { BACKUP_FORMAT } from "./export";
import { addDays } from "./api/loans";
import { csvCell } from "./export";
import { CSV_HEADERS } from "./csv";
import type { BookInput, MarcField } from "./api/types";
import { emptyBookInput } from "./api/types";

/**
 * Record di PROVA, dichiaratamente fittizi: ogni titolo inizia con «[TEST]», lo stato è «bozza» e le note lo ripetono.
 * Non sono libri reali. Servono a provare campi incompleti, edizioni diverse della stessa opera, caratteri speciali,
 * MARC21 con campi ripetuti e prestiti (restituiti, in corso, in ritardo). Si scaricano dall'app e si importano solo su richiesta.
 * Gli ISBN sono numeri d'esempio con cifra di controllo valida (non sono associati a questi titoli fittizi).
 */
const NOTE = "RECORD DI PROVA, non è un libro reale. Cancellare dopo il collaudo.";
const base = (over: Partial<BookInput>): BookInput => ({ ...emptyBookInput(), status: "bozza", notes: NOTE, ...over });

const MARC_COMPLETO: MarcField[] = [
  { tag: "020", ind1: " ", ind2: " ", subfields: [{ code: "a", value: "9780306406157" }] },
  { tag: "100", ind1: "1", ind2: " ", subfields: [{ code: "a", value: "Cognome di Prova, Nome" }] },
  { tag: "245", ind1: "1", ind2: "0", subfields: [{ code: "a", value: "[TEST] Libro completo con MARC21" }, { code: "c", value: "Nome Cognome di Prova" }] },
  { tag: "264", ind1: " ", ind2: "1", subfields: [{ code: "a", value: "Città di Prova" }, { code: "b", value: "Editore di Prova" }, { code: "c", value: "2001" }] },
  { tag: "300", ind1: " ", ind2: " ", subfields: [{ code: "a", value: "250 pagine" }] },
  { tag: "650", ind1: " ", ind2: "4", subfields: [{ code: "a", value: "Soggetto di prova uno" }] },
  { tag: "650", ind1: " ", ind2: "4", subfields: [{ code: "a", value: "Soggetto di prova due" }] },
  { tag: "653", ind1: " ", ind2: " ", subfields: [{ code: "a", value: "parola chiave libera" }] },
];

export const TEST_BOOKS: { id: string; input: BookInput }[] = [
  { id: "00000000-0000-4000-8000-0000000000a1", input: base({ title: "[TEST] Libro completo con MARC21", authors: ["Cognome di Prova, Nome"], isbn: "9780306406157", publisher: "Editore di Prova", publicationPlace: "Città di Prova", publicationYear: "2001", language: "italiano", physicalDescription: "250 pagine", subjects: ["Soggetto di prova uno", "Soggetto di prova due"], shelfMark: "TEST-A1", marcLeader: "00000nam a2200000   4500", marcFields: MARC_COMPLETO }) },
  { id: "00000000-0000-4000-8000-0000000000a2", input: base({ title: "[TEST] Libro incompleto (solo titolo)" }) },
  { id: "00000000-0000-4000-8000-0000000000a3", input: base({ title: "[TEST] Opera in due edizioni", authors: ["Autore di Prova, Anna"], isbn: "9781234567897", publisher: "Editore Prima", publicationYear: "1999", language: "italiano" }) },
  { id: "00000000-0000-4000-8000-0000000000a4", input: base({ title: "[TEST] Opera in due edizioni", authors: ["Autore di Prova, Anna"], isbn: "9788800000000", publisher: "Editore Seconda", publicationYear: "2015", language: "italiano", physicalDescription: "320 pagine" }) },
  { id: "00000000-0000-4000-8000-0000000000a5", input: base({ title: "[TEST] Caratteri speciali: virgole, «virgolette», \"doppie\"; punto e virgola", authors: ["Zürcher, Jörg", "Dupont, Éloïse"], publisher: "Ñandú & Figli", publicationYear: "2010", language: "tedesco", subjects: ["Città: Lugano, Ticino"] }) },
  { id: "00000000-0000-4000-8000-0000000000a6", input: base({ title: "[TEST] Libro con prestito in ritardo", authors: ["Autore di Prova, Bruno"], isbn: "", publisher: "Editore di Prova", publicationYear: "2005" }) },
];

/** Prestiti di prova relativi alla data odierna: storico di 2 prestiti restituiti, uno in corso nei tempi, uno in ritardo. */
export function testLoans(today: string): BackupLoan[] {
  const L = (bookId: string, bookTitle: string, borrower: string, daysAgo: number, plannedDays: number, returnedAfter: number | null): BackupLoan => {
    const loanDate = addDays(today, -daysAgo);
    return { bookId, bookTitle, copyNo: 1, borrower, contact: "", notes: "PRESTITO DI PROVA", loanDate, plannedDays, dueDate: addDays(loanDate, plannedDays), returnedDate: returnedAfter === null ? null : addDays(loanDate, returnedAfter) };
  };
  const t = (i: number) => TEST_BOOKS[i]!;
  return [
    L(t(0).id, t(0).input.title, "Persona di Prova Uno", 120, 30, 25),
    L(t(0).id, t(0).input.title, "Persona di Prova Due", 60, 14, 20), // restituito con ritardo
    L(t(0).id, t(0).input.title, "Persona di Prova Tre", 3, 30, null), // in corso, nei tempi
    L(t(5).id, t(5).input.title, "Persona di Prova Quattro", 50, 14, null), // in ritardo
  ];
}

export function testBackupJson(now = new Date()): string {
  const today = now.toISOString().slice(0, 10);
  const loans = testLoans(today);
  const books = TEST_BOOKS.map((b) => ({ id: b.id, createdAt: now.toISOString(), updatedAt: now.toISOString(), ...b.input }));
  const copies = [...new Map(loans.map((l) => [`${l.bookId}#${l.copyNo}`, { bookId: l.bookId, copyNo: l.copyNo }])).values()];
  return JSON.stringify({ format: BACKUP_FORMAT, version: 2, exportedAt: now.toISOString(), count: books.length, loanCount: loans.length, books, copies, loans }, null, 2);
}

export function testCatalogCsv(): string {
  const cols: ((b: BookInput) => string)[] = [
    (b) => b.title, (b) => b.authors.join(" | "), (b) => b.isbn, (b) => b.publisher, (b) => b.publicationPlace, (b) => b.publicationYear, (b) => b.language,
    (b) => b.physicalDescription, (b) => b.subjects.join(" | "), (b) => b.dewey, (b) => b.deweySource, (b) => b.deweyNotes, (b) => b.shelfMark, (b) => b.notes, (b) => b.status,
  ];
  return "﻿" + [CSV_HEADERS.join(","), ...TEST_BOOKS.map((b) => cols.map((f) => csvCell(f(b.input))).join(","))].join("\r\n") + "\r\n";
}
