/** Errore del livello dati con messaggio già pronto per l'utente (in italiano). */
export class BooksApiError extends Error {
  readonly kind: "auth" | "network" | "validation" | "notfound" | "unknown";
  constructor(kind: BooksApiError["kind"], message: string) {
    super(message);
    this.name = "BooksApiError";
    this.kind = kind;
  }
}

interface PgLikeError { message?: string | undefined; code?: string | undefined; status?: number | undefined }

export function mapSupabaseError(err: PgLikeError | null | undefined): BooksApiError {
  const msg = (err?.message ?? "").toLowerCase();
  const code = err?.code ?? "";
  if (err?.status === 401 || code === "PGRST301" || code === "PGRST303" || msg.includes("jwt expired") || msg.includes("jwt")) {
    return new BooksApiError("auth", "La sessione è scaduta. Accedi di nuovo per continuare.");
  }
  if (code === "42501" || err?.status === 403 || msg.includes("row-level security") || msg.includes("permission denied")) {
    return new BooksApiError("auth", "Non hai il permesso di eseguire questa operazione. Esci e accedi di nuovo; se continua, contatta il proprietario del catalogo.");
  }
  if (code === "23514" || code === "22001") {
    return new BooksApiError("validation", "Uno dei valori supera i limiti consentiti (per esempio un testo troppo lungo). Controlla i campi e riprova.");
  }
  if (msg.includes("failed to fetch") || msg.includes("network") || msg.includes("load failed") || msg.includes("fetch")) {
    return new BooksApiError("network", "Impossibile contattare il server. Controlla la connessione e riprova: i dati non sono stati modificati.");
  }
  return new BooksApiError("unknown", "Operazione non riuscita. Riprova tra poco; se il problema continua, contatta il proprietario del catalogo.");
}
