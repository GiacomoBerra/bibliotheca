import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Session, SupabaseClient, User } from "@supabase/supabase-js";
import { supabase as defaultClient } from "@/lib/supabase";
import { authErrorMessage } from "./messages";

export type AuthStatus = "loading" | "unconfigured" | "anonymous" | "authenticated";

export interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  /** true se la sessione è terminata senza che l'utente abbia premuto "Esci" */
  sessionExpired: boolean;
  /** true dopo l'apertura del link di recupero password */
  recoveryMode: boolean;
  signIn(email: string, password: string): Promise<{ error: string | null }>;
  signOut(): Promise<void>;
  requestPasswordReset(email: string): Promise<{ error: string | null }>;
  updatePassword(password: string): Promise<{ error: string | null }>;
  clearSessionExpired(): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth va usato dentro <AuthProvider>");
  return ctx;
}

export function AuthProvider({ children, client = defaultClient }: { children: ReactNode; client?: SupabaseClient | null }) {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AuthStatus>(client ? "loading" : "unconfigured");
  const [sessionExpired, setSessionExpired] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const manualSignOut = useRef(false);
  const hadSession = useRef(false);

  useEffect(() => {
    if (!client) return;
    let active = true;
    client.auth.getSession().then(({ data }) => {
      if (!active) return;
      hadSession.current = Boolean(data.session);
      setSession(data.session);
      setStatus(data.session ? "authenticated" : "anonymous");
    }).catch(() => {
      if (active) setStatus("anonymous");
    });
    const { data } = client.auth.onAuthStateChange((event, next) => {
      if (!active) return;
      if (event === "PASSWORD_RECOVERY") setRecoveryMode(true);
      if (event === "SIGNED_OUT") {
        if (!manualSignOut.current && hadSession.current) setSessionExpired(true);
        manualSignOut.current = false;
        hadSession.current = false;
        setRecoveryMode(false);
      }
      if (next) hadSession.current = true;
      setSession(next);
      setStatus(next ? "authenticated" : "anonymous");
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [client]);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!client) return { error: "Il servizio di accesso non è configurato." };
    try {
      const { error } = await client.auth.signInWithPassword({ email: email.trim(), password });
      if (error) return { error: authErrorMessage(error) };
      setSessionExpired(false);
      return { error: null };
    } catch (e) {
      return { error: authErrorMessage(e as Error) };
    }
  }, [client]);

  const signOut = useCallback(async () => {
    if (!client) return;
    manualSignOut.current = true;
    await client.auth.signOut();
  }, [client]);

  const requestPasswordReset = useCallback(async (email: string) => {
    if (!client) return { error: "Il servizio di accesso non è configurato." };
    try {
      const { error } = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/reimposta-password` });
      // Il messaggio mostrato all'utente è neutro: non rivela se l'email esiste (vedi la pagina).
      if (error && (error.status === 429 || /rate|too many/i.test(error.message))) return { error: authErrorMessage(error) };
      return { error: null };
    } catch (e) {
      return { error: authErrorMessage(e as Error) };
    }
  }, [client]);

  const updatePassword = useCallback(async (password: string) => {
    if (!client) return { error: "Il servizio di accesso non è configurato." };
    try {
      const { error } = await client.auth.updateUser({ password });
      if (error) return { error: authErrorMessage(error) };
      setRecoveryMode(false);
      return { error: null };
    } catch (e) {
      return { error: authErrorMessage(e as Error) };
    }
  }, [client]);

  const value = useMemo<AuthContextValue>(() => ({
    status, user: session?.user ?? null, sessionExpired, recoveryMode,
    signIn, signOut, requestPasswordReset, updatePassword,
    clearSessionExpired: () => setSessionExpired(false),
  }), [status, session, sessionExpired, recoveryMode, signIn, signOut, requestPasswordReset, updatePassword]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
