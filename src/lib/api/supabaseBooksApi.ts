import type { SupabaseClient } from "@supabase/supabase-js";
import { BooksApiError, mapSupabaseError } from "./errors";
import { BOOK_COLUMNS, bookToRow, escapeLike, rowToBook, searchTerms, type BookRow } from "./mapping";
import { BOOK_STATUSES, type Book, type BookStatus, type BooksApi, type ListOptions, type SortKey } from "./types";

const SORT_COLUMN: Record<SortKey, string> = {
  aggiornamento: "updated_at",
  titolo: "title",
  autore: "authors",
  anno: "publication_year",
};

export const DEFAULT_PAGE_SIZE = 25;
const STATS_PAGE = 1000;

/**
 * Implementazione Supabase. Usa solo la chiave pubblicabile: ogni query passa dalle policy RLS,
 * quindi un utente vede e modifica soltanto le proprie schede (user_id = auth.uid()).
 */
export function createSupabaseBooksApi(client: SupabaseClient): BooksApi {
  async function wrap<T>(run: () => PromiseLike<T>): Promise<T> {
    try {
      return await run();
    } catch (e) {
      if (e instanceof BooksApiError) throw e;
      throw mapSupabaseError(e as Error);
    }
  }

  return {
    listBooks: (options: ListOptions = {}) => wrap(async () => {
      const pageSize = Math.min(Math.max(options.pageSize ?? DEFAULT_PAGE_SIZE, 1), 100);
      const page = Math.max(options.page ?? 1, 1);
      const sort = options.sort ?? "aggiornamento";
      const asc = (options.dir ?? (sort === "aggiornamento" ? "desc" : "asc")) === "asc";
      let q = client.from("books").select(BOOK_COLUMNS, { count: "exact" });
      for (const term of searchTerms(options.query ?? "")) q = q.ilike("search_text", `%${escapeLike(term)}%`);
      if (options.status && options.status !== "tutti") q = q.eq("status", options.status);
      q = q.order(SORT_COLUMN[sort], { ascending: asc, nullsFirst: false }).order("id");
      const from = (page - 1) * pageSize;
      const { data, error, count } = await q.range(from, from + pageSize - 1);
      if (error) throw mapSupabaseError(error);
      return { items: ((data ?? []) as unknown as BookRow[]).map(rowToBook), total: count ?? 0, page, pageSize };
    }),

    getBook: (id) => wrap(async () => {
      const { data, error } = await client.from("books").select(BOOK_COLUMNS).eq("id", id).maybeSingle();
      if (error) {
        if (error.code === "22P02") return null; // identificativo non valido: scheda inesistente
        throw mapSupabaseError(error);
      }
      return data ? rowToBook(data as unknown as BookRow) : null;
    }),

    createBook: (input) => wrap(async () => {
      const { data, error } = await client.from("books").insert(bookToRow(input)).select(BOOK_COLUMNS).single();
      if (error) throw mapSupabaseError(error);
      return rowToBook(data as unknown as BookRow);
    }),

    updateBook: (id, input) => wrap(async () => {
      const { data, error } = await client.from("books").update(bookToRow(input)).eq("id", id).select(BOOK_COLUMNS).maybeSingle();
      if (error) throw mapSupabaseError(error);
      if (!data) throw new BooksApiError("notfound", "La scheda non esiste più o non è tua: nessuna modifica è stata salvata.");
      return rowToBook(data as unknown as BookRow);
    }),

    deleteBook: (id) => wrap(async () => {
      const { data, error } = await client.from("books").delete().eq("id", id).select("id");
      if (error) throw mapSupabaseError(error);
      if (!data || data.length === 0) throw new BooksApiError("notfound", "La scheda non esiste più: nulla da cancellare.");
    }),

    listAllBooks: () => wrap(async () => {
      const all: Book[] = [];
      for (let from = 0; ; from += STATS_PAGE) {
        const { data, error } = await client.from("books").select(BOOK_COLUMNS).order("created_at").order("id").range(from, from + STATS_PAGE - 1);
        if (error) throw mapSupabaseError(error);
        const rows = (data ?? []) as unknown as BookRow[];
        all.push(...rows.map(rowToBook));
        if (rows.length < STATS_PAGE) return all;
      }
    }),

    getStats: () => wrap(async () => {
      const count = async (status?: BookStatus) => {
        let q = client.from("books").select("id", { count: "exact", head: true });
        if (status) q = q.eq("status", status);
        const { count: c, error } = await q;
        if (error) throw mapSupabaseError(error);
        return c ?? 0;
      };
      const [total, ...perStatus] = await Promise.all([count(), ...BOOK_STATUSES.map((s) => count(s))]);
      const byStatus = Object.fromEntries(BOOK_STATUSES.map((s, i) => [s, perStatus[i] ?? 0])) as Record<BookStatus, number>;
      const publishers = new Set<string>();
      const subjects = new Set<string>();
      for (let from = 0; from < total; from += STATS_PAGE) {
        const { data, error } = await client.from("books").select("publisher,subjects").order("id").range(from, from + STATS_PAGE - 1);
        if (error) throw mapSupabaseError(error);
        for (const r of (data ?? []) as { publisher: string | null; subjects: string[] | null }[]) {
          if (r.publisher) publishers.add(r.publisher.trim().toLowerCase());
          (r.subjects ?? []).forEach((s) => subjects.add(s.trim().toLowerCase()));
        }
      }
      return { total, byStatus, publishers: publishers.size, subjects: subjects.size };
    }),
  };
}
