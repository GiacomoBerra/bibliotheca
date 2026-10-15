import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as netlifyIdentity from "@netlify/identity";
import { authErrorMessage } from "./messages";

export interface IdentityUser { id: string; email?: string | undefined; roles?: readonly string[] | undefined }

/** Parte di @netlify/identity usata dall'app: permette di sostituirla nei test. */
export interface IdentityApi {
  getUser(): Promise<IdentityUser | null>;
  login(email: string, password: string): Promise<unknown>;
  logout(): Promise<void>;
  requestPasswordRecovery(email: string): Promise<void>;
  updateUser(updates: { password?: string }): Promise<unknown>;
  handleAuthCallback(): Promise<{ type: string; token?: string | undefined } | null>;
  acceptInvite(token: string, password: string): Promise<unknown>;
  onAuthChange(cb: (event: string, user: IdentityUser | null) => void): () => void;
  refreshSession(): Promise<string | null>;
}

export type AuthStatus = "loading" | "unconfigured" | "anonymous" | "authenticated";
export type AppRole = "admin" | "viewer";
export interface AuthUser { id: string; email?: string | undefined; roles: readonly string[] }
/** Ruolo effettivo (come sul server: admin prevale; ogni altro valore = nessun ruolo). Solo per l'interfaccia: i permessi veri li applica il server. */
export function roleOf(user: Pick<AuthUser, "roles"> | null): AppRole | null {
  if (!user) return null;
  if (user.roles.includes("admin")) return "admin";
  if (user.roles.includes("viewer")) return "viewer";
  return null;
}

export interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  /** Ruolo dell'utente (admin / viewer) o null se non ne ha uno. */
  role: AppRole | null;
  /** true se l'utente è amministratore (può modificare); la barriera vera è nel server. */
  isAdmin: boolean;
  /** true se la sessione è terminata senza che l'utente abbia premuto "Esci" */
  sessionExpired: boolean;
  /** true dopo l'apertura del link di recupero password (l'utente è collegato per scegliere la nuova password) */
  recoveryMode: boolean;
  /** token di invito da usare per scegliere la password del primo accesso */
  inviteToken: string | null;
  /** errore nell'elaborazione di un link ricevuto per email */
  linkError: string | null;
  signIn(email: string, password: string): Promise<{ error: string | null }>;
  signOut(): Promise<void>;
  requestPasswordReset(email: string): Promise<{ error: string | null }>;
  updatePassword(password: string): Promise<{ error: string | null }>;
  acceptInvite(password: string): Promise<{ error: string | null }>;
  /** Tenta il rinnovo della sessione (usato dalle API su 401). */
  refresh(): Promise<boolean>;
  /** Segna la sessione come scaduta (usato dalle API quando il rinnovo fallisce). */
  expireSession(): void;
  clearSessionExpired(): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth va usato dentro <AuthProvider>");
  return ctx;
}

const realIdentity = netlifyIdentity as unknown as IdentityApi;

export function AuthProvider({ children, identity = realIdentity }: { children: ReactNode; identity?: IdentityApi }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [sessionExpired, setSessionExpired] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const manualSignOut = useRef(false);
  const hadSession = useRef(false);

  const apply = useCallback((raw: IdentityUser | null) => {
    const u: AuthUser | null = raw ? { id: raw.id, email: raw.email, roles: raw.roles ?? [] } : null;
    setUser(u);
    setStatus(u ? "authenticated" : "anonymous");
    if (u) hadSession.current = true;
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        try {
          const cb = await identity.handleAuthCallback();
          if (active && cb?.type === "recovery") setRecoveryMode(true);
          if (active && cb?.type === "invite" && cb.token) setInviteToken(cb.token);
        } catch (e) {
          if ((e as Error).name === "MissingIdentityError") throw e;
          if (active) setLinkError("Il link ricevuto per email non è valido o è scaduto. Richiedine uno nuovo.");
        }
        const u = await identity.getUser();
        if (active) apply(u);
      } catch (e) {
        if (!active) return;
        if ((e as Error).name === "MissingIdentityError") setStatus("unconfigured");
        else setStatus("anonymous");
      }
    })();
    const off = identity.onAuthChange((event, u) => {
      if (!active) return;
      if (event === "recovery") setRecoveryMode(true);
      if (event === "token_refresh" || event === "user_updated") { if (u) apply(u); return; }
      if (event === "logout" || !u) {
        if (!manualSignOut.current && hadSession.current) setSessionExpired(true);
        manualSignOut.current = false;
        hadSession.current = false;
        setRecoveryMode(false);
        apply(null);
        return;
      }
      apply(u);
    });
    return () => { active = false; off(); };
  }, [identity, apply]);

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      await identity.login(email.trim(), password);
      const u = await identity.getUser();
      setSessionExpired(false);
      apply(u);
      return { error: null };
    } catch (e) {
      return { error: authErrorMessage(e as Error) };
    }
  }, [identity, apply]);

  const signOut = useCallback(async () => {
    manualSignOut.current = true;
    try { await identity.logout(); } finally { setRecoveryMode(false); hadSession.current = false; apply(null); manualSignOut.current = false; }
  }, [identity, apply]);

  const requestPasswordReset = useCallback(async (email: string) => {
    try {
      await identity.requestPasswordRecovery(email.trim());
      return { error: null }; // risposta neutra: non rivela se l'email esiste
    } catch (e) {
      const err = e as { status?: number; message?: string; name?: string };
      // Un indirizzo sconosciuto non deve essere distinguibile: si segnalano solo limiti e problemi di rete/servizio.
      if (err.status === 429 || err.name === "MissingIdentityError" || /fetch|network|rate/i.test(err.message ?? "")) return { error: authErrorMessage(err) };
      return { error: null };
    }
  }, [identity]);

  const updatePassword = useCallback(async (password: string) => {
    try {
      await identity.updateUser({ password });
      setRecoveryMode(false);
      return { error: null };
    } catch (e) {
      return { error: authErrorMessage(e as Error) };
    }
  }, [identity]);

  const acceptInvite = useCallback(async (password: string) => {
    if (!inviteToken) return { error: "Il link di invito non è più valido. Chiedi un nuovo invito al proprietario." };
    try {
      await identity.acceptInvite(inviteToken, password);
      const u = await identity.getUser();
      setInviteToken(null);
      apply(u);
      return { error: null };
    } catch (e) {
      return { error: authErrorMessage(e as Error) };
    }
  }, [identity, inviteToken, apply]);

  const refresh = useCallback(async () => {
    try { return (await identity.refreshSession()) !== null; } catch { return false; }
  }, [identity]);

  const expireSession = useCallback(() => {
    if (hadSession.current) setSessionExpired(true);
    hadSession.current = false;
    apply(null);
  }, [apply]);

  const value = useMemo<AuthContextValue>(() => ({
    status, user, role: roleOf(user), isAdmin: roleOf(user) === "admin", sessionExpired, recoveryMode, inviteToken, linkError,
    signIn, signOut, requestPasswordReset, updatePassword, acceptInvite, refresh, expireSession,
    clearSessionExpired: () => setSessionExpired(false),
  }), [status, user, sessionExpired, recoveryMode, inviteToken, linkError, signIn, signOut, requestPasswordReset, updatePassword, acceptInvite, refresh, expireSession]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
