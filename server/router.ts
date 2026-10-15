import { parseBookInput } from "../src/lib/api/parse";
import { BOOK_STATUSES, type ListOptions, type SortDir, type SortKey } from "../src/lib/api/types";
import type { Db } from "./db";
import * as repo from "./booksRepo";

export interface Deps {
  /** Restituisce il database, o null se non è configurato (variabile d'ambiente assente). */
  getDb(): Db | null;
  /** Identità VERIFICATA lato server (sessione Netlify Identity). Mai letta dal corpo o dai parametri della richiesta. */
  getUserId(req: Request): Promise<string | null>;
  log?(message: string): void;
}

const MAX_BODY = 1_000_000;
const HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: HEADERS });
}
const fail = (status: number, code: string, message: string, fields?: unknown) => json(status, { error: { code, message, ...(fields ? { fields } : {}) } });

/**
 * Difesa CSRF (l'autenticazione usa cookie): le richieste che modificano dati devono essere JSON
 * (forza il preflight CORS) e, se il browser invia Origin, deve coincidere con l'host della richiesta.
 */
function csrfOk(req: Request): boolean {
  if (req.method === "GET" || req.method === "HEAD") return true;
  const ct = req.headers.get("content-type") ?? "";
  if (req.method !== "DELETE" && !ct.toLowerCase().startsWith("application/json")) return false;
  if (req.headers.get("x-bibliotheca") !== "1") return false;
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) return false;
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return false;
  return true;
}

async function readJson(req: Request): Promise<{ ok: true; value: unknown } | { ok: false; res: Response }> {
  const text = await req.text();
  if (text.length > MAX_BODY) return { ok: false, res: fail(413, "too_large", "La richiesta è troppo grande.") };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, res: fail(400, "bad_json", "Il corpo della richiesta non è un JSON valido.") };
  }
}

function listOptions(url: URL): ListOptions {
  const q = url.searchParams;
  const sort = q.get("sort");
  const dir = q.get("dir");
  const status = q.get("status");
  const o: ListOptions = { query: (q.get("query") ?? "").slice(0, 200), page: Number(q.get("page") ?? 1), pageSize: Number(q.get("pageSize") ?? repo.DEFAULT_PAGE_SIZE) };
  if (sort && ["aggiornamento", "titolo", "autore", "anno"].includes(sort)) o.sort = sort as SortKey;
  if (dir === "asc" || dir === "desc") o.dir = dir as SortDir;
  if (status === "tutti" || (status && (BOOK_STATUSES as readonly string[]).includes(status))) o.status = status as NonNullable<ListOptions["status"]>;
  return o;
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  try {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "");
    const m = /^\/api\/(books|stats|export)(?:\/([^/]+))?$/.exec(path);
    if (!m) return fail(404, "not_found", "Risorsa inesistente.");
    const [, resource, id] = m as unknown as [string, string, string | undefined];

    // 1. CSRF  2. Autenticazione  3. Database  4. Autorizzazione applicata dalle query (owner_id)
    if (!csrfOk(req)) return fail(403, "csrf", "Richiesta non consentita da questo indirizzo.");
    const userId = await deps.getUserId(req);
    if (!userId) return fail(401, "unauthenticated", "La sessione è scaduta o non hai effettuato l'accesso. Accedi di nuovo.");
    const db = deps.getDb();
    if (!db) return fail(503, "db_unavailable", "Il database non è ancora configurato per questo ambiente.");

    if (resource === "stats" && !id) {
      return req.method === "GET" ? json(200, await repo.getStats(db, userId)) : fail(405, "method", "Metodo non consentito.");
    }
    if (resource === "export" && !id) {
      return req.method === "GET" ? json(200, { books: await repo.listAllBooks(db, userId) }) : fail(405, "method", "Metodo non consentito.");
    }
    if (resource === "books" && !id) {
      if (req.method === "GET") return json(200, await repo.listBooks(db, userId, listOptions(url)));
      if (req.method === "POST") {
        const body = await readJson(req);
        if (!body.ok) return body.res;
        const parsed = parseBookInput(body.value);
        if (!parsed.ok) return fail(400, "validation", "Alcuni campi non sono validi.", parsed.errors);
        return json(201, await repo.createBook(db, userId, parsed.input));
      }
      return fail(405, "method", "Metodo non consentito.");
    }
    if (resource === "books" && id) {
      if (req.method === "GET") {
        const b = await repo.getBook(db, userId, id);
        return b ? json(200, b) : fail(404, "not_found", "Scheda non trovata.");
      }
      if (req.method === "PUT") {
        const body = await readJson(req);
        if (!body.ok) return body.res;
        const parsed = parseBookInput(body.value);
        if (!parsed.ok) return fail(400, "validation", "Alcuni campi non sono validi.", parsed.errors);
        const b = await repo.updateBook(db, userId, id, parsed.input);
        return b ? json(200, b) : fail(404, "not_found", "La scheda non esiste più o non è tua: nessuna modifica è stata salvata.");
      }
      if (req.method === "DELETE") {
        return (await repo.deleteBook(db, userId, id)) ? json(200, { deleted: true }) : fail(404, "not_found", "La scheda non esiste più: nulla da cancellare.");
      }
      return fail(405, "method", "Metodo non consentito.");
    }
    return fail(404, "not_found", "Risorsa inesistente.");
  } catch (e) {
    // Log senza dati dell'utente né query; risposta generica.
    deps.log?.(`api error: ${e instanceof Error ? e.name + ": " + e.message : "unknown"}`);
    return fail(500, "server_error", "Errore interno del server. Riprova tra poco; i dati non sono stati modificati se l'operazione non è confermata.");
  }
}
