import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Client Supabase per il browser. Usa SOLO URL e chiave pubblicabile (variabili VITE_*,
 * che finiscono nel bundle pubblico). Mai chiavi segrete / service_role qui.
 * L'autorizzazione vera è nelle policy RLS del database (supabase/migrations).
 */
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const isSupabaseConfigured = Boolean(url && key);

export const supabase: SupabaseClient | null =
  url && key
    ? createClient(url, key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      })
    : null;
