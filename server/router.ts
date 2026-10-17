import { parseBookInput } from "../src/lib/api/parse";
import { BOOK_STATUSES, type ListOptions, type SortDir, type SortKey } from "../src/lib/api/types";
import type { Db } from "./db";
import * as repo from "./booksRepo";
import * as loansRepo from "./loansRepo";
import * as copiesRepo from "./copiesRepo";
import { LOAN_FILTERS, parseCopyInput, parseCorrectionInput, parseLoanEdit, parseLoanInput, parseLoanListOptions, parseRestoreInput, parseReturnInput, todayIso, type LoanFilter } from "../src/lib/api/loans";
import { LookupError, parseLookupQuery, type Lookup } from "./sources/lookup";

export interface Principal { id: string; roles: readonly string[] }
export type Role = "admin" | "viewer";

/** Ruolo effettivo: `admin` prevale su `viewer`; qualsiasi altro valore (o nessun ruolo) non dà alcun accesso. */
export function roleOf(p: Principal): Role | null {
  if (p.roles.includes("admin")) return "admin";
  if (p.roles.includes("viewer")) return "viewer";
  return null;
}

export interface Deps {
  /** Restituisce il database, o null se non è configurato (variabile d'ambiente assente). */
  getDb(): Db | null;
  /** Identità e ruoli VERIFICATI lato server (sessione Netlify Identity). Mai letti dal corpo o dai parametri della richiesta. */
  getPrincipal(req: Request): Promise<Principal | null>;
  /** Ricerca su fonti bibliografiche esterne (solo admin). Non scrive nel catalogo. */
  lookup?: Lookup;
  /** Data odierna «AAAA-MM-GG» (fuso della biblioteca). Iniettabile nei test. */
  today?(): string;
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

async function readJson(req: Request, max = MAX_BODY): Promise<{ ok: true; value: unknown } | { ok: false; res: Response }> {
  const text = await req.text();
  if (text.length > max) return { ok: false, res: fail(413, "too_large", "La richiesta è troppo grande.") };
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
  const loan = q.get("loan");
  if (loan && (LOAN_FILTERS as readonly string[]).includes(loan)) o.loan = loan as LoanFilter;
  return o;
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  try {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "");
    const m = /^\/api\/(books|stats|export|lookup|loans|copies)(?:\/([^/]+)(?:\/(loans|copies|return|void|undo-return|corrections))?)?$/.exec(path);
    if (!m) return fail(404, "not_found", "Risorsa inesistente.");
    const [, resource, id, sub] = m as unknown as [string, string, string | undefined, "loans" | "copies" | "return" | "void" | "undo-return" | "corrections" | undefined];
    if (((sub === "loans" || sub === "copies") && resource !== "books") || (sub && sub !== "loans" && sub !== "copies" && resource !== "loans")) return fail(404, "not_found", "Risorsa inesistente.");

    // 1. CSRF  2. Autenticazione  3. Ruolo (autorizzazione, PRIMA di qualsiasi accesso ai dati)  4. Database
    if (!csrfOk(req)) return fail(403, "csrf", "Richiesta non consentita da questo indirizzo.");
    const principal = await deps.getPrincipal(req);
    if (!principal?.id) return fail(401, "unauthenticated", "La sessione è scaduta o non hai effettuato l'accesso. Accedi di nuovo.");
    const role = roleOf(principal);
    if (!role) return fail(403, "no_role", "Il tuo account non ha un ruolo assegnato (admin o viewer). Chiedi all'amministratore di assegnartelo.");
    const userId = principal.id;
    // Il visualizzatore può solo consultare (lettura di schede, elenco, statistiche): mai scrivere o esportare.
    const readOnlyAllowed = req.method === "GET" && (resource === "books" || resource === "stats");
    if (role === "viewer" && !readOnlyAllowed) return fail(403, "forbidden", "Il tuo ruolo (visualizzatore) consente solo di consultare il catalogo.");
    if (resource === "lookup" && !id) {
      if (req.method !== "GET") return fail(405, "method", "Metodo non consentito.");
      if (!deps.lookup) return fail(503, "lookup_unavailable", "La ricerca su fonti esterne non è configurata per questo ambiente.");
      try {
        const q = parseLookupQuery(url.searchParams);
        return json(200, await deps.lookup.run(q, userId, { refresh: url.searchParams.get("refresh") === "1" }));
      } catch (e) {
        if (e instanceof LookupError) {
          const res = fail(e.status, e.code, e.message);
          if (e.retryAfter) res.headers.set("retry-after", String(e.retryAfter));
          return res;
        }
        throw e;
      }
    }
    const db = deps.getDb();
    if (!db) return fail(503, "db_not_configured", "Il database di questo ambiente non è ancora stato creato o collegato (variabile NETLIFY_DB_URL assente).");

    const today = deps.today?.() ?? todayIso();
    const asLoanError = (e: unknown) => {
      if (!(e instanceof loansRepo.LoanError)) return null;
      return fail(e.status, e.code, e.message, e.fields);
    };

    // Prestiti. Gestione (registrare, restituire, correggere, elenco globale con nomi): solo admin.
    // Il visualizzatore può solo leggere lo stato e lo storico di un libro, SENZA dati personali (nome, recapito, note).
    if (resource === "books" && id && sub === "loans") {
      if (req.method === "GET") {
        const r = await loansRepo.listBookLoans(db, id, today, role !== "admin");
        return r ? json(200, r) : fail(404, "not_found", "Scheda non trovata.");
      }
      if (req.method === "POST") {
        const body = await readJson(req);
        if (!body.ok) return body.res;
        const parsed = parseLoanInput(body.value);
        if (!parsed.ok) return fail(400, "validation", "Alcuni campi del prestito non sono validi.", parsed.errors);
        try { return json(201, await loansRepo.createLoan(db, userId, id, parsed.value, today)); } catch (e) { const r = asLoanError(e); if (r) return r; throw e; }
      }
      return fail(405, "method", "Metodo non consentito.");
    }
    // Copie fisiche. Elenco di un libro: anche il visualizzatore (nessun dato personale). Aggiungere/modificare: solo admin.
    if (resource === "books" && id && sub === "copies") {
      if (req.method === "GET") {
        const r = await copiesRepo.listCopies(db, id, today);
        return r ? json(200, { items: r }) : fail(404, "not_found", "Scheda non trovata.");
      }
      if (req.method === "POST") {
        const body = await readJson(req);
        if (!body.ok) return body.res;
        const parsed = parseCopyInput(body.value);
        if (!parsed.ok) return fail(400, "validation", "Alcuni campi della copia non sono validi.", parsed.errors);
        try { return json(201, await copiesRepo.addCopy(db, id, parsed.value, today)); } catch (e) { const r = asLoanError(e); if (r) return r; throw e; }
      }
      return fail(405, "method", "Metodo non consentito.");
    }
    if (resource === "copies") {
      if (!id && !sub) {
        if (req.method !== "GET") return fail(405, "method", "Metodo non consentito.");
        return json(200, { items: await copiesRepo.listAllCopies(db, today) });
      }
      if (id && !sub) {
        if (req.method !== "PUT") return fail(405, "method", "Le copie non si cancellano: i loro prestiti restano nello storico.");
        const body = await readJson(req);
        if (!body.ok) return body.res;
        const parsed = parseCopyInput(body.value);
        if (!parsed.ok) return fail(400, "validation", "Alcuni campi della copia non sono validi.", parsed.errors);
        try { return json(200, await copiesRepo.updateCopy(db, id, parsed.value, today)); } catch (e) { const r = asLoanError(e); if (r) return r; throw e; }
      }
      return fail(404, "not_found", "Risorsa inesistente.");
    }
    if (resource === "loans") {
      // Ripristino di prestiti e cronologia da un backup: tutto o niente, solo admin (il viewer è già fermato sopra).
      if (id === "restore" && !sub) {
        if (req.method !== "POST") return fail(405, "method", "Metodo non consentito.");
        const body = await readJson(req, 5_000_000);
        if (!body.ok) return body.res;
        const parsed = parseRestoreInput(body.value);
        if (!parsed.ok) return fail(400, "validation", `${parsed.message} Nulla è stato scritto.`);
        try { return json(200, await loansRepo.restoreLoans(db, userId, parsed.value, parsed.copies)); } catch (e) { const r = asLoanError(e); if (r) return r; throw e; }
      }
      if (!id && !sub) {
        if (req.method !== "GET") return fail(405, "method", "Metodo non consentito.");
        return json(200, await loansRepo.listLoans(db, parseLoanListOptions(url.searchParams), today));
      }
      if (id && sub === "return") {
        if (req.method !== "POST") return fail(405, "method", "Metodo non consentito.");
        const body = await readJson(req);
        if (!body.ok) return body.res;
        const parsed = parseReturnInput(body.value);
        if (!parsed.ok) return fail(400, "validation", "La data di restituzione non è valida.", parsed.errors);
        try { return json(200, await loansRepo.returnLoan(db, userId, id, parsed.value.returnedDate, today)); } catch (e) { const r = asLoanError(e); if (r) return r; throw e; }
      }
      if (id && (sub === "void" || sub === "undo-return")) {
        if (req.method !== "POST") return fail(405, "method", "Metodo non consentito.");
        const body = await readJson(req);
        if (!body.ok) return body.res;
        const parsed = parseCorrectionInput(body.value);
        if (!parsed.ok) return fail(400, "validation", "Indica il motivo della correzione.", parsed.errors);
        try {
          const l = sub === "void" ? await loansRepo.voidLoan(db, userId, id, parsed.value.reason, today) : await loansRepo.undoReturn(db, userId, id, parsed.value.reason, today);
          return json(200, l);
        } catch (e) { const r = asLoanError(e); if (r) return r; throw e; }
      }
      if (id && sub === "corrections") {
        if (req.method !== "GET") return fail(405, "method", "Metodo non consentito.");
        const c = await loansRepo.listCorrections(db, id);
        return c ? json(200, { items: c }) : fail(404, "not_found", "Prestito non trovato.");
      }
      if (id && !sub) {
        if (req.method === "GET") {
          const l = await loansRepo.getLoan(db, id, today);
          return l ? json(200, l) : fail(404, "not_found", "Prestito non trovato.");
        }
        if (req.method === "PUT") {
          const body = await readJson(req);
          if (!body.ok) return body.res;
          const parsed = parseLoanEdit(body.value);
          if (!parsed.ok) return fail(400, "validation", "Alcuni campi del prestito non sono validi.", parsed.errors);
          try { return json(200, await loansRepo.updateLoan(db, id, parsed.value, today)); } catch (e) { const r = asLoanError(e); if (r) return r; throw e; }
        }
        // Nessuna cancellazione: lo storico dei prestiti si conserva sempre.
        return fail(405, "method", "I prestiti non si cancellano: lo storico viene conservato.");
      }
      return fail(404, "not_found", "Risorsa inesistente.");
    }

    if (resource === "stats" && !id) {
      return req.method === "GET" ? json(200, await repo.getStats(db)) : fail(405, "method", "Metodo non consentito.");
    }
    if (resource === "export" && !id) {
      return req.method === "GET" ? json(200, { books: await repo.listAllBooks(db) }) : fail(405, "method", "Metodo non consentito.");
    }
    if (resource === "books" && !id) {
      if (req.method === "GET") return json(200, await repo.listBooks(db, listOptions(url), deps.today?.() ?? todayIso()));
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
        const b = await repo.getBook(db, id);
        return b ? json(200, b) : fail(404, "not_found", "Scheda non trovata.");
      }
      if (req.method === "PUT") {
        const body = await readJson(req);
        if (!body.ok) return body.res;
        const parsed = parseBookInput(body.value);
        if (!parsed.ok) return fail(400, "validation", "Alcuni campi non sono validi.", parsed.errors);
        const exp = (body.value as { expectedUpdatedAt?: unknown } | null)?.expectedUpdatedAt;
        if (exp !== undefined && exp !== null && (typeof exp !== "string" || Number.isNaN(Date.parse(exp)))) return fail(400, "validation", "Versione della scheda non valida.");
        let b;
        try { b = await repo.updateBook(db, userId, id, parsed.input, (exp as string | undefined) ?? null); }
        catch (e) { if (e instanceof repo.BookConflictError) return fail(409, "edit_conflict", "Questa scheda è stata modificata da un altro amministratore dopo che l'hai aperta. Nulla è stato sovrascritto: ricarica la scheda per vedere le modifiche e rifai la tua."); throw e; }
        return b ? json(200, b) : fail(404, "not_found", "La scheda non esiste più: nessuna modifica è stata salvata.");
      }
      if (req.method === "DELETE") {
        try {
          return (await repo.deleteBook(db, id)) ? json(200, { deleted: true }) : fail(404, "not_found", "La scheda non esiste più: nulla da cancellare.");
        } catch (e) {
          const c = (e as { code?: unknown } | null)?.code;
          if (c === "23503" || c === "23001") return fail(409, "has_loans", "Questo libro ha uno storico di prestiti, che viene conservato: la scheda non può essere cancellata. Puoi segnarla come «da revisionare» o modificarla.");
          throw e;
        }
      }
      return fail(405, "method", "Metodo non consentito.");
    }
    return fail(404, "not_found", "Risorsa inesistente.");
  } catch (e) {
    // Log senza dati dell'utente né query (solo nome/codice dell'errore); risposta senza dettagli sensibili.
    const code = (e as { code?: unknown } | null)?.code;
    deps.log?.(`api error: ${e instanceof Error ? e.name : "unknown"}${typeof code === "string" ? " [" + code + "]" : ""}`);
    const kind = classifyDbError(e);
    if (kind === "schema") return fail(503, "db_schema_missing", "Il database esiste ma le tabelle non sono state create: la migrazione non è stata applicata a questo ambiente.");
    if (kind === "unreachable") return fail(503, "db_unreachable", "Il database è configurato ma non risponde. Riprova tra un minuto: se è in pausa si riattiva da solo.");
    return fail(500, "server_error", "Errore interno del server. Riprova tra poco; i dati non sono stati modificati se l'operazione non è confermata.");
  }
}

/** Classifica un errore del driver senza esporne il messaggio (può contenere host o credenziali). */
export function classifyDbError(e: unknown): "schema" | "unreachable" | null {
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code !== "string") return null;
  if (code === "42P01" || code === "3F000") return "schema";
  if (["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "ECONNRESET", "EAI_AGAIN", "28P01", "28000", "57P03", "53300"].includes(code) || code.startsWith("08")) return "unreachable";
  return null;
}
