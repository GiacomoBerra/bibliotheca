import { BooksApiError } from "@/lib/api/errors";
import { emptyBookInput, type Book, type BookInput, type BooksApi, type ListOptions } from "@/lib/api/types";
import { addDays, availabilityOf, summarizeAvailability, type BookAvailability, daysBetween, loanDerived, parseCorrectionInput, parseLoanEdit, parseLoanInput, type Loan, type LoanCorrection } from "@/lib/api/loans";
import { searchTerms } from "@/lib/api/mapping";

export function makeBook(over: Partial<Book> & { id: string; title: string }): Book {
  return { ...emptyBookInput(), createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", ...over };
}

/** Livello dati in memoria con la stessa interfaccia di produzione, per testare le schermate. */
export function makeMemoryApi(initial: Book[] = [], opts: { failWith?: string; lookup?: BooksApi["lookupSources"]; today?: string; role?: "admin" | "viewer" } = {}) {
  let books = [...initial];
  let n = 100;
  const fail = () => { if (opts.failWith) throw new BooksApiError("network", opts.failWith); };
  const text = (b: Book) => [b.title, b.authors.join(" "), b.isbn, b.isbn.replace(/[-\s]/g, ""), b.publisher, b.subjects.join(" "), b.dewey, b.shelfMark].join(" ").toLowerCase();
  const today = opts.today ?? "2026-10-15";
  let loans: Loan[] = [];
  const lid = () => `loan-${loans.length + 1}`;
  const refresh = (l: Loan): Loan => ({ ...l, ...loanDerived(l, today) });
  let corrections: LoanCorrection[] = [];
  const forced: Record<string, BookAvailability> = {};
  const availOf = (bookId: string): BookAvailability => {
    if (forced[bookId]) return forced[bookId]!;
    const act = loans.filter((l) => l.bookId === bookId && !l.returnedDate && !l.voidedAt).map(refresh);
    return summarizeAvailability(1, act.length, act.filter((l) => l.state === "in ritardo").length);
  };
  const redact = (l: Loan): Loan => (opts.role === "viewer" ? { ...l, borrower: null, contact: null, notes: null, voidReason: null, voidedBy: null } : l);
  const nCorr = (l: Loan): Loan => ({ ...l, correctionCount: corrections.filter((c) => c.loanId === l.id).length });
  const api: BooksApi & { all(): Book[]; allLoans(): Loan[]; forceAvailability(bookId: string, a: BookAvailability): void } = {
    all: () => books,
    allLoans: () => loans,
    /** Prova delle schermate con più copie fisiche (il modello dati le prevede; l'interfaccia non le crea ancora). */
    forceAvailability: (bookId: string, a: BookAvailability) => { forced[bookId] = a; },
    async listBookLoans(bookId) {
      fail();
      const mine = loans.filter((l) => l.bookId === bookId).map(refresh).map(nCorr).sort((a, b) => (a.loanDate < b.loanDate ? 1 : -1));
      return { availability: availabilityOf(mine), loans: mine.map(redact) };
    },
    async listLoans(o = {}) {
      fail();
      let r = loans.map(refresh).map(nCorr);
      if (o.borrower) r = r.filter((l) => (l.borrower ?? "").toLowerCase().includes(o.borrower!.toLowerCase()));
      if (o.state === "attivi") r = r.filter((l) => !l.returnedDate && !l.voidedAt);
      if (o.state === "annullati") r = r.filter((l) => l.voidedAt);
      if (o.state === "in ritardo") r = r.filter((l) => l.state === "in ritardo");
      if (o.state === "restituiti") r = r.filter((l) => l.returnedDate && !l.voidedAt);
      if (o.from) r = r.filter((l) => l.loanDate >= o.from!);
      if (o.to) r = r.filter((l) => l.loanDate <= o.to!);
      return { items: r, total: r.length, page: 1, pageSize: 25 };
    },
    async createLoan(bookId, input) {
      fail();
      const p = parseLoanInput(input);
      if (!p.ok) throw new BooksApiError("validation", Object.values(p.errors).join(" "));
      const book = books.find((b) => b.id === bookId);
      if (!book) throw new BooksApiError("notfound", "Il libro non esiste più.");
      if (!input.returnedDate && loans.some((l) => l.bookId === bookId && !l.returnedDate && !l.voidedAt)) throw new BooksApiError("conflict", "Questa copia risulta già in prestito: registra prima la restituzione.");
      const dueDate = addDays(input.loanDate, input.plannedDays);
      const l = refresh({ id: lid(), bookId, bookTitle: book.title, copyId: `copy-${bookId}`, copyNo: 1, borrower: input.borrower.trim(), contact: input.contact.trim() || null, notes: input.notes.trim() || null, loanDate: input.loanDate, plannedDays: input.plannedDays, dueDate, returnedDate: input.returnedDate ?? null, state: "in prestito", effectiveDays: null, daysLate: 0, voidedAt: null, voidReason: null, voidedBy: null, correctionCount: 0 });
      const vr = input.voidedRestore;
      if (vr) {
        const v = refresh({ ...l, voidedAt: "2026-10-15T10:00:00Z", voidReason: vr.reason, voidedBy: "admin" });
        corrections = [{ id: `c-${corrections.length + 1}`, loanId: l.id, action: "annulla_prestito", reason: `Ripristinato da backup. Annullamento originale del ${vr.originalAt} da ${vr.originalBy}: ${vr.reason}`, correctedBy: "admin", correctedAt: "2026-10-15T10:00:00Z", before: { state: l.returnedDate ? "restituito" : "attivo", returnedDate: l.returnedDate, returnedBy: null, voided: false }, after: { state: "annullato", returnedDate: l.returnedDate, returnedBy: null, voided: true, restoredFrom: { at: vr.originalAt, by: vr.originalBy, reason: vr.reason } } }, ...corrections];
        loans = [v, ...loans];
        return nCorr(v);
      }
      loans = [l, ...loans];
      return l;
    },
    async returnLoan(id, returnedDate) {
      fail();
      const cur = loans.find((l) => l.id === id);
      if (!cur) throw new BooksApiError("notfound", "Prestito non trovato.");
      if (cur.voidedAt) throw new BooksApiError("conflict", "Questo prestito è stato annullato.");
      if (cur.returnedDate) throw new BooksApiError("conflict", "Questo prestito è già stato restituito.");
      const date = returnedDate ?? today;
      if (daysBetween(cur.loanDate, date) < 0) throw new BooksApiError("validation", "La restituzione non può precedere l'inizio del prestito.");
      const l = refresh({ ...cur, returnedDate: date });
      loans = loans.map((x) => (x.id === id ? l : x));
      return l;
    },
    async voidLoan(id, reason) {
      fail();
      const p = parseCorrectionInput({ reason });
      if (!p.ok) throw new BooksApiError("validation", Object.values(p.errors).join(" "));
      const cur = loans.find((l) => l.id === id);
      if (!cur) throw new BooksApiError("notfound", "Prestito non trovato.");
      if (cur.voidedAt) throw new BooksApiError("conflict", "Questo prestito risulta già annullato.");
      const after = refresh({ ...cur, voidedAt: "2026-10-15T10:00:00Z", voidReason: p.value.reason, voidedBy: "admin" });
      loans = loans.map((x) => (x.id === id ? after : x));
      corrections = [{ id: `c-${corrections.length + 1}`, loanId: id, action: "annulla_prestito", reason: p.value.reason, correctedBy: "admin", correctedAt: "2026-10-15T10:00:00Z", before: { state: cur.returnedDate ? "restituito" : "attivo", returnedDate: cur.returnedDate, returnedBy: null, voided: false }, after: { state: "annullato", returnedDate: cur.returnedDate, returnedBy: null, voided: true } }, ...corrections];
      return nCorr(after);
    },
    async undoLoanReturn(id, reason) {
      fail();
      const p = parseCorrectionInput({ reason });
      if (!p.ok) throw new BooksApiError("validation", Object.values(p.errors).join(" "));
      const cur = loans.find((l) => l.id === id);
      if (!cur) throw new BooksApiError("notfound", "Prestito non trovato.");
      if (cur.voidedAt) throw new BooksApiError("conflict", "Questo prestito è stato annullato.");
      if (!cur.returnedDate) throw new BooksApiError("conflict", "Questo prestito non risulta restituito.");
      if (loans.some((l) => l.id !== id && l.bookId === cur.bookId && !l.voidedAt && l.loanDate >= cur.loanDate)) throw new BooksApiError("conflict", "Non si può annullare la restituzione: la copia è stata prestata di nuovo.");
      const after = refresh({ ...cur, returnedDate: null });
      loans = loans.map((x) => (x.id === id ? after : x));
      corrections = [{ id: `c-${corrections.length + 1}`, loanId: id, action: "annulla_restituzione", reason: p.value.reason, correctedBy: "admin", correctedAt: "2026-10-15T10:00:00Z", before: { state: "restituito", returnedDate: cur.returnedDate, returnedBy: "admin", voided: false }, after: { state: "attivo", returnedDate: null, returnedBy: null, voided: false } }, ...corrections];
      return nCorr(after);
    },
    async listLoanCorrections(id) {
      fail();
      return corrections.filter((c) => c.loanId === id);
    },
    async updateLoan(id, input) {
      fail();
      const p = parseLoanEdit(input);
      if (!p.ok) throw new BooksApiError("validation", Object.values(p.errors).join(" "));
      const cur = loans.find((l) => l.id === id);
      if (!cur) throw new BooksApiError("notfound", "Prestito non trovato.");
      const l = refresh({ ...cur, borrower: input.borrower, contact: input.contact || null, notes: input.notes || null, plannedDays: input.plannedDays, dueDate: addDays(cur.loanDate, input.plannedDays) });
      loans = loans.map((x) => (x.id === id ? l : x));
      return l;
    },
    async listBooks(o: ListOptions = {}) {
      fail();
      let r = books.filter((b) => searchTerms(o.query ?? "").every((t) => text(b).includes(t)));
      if (o.status && o.status !== "tutti") r = r.filter((b) => b.status === o.status);
      if (o.loan && o.loan !== "tutti") {
        const want = { disponibili: "disponibile", "in prestito": "in prestito", "in ritardo": "in ritardo", parziale: "disponibilità parziale" }[o.loan];
        r = r.filter((b) => availOf(b.id).state === want);
      }
      const key = o.sort === "titolo" ? (b: Book) => b.title : o.sort === "anno" ? (b: Book) => b.publicationYear : (b: Book) => b.updatedAt;
      const dir = (o.dir ?? "asc") === "asc" ? 1 : -1;
      r = [...r].sort((a, b) => (key(a) < key(b) ? -dir : key(a) > key(b) ? dir : 0));
      const pageSize = o.pageSize ?? 25, page = o.page ?? 1;
      const items = r.slice((page - 1) * pageSize, page * pageSize);
      return { items, total: r.length, page, pageSize, availability: Object.fromEntries(items.map((b) => [b.id, availOf(b.id)])) };
    },
    async getBook(id) { fail(); return books.find((b) => b.id === id) ?? null; },
    async createBook(input: BookInput) {
      fail();
      const b: Book = { ...input, id: `new-${++n}`, createdAt: "2026-02-01T00:00:00Z", updatedAt: "2026-02-01T00:00:00Z" };
      books = [b, ...books];
      return b;
    },
    async updateBook(id, input) {
      fail();
      const i = books.findIndex((b) => b.id === id);
      const cur = books[i];
      if (!cur) throw new BooksApiError("notfound", "La scheda non esiste più o non è tua: nessuna modifica è stata salvata.");
      const b = { ...cur, ...input };
      books = books.map((x) => (x.id === id ? b : x));
      return b;
    },
    async deleteBook(id) {
      fail();
      if (!books.some((b) => b.id === id)) throw new BooksApiError("notfound", "La scheda non esiste più: nulla da cancellare.");
      books = books.filter((b) => b.id !== id);
    },
    async getStats() {
      fail();
      return {
        total: books.length,
        byStatus: { bozza: books.filter((b) => b.status === "bozza").length, "da revisionare": books.filter((b) => b.status === "da revisionare").length, catalogato: books.filter((b) => b.status === "catalogato").length },
        publishers: new Set(books.map((b) => b.publisher).filter(Boolean)).size,
        subjects: new Set(books.flatMap((b) => b.subjects)).size,
      };
    },
    async listAllBooks() { fail(); return books; },
    lookupSources: opts.lookup ?? (async () => ({ groups: [], sources: [], cached: false })),
  };
  return api;
}
