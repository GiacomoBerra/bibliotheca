import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import type { Db } from "./db";
import { handle, type Deps } from "./router";

/** Postgres reale (PGlite) con la migrazione vera, esposto come `Db`. */
export async function makeTestDb(): Promise<{ db: Db; raw: PGlite }> {
  const raw = new PGlite();
  await raw.exec(readFileSync("netlify/database/migrations/20261016000001_books.sql", "utf8"));
  const db: Db = {
    async query<T>(text: string, params: unknown[] = []) {
      const r = await raw.query<T>(text, params);
      return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
    },
  };
  return { db, raw };
}

/**
 * Finta sessione verificata: identità e ruoli si leggono SOLO dalle intestazioni `x-test-session` (id) e
 * `x-test-roles` (ruoli separati da virgola), che nei test rappresentano il JWT già verificato da Netlify Identity.
 * Le intestazioni della richiesta reale (x-user-id, authorization, cookie...) non contano.
 */
export function makeDeps(db: Db | null, extra: Partial<Deps> = {}): Deps {
  return { getDb: () => db, getPrincipal: async (req) => {
      const id = req.headers.get("x-test-session");
      return id ? { id, roles: (req.headers.get("x-test-roles") ?? "").split(",").filter(Boolean) } : null;
    },
    ...extra,
  };
}

export function api(deps: Deps) {
  return async (method: string, path: string, opts: { user?: string; roles?: string[]; body?: unknown; headers?: Record<string, string>; raw?: string } = {}) => {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (opts.user) { headers["x-test-session"] = opts.user; headers["x-test-roles"] = (opts.roles ?? ["admin"]).join(","); }
    if (method !== "GET") { headers["x-bibliotheca"] ??= "1"; headers["content-type"] ??= "application/json"; headers["origin"] ??= "https://bibliotheca.test"; }
    const body = method === "GET" ? undefined : opts.raw ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined);
    const res = await handle(new Request(`https://bibliotheca.test${path}`, { method, headers, ...(body !== undefined ? { body } : {}) }), deps);
    let json: any = null;
    try { json = await res.json(); } catch { /* vuoto */ }
    return { status: res.status, json, headers: res.headers };
  };
}
