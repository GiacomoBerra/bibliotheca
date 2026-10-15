import type { Config } from "@netlify/functions";
import { getUser } from "@netlify/identity";
import { createPgDb, type Db } from "../../server/db";
import { handle } from "../../server/router";

/**
 * Unica Function dell'API di Bibliotheca. Identità e ruoli (admin / viewer, da `app_metadata.roles`) arrivano SOLO dalla sessione Netlify Identity verificata
 * lato server (`getUser()`), mai dal browser. Il database è raggiunto solo da qui, con la stringa di
 * connessione fornita da Netlify Database (NETLIFY_DB_URL), che non esce mai da questo processo.
 */
let db: Db | null | undefined;
function getDb(): Db | null {
  if (db === undefined) {
    const url = Netlify.env.get("NETLIFY_DB_URL");
    db = url ? createPgDb(url) : null;
  }
  return db;
}

export default async (req: Request): Promise<Response> =>
  handle(req, {
    getDb,
    getPrincipal: async () => {
      const user = await getUser();
      return user ? { id: user.id, roles: user.roles ?? [] } : null;
    },
    log: (m) => console.error(m),
  });

export const config: Config = {
  path: ["/api/books", "/api/books/*", "/api/stats", "/api/export"],
};
