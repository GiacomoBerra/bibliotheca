import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthLayout, FormMessage } from "@/components/app/AuthLayout";
import { useAuth } from "@/lib/auth/AuthProvider";
import { safeRedirect } from "@/lib/auth/redirect";

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => {
    const r = safeRedirect(search["redirect"]);
    return r ? { redirect: r } : {};
  },
  head: () => ({
    meta: [
      { title: "Accesso — Bibliotheca" },
      { name: "description", content: "Accesso riservato a Bibliotheca." },
    ],
  }),
  component: Login,
});

function Login() {
  const { status, signIn, sessionExpired, clearSessionExpired } = useAuth();
  const { redirect } = Route.useSearch();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status === "authenticated") void navigate({ to: redirect ?? "/dashboard", replace: true });
  }, [status, redirect, navigate]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password) {
      setError("Inserisci email e password.");
      return;
    }
    setBusy(true);
    const res = await signIn(email, password);
    setBusy(false);
    if (res.error) setError(res.error);
    else clearSessionExpired();
  }

  if (status === "loading") {
    return <AuthLayout title="Accesso"><p role="status" className="mt-4 text-sm text-muted-foreground">Verifica della sessione in corso…</p></AuthLayout>;
  }
  if (status === "unconfigured") {
    return (
      <AuthLayout title="Servizio non configurato">
        <FormMessage tone="warning">
          Mancano le variabili <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_PUBLISHABLE_KEY</code>. Il catalogo non può essere raggiunto. Consulta <code>docs/supabase-setup.md</code> per la configurazione.
        </FormMessage>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Accedi al tuo catalogo">
      <p className="mt-2 text-sm text-muted-foreground">Accesso riservato. La registrazione è chiusa: l'account viene creato dal proprietario.</p>
      {sessionExpired && <FormMessage tone="warning">La sessione è scaduta o è stata chiusa. Accedi di nuovo per continuare.</FormMessage>}
      <form className="mt-6 space-y-4" onSubmit={onSubmit} noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <FormMessage tone="error">{error}</FormMessage>}
        <Button type="submit" className="w-full" disabled={busy}>{busy ? "Accesso in corso…" : "Accedi"}</Button>
      </form>
      <p className="mt-4 text-sm"><Link to="/recupera-password" className="text-primary underline underline-offset-4">Password dimenticata?</Link></p>
    </AuthLayout>
  );
}
