import type { IdentityApi } from "@/lib/auth/AuthProvider";

type Listener = Parameters<IdentityApi["onAuthChange"]>[0];
const BASE_USER = { id: "user-1", email: "proprietario@esempio.it" };

/** Finto @netlify/identity per testare i flussi dell'interfaccia (l'integrazione reale si prova su una Deploy Preview). */
export function makeFakeIdentity(opts: { session?: boolean; callback?: { type: string; token?: string } | null; roles?: string[]; callbackThrows?: Error; loginError?: Error & { status?: number }; getUserThrows?: Error } = {}) {
  const USER = { ...BASE_USER, roles: opts.roles ?? ["admin"] };
  let current: typeof USER | null = opts.session ? USER : null;
  const listeners = new Set<Listener>();
  const emit = (event: string, u: typeof USER | null) => { current = u; listeners.forEach((l) => l(event, u)); };
  const calls = { recoveryEmail: "", newPassword: "", invitePassword: "", inviteToken: "", logins: 0 };
  const identity: IdentityApi = {
    getUser: async () => { if (opts.getUserThrows) throw opts.getUserThrows; return current; },
    login: async (email, password) => {
      if (opts.loginError) throw opts.loginError;
      if (email === USER.email && password === "password-corretta-123") { calls.logins++; current = USER; emit("login", USER); return USER; }
      throw Object.assign(new Error("invalid_grant: No user found with that email, or password invalid."), { status: 400 });
    },
    logout: async () => { emit("logout", null); },
    requestPasswordRecovery: async (e) => { calls.recoveryEmail = e; },
    updateUser: async ({ password }) => { calls.newPassword = password ?? ""; return USER; },
    handleAuthCallback: async () => { if (opts.callbackThrows) throw opts.callbackThrows; return opts.callback ?? null; },
    acceptInvite: async (token, password) => { calls.inviteToken = token; calls.invitePassword = password; current = USER; return USER; },
    onAuthChange: (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    refreshSession: async () => (current ? "token" : null),
  };
  return { identity, emit, calls, user: USER };
}
