import { demoBooks } from "@/data/demoBooks";
import type { Book, BooksApi, CatalogStats } from "./types";

export function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

export function filterBooks(books: Book[], query: string): Book[] {
  const q = normalize(query);
  if (!q) return books;
  const qIsbn = q.replace(/[\s-]/g, "");
  return books.filter(
    (b) =>
      normalize(b.title).includes(q) ||
      normalize(b.author).includes(q) ||
      (qIsbn.length > 0 && b.isbn.replace(/[\s-]/g, "").includes(qIsbn)),
  );
}

export function computeStats(books: Book[]): CatalogStats {
  const byStatus = { catalogato: 0, "da revisionare": 0, bozza: 0 };
  books.forEach((b) => byStatus[b.status]++);
  return {
    total: books.length,
    byStatus,
    publishers: new Set(books.map((b) => b.publisher)).size,
    subjects: new Set(books.flatMap((b) => b.subjects)).size,
  };
}

const demoBooksApi: BooksApi = {
  isDemo: true,
  async listBooks(query = "") {
    return filterBooks(demoBooks, query);
  },
  async getBook(id) {
    return demoBooks.find((b) => b.id === id) ?? null;
  },
  async getStats() {
    return computeStats(demoBooks);
  },
};

export const booksApi: BooksApi = demoBooksApi;
