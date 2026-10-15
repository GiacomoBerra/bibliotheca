import type { SupabaseClient } from "@supabase/supabase-js";

type Listener = (event: string, session: unknown) => void;
const fakeSession = { user: { id: "u1", email: "proprietario@esempio.it" }, access_token: "t" };

/** Client Supabase finto: permette di testare i flussi di autenticazione senza rete. */
export function makeFakeAuthClient(opts: { session?: boolean; signInError?: { message: string; code?: string; status?: number } } = {}) {
  let current: unknown = opts.session ? fakeSession : null;
  const listeners = new Set<Listener>();
  const emit = (event: string, s: unknown) => { current = s; listeners.forEach((l) => l(event, s)); };
  const calls = { resetRedirect: "" as string, updatedPassword: "" as string };
  const auth = {
    getSession: async () => ({ data: { session: current } }),
    onAuthStateChange: (cb: Listener) => { listeners.add(cb); return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } }; },
    signInWithPassword: async ({ email, password }: { email: string; password: string }) => {
      if (opts.signInError) return { error: opts.signInError };
      if (email === "proprietario@esempio.it" && password === "password-corretta-123") { emit("SIGNED_IN", fakeSession); return { error: null }; }
      return { error: { message: "Invalid login credentials", code: "invalid_credentials", status: 400 } };
    },
    signOut: async () => { emit("SIGNED_OUT", null); return { error: null }; },
    resetPasswordForEmail: async (_e: string, o: { redirectTo: string }) => { calls.resetRedirect = o.redirectTo; return { error: null }; },
    updateUser: async ({ password }: { password: string }) => { calls.updatedPassword = password; return { error: null }; },
  };
  return { client: { auth } as unknown as SupabaseClient, emit, calls, session: fakeSession };
}
