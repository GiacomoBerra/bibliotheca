import type { Config } from "@netlify/functions";
import { getConnectionString } from "@netlify/database";
import { getUser } from "@netlify/identity";
import { createPgDb, type Db } from "../../server/db";
import { handle } from "../../server/router";
import { createLookup } from "../../server/sources/lookup";

/**
 * Unica Function dell'API di Bibliotheca. Identità e ruoli (admin / viewer, da `app_metadata.roles`) arrivano SOLO dalla sessione Netlify Identity verificata
 * lato server (`getUser()`), mai dal browser. Il database è raggiunto solo da qui, con la stringa di
 * connessione fornita da Netlify Database (NETLIFY_DB_URL), che non esce mai da questo processo.
 */
let db: Db | null | undefined;
function getDb(): Db | null {
  if (db === undefined) {
    let url = Netlify.env.get("NETLIFY_DB_URL");
    if (!url) {
      try {
        url = getConnectionString(); // ambiente Netlify Database (branch corretto per questo deploy)
      } catch {
        url = undefined; // database non collegato: l'API risponde 503 db_not_configured
      }
    }
    db = url ? createPgDb(url) : null;
  }
  return db;
}

/** Ricerca su Open Library e Google Books: chiavi (se servono) solo dalle variabili d'ambiente del server. */
const lookup = createLookup({ fetch: (...a) => fetch(...a), env: (k) => Netlify.env.get(k) });

export default async (req: Request): Promise<Response> =>
  handle(req, {
    lookup,
    getDb,
    getPrincipal: async () => {
      const user = await getUser();
      return user ? { id: user.id, roles: user.roles ?? [] } : null;
    },
    log: (m) => console.error(m),
  });

export const config: Config = {
  path: ["/api/books", "/api/books/*", "/api/stats", "/api/export", "/api/lookup", "/api/loans", "/api/loans/*"],
};
