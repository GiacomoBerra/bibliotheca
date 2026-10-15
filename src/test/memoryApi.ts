import { BooksApiError } from "@/lib/api/errors";
import { emptyBookInput, type Book, type BookInput, type BooksApi, type ListOptions } from "@/lib/api/types";
import { searchTerms } from "@/lib/api/mapping";

export function makeBook(over: Partial<Book> & { id: string; title: string }): Book {
  return { ...emptyBookInput(), createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", ...over };
}

/** Livello dati in memoria con la stessa interfaccia di produzione, per testare le schermate. */
export function makeMemoryApi(initial: Book[] = [], opts: { failWith?: string; lookup?: BooksApi["lookupSources"] } = {}) {
  let books = [...initial];
  let n = 100;
  const fail = () => { if (opts.failWith) throw new BooksApiError("network", opts.failWith); };
  const text = (b: Book) => [b.title, b.authors.join(" "), b.isbn, b.isbn.replace(/[-\s]/g, ""), b.publisher, b.subjects.join(" "), b.dewey, b.shelfMark].join(" ").toLowerCase();
  const api: BooksApi & { all(): Book[] } = {
    all: () => books,
    async listBooks(o: ListOptions = {}) {
      fail();
      let r = books.filter((b) => searchTerms(o.query ?? "").every((t) => text(b).includes(t)));
      if (o.status && o.status !== "tutti") r = r.filter((b) => b.status === o.status);
      const key = o.sort === "titolo" ? (b: Book) => b.title : o.sort === "anno" ? (b: Book) => b.publicationYear : (b: Book) => b.updatedAt;
      const dir = (o.dir ?? "asc") === "asc" ? 1 : -1;
      r = [...r].sort((a, b) => (key(a) < key(b) ? -dir : key(a) > key(b) ? dir : 0));
      const pageSize = o.pageSize ?? 25, page = o.page ?? 1;
      return { items: r.slice((page - 1) * pageSize, page * pageSize), total: r.length, page, pageSize };
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
