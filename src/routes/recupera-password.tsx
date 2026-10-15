import { useState, type FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthLayout, FormMessage } from "@/components/app/AuthLayout";
import { useAuth } from "@/lib/auth/AuthProvider";

export const Route = createFileRoute("/recupera-password")({
  head: () => ({ meta: [{ title: "Recupero password — Bibliotheca" }] }),
  component: Recupera,
});

function Recupera() {
  const { requestPasswordReset, status } = useAuth();
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim()) { setError("Inserisci l'indirizzo email."); return; }
    setBusy(true);
    const res = await requestPasswordReset(email);
    setBusy(false);
    if (res.error) setError(res.error); else setDone(true);
  }

  return (
    <AuthLayout title="Recupero password">
      {status === "unconfigured" ? (
        <FormMessage tone="warning">Servizio non configurato: vedi <code>docs/supabase-setup.md</code>.</FormMessage>
      ) : done ? (
        <FormMessage tone="info">Se l'indirizzo corrisponde a un account, riceverai un'email con il link per scegliere una nuova password. Controlla anche la cartella spam. Il piano gratuito invia poche email l'ora.</FormMessage>
      ) : (
        <form className="mt-6 space-y-4" onSubmit={onSubmit} noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="email">Email dell'account</Label>
            <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          {error && <FormMessage tone="error">{error}</FormMessage>}
          <Button type="submit" className="w-full" disabled={busy}>{busy ? "Invio…" : "Invia il link di recupero"}</Button>
        </form>
      )}
      <p className="mt-4 text-sm"><Link to="/" className="text-primary underline underline-offset-4">Torna all'accesso</Link></p>
    </AuthLayout>
  );
}
