import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { createHttpBooksApi } from "./httpBooksApi";
import type { BooksApi } from "./types";

const BooksApiContext = createContext<BooksApi | null>(null);

/** Fornisce il livello dati. In produzione chiama le Netlify Functions; nei test si può iniettare un'implementazione. */
export function BooksApiProvider({ api, children }: { api?: BooksApi; children: ReactNode }) {
  const { refresh, expireSession } = useAuth();
  const value = useMemo(
    () => api ?? createHttpBooksApi({ refreshSession: refresh, onSessionExpired: expireSession }),
    [api, refresh, expireSession],
  );
  return <BooksApiContext.Provider value={value}>{children}</BooksApiContext.Provider>;
}

export function useBooksApi(): BooksApi {
  const api = useContext(BooksApiContext);
  if (!api) throw new Error("Livello dati non disponibile.");
  return api;
}
