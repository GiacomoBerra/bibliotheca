/** Errore del livello dati con messaggio già pronto per l'utente (in italiano). */
export class BooksApiError extends Error {
  readonly kind: "auth" | "network" | "validation" | "notfound" | "conflict" | "unavailable" | "unknown";
  /** Codice dell'errore del server, se c'è (es. "has_loans"). */
  readonly code?: string;
  constructor(kind: BooksApiError["kind"], message: string, code?: string) {
    super(message);
    if (code) this.code = code;
    this.name = "BooksApiError";
    this.kind = kind;
  }
}

export const networkError = () =>
  new BooksApiError("network", "Impossibile contattare il server. Controlla la connessione e riprova: i dati non sono stati modificati.");

/** Traduce una risposta di errore dell'API (`{error:{code,message,fields}}`) in un errore per l'utente. */
export function mapHttpError(status: number, body: unknown): BooksApiError {
  const err = (body && typeof body === "object" ? (body as { error?: { code?: string; message?: string; fields?: Record<string, string> } }).error : undefined) ?? {};
  if (status === 401) return new BooksApiError("auth", "La sessione è scaduta. Accedi di nuovo per continuare.");
  if (status === 403 && (err.code === "forbidden" || err.code === "no_role") && err.message) return new BooksApiError("auth", err.message);
  if (status === 429) return new BooksApiError("unavailable", err.message ?? "Troppe richieste: riprova tra poco.");
  if (status === 403) return new BooksApiError("auth", "Operazione non consentita. Esci e accedi di nuovo; se continua, contatta il proprietario del catalogo.");
  if (status === 400 && err.code === "validation") {
    const detail = err.fields ? Object.values(err.fields).filter((v) => typeof v === "string").join(" ") : "";
    return new BooksApiError("validation", detail || err.message || "Alcuni campi non sono validi.");
  }
  if (status === 409) return new BooksApiError("conflict", err.message ?? "L'operazione è in conflitto con lo stato attuale dei dati: ricarica la pagina e riprova.", err.code);
  if (status === 404) return new BooksApiError("notfound", err.message ?? "Elemento non trovato.");
  if (status === 503 && err.code === "db_not_configured") return new BooksApiError("unavailable", "Il database online non è ancora stato creato per questo ambiente. Il catalogo non può salvare né mostrare schede finché il proprietario non lo attiva (vedi docs/netlify-attivazione.md).");
  if (status === 503 && err.code === "db_schema_missing") return new BooksApiError("unavailable", "Il database esiste ma le sue tabelle non sono state create (migrazione non applicata). Il proprietario deve ripubblicare l'ambiente.");
  if (status === 503 && err.code === "db_unreachable") return new BooksApiError("unavailable", "Il database non risponde in questo momento. Riprova tra un minuto: i dati non sono stati modificati.");
  if (status === 503) return new BooksApiError("unavailable", "Il database non è ancora disponibile per questo ambiente. Riprova più tardi o contatta il proprietario del catalogo.");
  if (status === 413) return new BooksApiError("validation", "I dati inviati sono troppo grandi.");
  return new BooksApiError("unknown", "Operazione non riuscita. Riprova tra poco; se il problema continua, contatta il proprietario del catalogo.");
}
