import type { LookupQuery, SourceId, SourceRecord } from "../../src/lib/sources/types";

export interface SourceContext {
  fetch: typeof fetch;
  signal: AbortSignal;
  /** Intestazione User-Agent che identifica l'applicazione (richiesta da Open Library). */
  userAgent: string;
  /** Variabili d'ambiente del server (mai esposte al browser). */
  env(key: string): string | undefined;
}

/** Un connettore = una fonte. Aggiungere una fonte significa scrivere un nuovo oggetto `Source` e registrarlo in `lookup.ts`. */
export interface Source {
  id: SourceId;
  label: string;
  search(query: LookupQuery, ctx: SourceContext): Promise<SourceRecord[]>;
}

/** Errore di una fonte con un esito già classificato (non include dettagli tecnici o chiavi). */
export class SourceError extends Error {
  constructor(public readonly kind: "non_disponibile" | "errore", message: string) {
    super(message);
    this.name = "SourceError";
  }
}

export const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
export const strList = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter((x): x is string => Boolean(x)) : []);
export const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.trunc(v) : undefined);

export async function getJson(url: string, ctx: SourceContext, headers: Record<string, string> = {}): Promise<unknown> {
  let res: Response;
  try {
    res = await ctx.fetch(url, { signal: ctx.signal, headers: { accept: "application/json", "user-agent": ctx.userAgent, ...headers } });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new SourceError("errore", "La fonte non è raggiungibile.");
  }
  if (res.status === 429) throw new SourceError("non_disponibile", "La fonte ha limitato le richieste: riprova tra qualche minuto.");
  if (res.status === 401 || res.status === 403) throw new SourceError("non_disponibile", "La fonte rifiuta le richieste senza credenziali valide.");
  if (!res.ok) throw new SourceError("errore", `La fonte ha risposto con un errore (${res.status}).`);
  try {
    return await res.json();
  } catch {
    throw new SourceError("errore", "Risposta della fonte non leggibile.");
  }
}

export async function getText(url: string, ctx: SourceContext, accept = "application/xml, text/xml"): Promise<string> {
  let res: Response;
  try {
    res = await ctx.fetch(url, { signal: ctx.signal, headers: { accept, "user-agent": ctx.userAgent } });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new SourceError("errore", "La fonte non è raggiungibile.");
  }
  if (res.status === 429) throw new SourceError("non_disponibile", "La fonte ha limitato le richieste: riprova tra qualche minuto.");
  if (res.status === 401 || res.status === 403) throw new SourceError("non_disponibile", "La fonte rifiuta le richieste.");
  if (!res.ok) throw new SourceError("errore", `La fonte ha risposto con un errore (${res.status}).`);
  const text = await res.text();
  if (text.length > 2_000_000) throw new SourceError("errore", "Risposta della fonte troppo grande.");
  return text;
}
