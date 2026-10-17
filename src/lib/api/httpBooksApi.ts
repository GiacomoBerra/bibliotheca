import { BooksApiError, mapHttpError, networkError } from "./errors";
import type { BookCopy, BookLoans, Loan, LoanCorrection, LoanPage, RestoreResult } from "./loans";
import type { LookupResponse } from "@/lib/sources/types";
import type { Book, BookInput, BookPage, BooksApi, CatalogStats, ListOptions } from "./types";

export interface HttpApiOptions {
  fetch?: typeof fetch;
  /** Chiamata una volta su 401: prova a rinnovare la sessione; true = riprova la richiesta. */
  refreshSession?: () => Promise<boolean>;
  /** Chiamata quando la sessione è definitivamente scaduta (dopo il rinnovo fallito). */
  onSessionExpired?: () => void;
}

/**
 * Client delle API di Bibliotheca (Netlify Functions). Non contiene credenziali: la sessione viaggia
 * nei cookie di Netlify Identity e l'identità è verificata dal server a ogni richiesta.
 */
export function createHttpBooksApi(opts: HttpApiOptions = {}): BooksApi {
  const doFetch = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));

  async function send(method: string, path: string, body?: unknown): Promise<Response> {
    const init: RequestInit = {
      method,
      credentials: "same-origin",
      headers: { accept: "application/json", "x-bibliotheca": "1", ...(body !== undefined ? { "content-type": "application/json" } : method === "DELETE" ? { "content-type": "application/json" } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    };
    try {
      return await doFetch(path, init);
    } catch {
      throw networkError();
    }
  }

  async function call(method: string, path: string, body?: unknown, allow404 = false): Promise<unknown> {
    let res = await send(method, path, body);
    if (res.status === 401 && opts.refreshSession && (await opts.refreshSession().catch(() => false))) res = await send(method, path, body);
    if (res.status === 401) opts.onSessionExpired?.();
    let data: unknown = null;
    try { data = await res.json(); } catch { /* corpo vuoto o non JSON */ }
    if (res.ok) return data;
    if (allow404 && res.status === 404) return null;
    throw mapHttpError(res.status, data);
  }

  const qs = (o: ListOptions) => {
    const p = new URLSearchParams();
    if (o.query?.trim()) p.set("query", o.query);
    if (o.status && o.status !== "tutti") p.set("status", o.status);
    if (o.loan && o.loan !== "tutti") p.set("loan", o.loan);
    if (o.sort) p.set("sort", o.sort);
    if (o.dir) p.set("dir", o.dir);
    if (o.page) p.set("page", String(o.page));
    if (o.pageSize) p.set("pageSize", String(o.pageSize));
    const s = p.toString();
    return s ? `?${s}` : "";
  };

  return {
    listBooks: async (o = {}) => (await call("GET", `/api/books${qs(o)}`)) as BookPage,
    getBook: async (id) => (await call("GET", `/api/books/${encodeURIComponent(id)}`, undefined, true)) as Book | null,
    createBook: async (input: BookInput) => (await call("POST", "/api/books", input)) as Book,
    updateBook: async (id, input, expectedUpdatedAt) => (await call("PUT", `/api/books/${encodeURIComponent(id)}`, expectedUpdatedAt ? { ...input, expectedUpdatedAt } : input)) as Book,
    deleteBook: async (id, opts) => { await (opts ? call("DELETE", `/api/books/${encodeURIComponent(id)}?withHistory=1`, { confirmTitle: opts.confirmTitle }) : call("DELETE", `/api/books/${encodeURIComponent(id)}`)); },
    getStats: async () => (await call("GET", "/api/stats")) as CatalogStats,
    listAllBooks: async () => ((await call("GET", "/api/export")) as { books: Book[] }).books,
    lookupSources: async (q, o = {}) => {
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries(q)) if (typeof v === "string" && v.trim()) p.set(k, v.trim());
      if (o.refresh) p.set("refresh", "1");
      return (await call("GET", `/api/lookup?${p.toString()}`)) as LookupResponse;
    },
    listBookLoans: async (bookId) => (await call("GET", `/api/books/${encodeURIComponent(bookId)}/loans`)) as BookLoans,
    listLoans: async (o = {}) => {
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== "" && !(k === "state" && v === "tutti")) p.set(k, String(v));
      const s = p.toString();
      return (await call("GET", `/api/loans${s ? `?${s}` : ""}`)) as LoanPage;
    },
    createLoan: async (bookId, input) => (await call("POST", `/api/books/${encodeURIComponent(bookId)}/loans`, input)) as Loan,
    returnLoan: async (id, returnedDate) => (await call("POST", `/api/loans/${encodeURIComponent(id)}/return`, returnedDate ? { returnedDate } : {})) as Loan,
    restoreLoans: async (loans, copies = []) => (await call("POST", "/api/loans/restore", { loans, copies })) as RestoreResult,
    listCopies: async (bookId) => ((await call("GET", `/api/books/${encodeURIComponent(bookId)}/copies`)) as { items: BookCopy[] }).items,
    listAllCopies: async () => ((await call("GET", "/api/copies")) as { items: BookCopy[] }).items,
    addCopy: async (bookId, input) => (await call("POST", `/api/books/${encodeURIComponent(bookId)}/copies`, input)) as BookCopy,
    updateCopy: async (copyId, input) => (await call("PUT", `/api/copies/${encodeURIComponent(copyId)}`, input)) as BookCopy,
    voidLoan: async (id, reason) => (await call("POST", `/api/loans/${encodeURIComponent(id)}/void`, { reason })) as Loan,
    undoLoanReturn: async (id, reason) => (await call("POST", `/api/loans/${encodeURIComponent(id)}/undo-return`, { reason })) as Loan,
    listLoanCorrections: async (id) => ((await call("GET", `/api/loans/${encodeURIComponent(id)}/corrections`)) as { items: LoanCorrection[] }).items,
    updateLoan: async (id, input) => (await call("PUT", `/api/loans/${encodeURIComponent(id)}`, input)) as Loan,
  };
}

export { BooksApiError };
