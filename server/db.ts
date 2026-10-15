import pg from "pg";

/** Interfaccia minima di accesso al database: permette di testare con un Postgres locale. */
export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number }>;
  /** Chiude le connessioni (usato nei test). */
  close?(): Promise<void>;
}

/**
 * Connessione Postgres tramite la variabile d'ambiente fornita da Netlify Database (NETLIFY_DB_URL).
 * Il pool è piccolo: ogni istanza di Function è un processo separato.
 */
export function createPgDb(connectionString: string): Db {
  const pool = new pg.Pool({ connectionString, max: 2, idleTimeoutMillis: 10_000 });
  return {
    async query<T>(text: string, params: unknown[] = []) {
      const r = await pool.query(text, params);
      return { rows: r.rows as T[], rowCount: r.rowCount ?? 0 };
    },
    async close() { await pool.end(); },
  };
}
