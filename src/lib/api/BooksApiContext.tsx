import { createContext, useContext, useMemo, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { createSupabaseBooksApi } from "./supabaseBooksApi";
import type { BooksApi } from "./types";

const BooksApiContext = createContext<BooksApi | null>(null);

export function BooksApiProvider({ api, children }: { api?: BooksApi; children: ReactNode }) {
  const value = useMemo(() => api ?? (supabase ? createSupabaseBooksApi(supabase) : null), [api]);
  return <BooksApiContext.Provider value={value}>{children}</BooksApiContext.Provider>;
}

export function useBooksApi(): BooksApi {
  const api = useContext(BooksApiContext);
  if (!api) throw new Error("Livello dati non disponibile: manca la configurazione di Supabase.");
  return api;
}
