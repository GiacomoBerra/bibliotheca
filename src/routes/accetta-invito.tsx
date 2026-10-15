import { useState, type FormEvent } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthLayout, FormMessage } from "@/components/app/AuthLayout";
import { useAuth } from "@/lib/auth/AuthProvider";
import { MIN_PASSWORD } from "./reimposta-password";

export const Route = createFileRoute("/accetta-invito")({
  head: () => ({ meta: [{ title: "Primo accesso — Bibliotheca" }] }),
  component: AccettaInvito,
});

function AccettaInvito() {
  const { status, inviteToken, acceptInvite, linkError } = useAuth();
  const navigate = useNavigate();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (pw.length < MIN_PASSWORD) { setError(`La password deve avere almeno ${MIN_PASSWORD} caratteri.`); return; }
    if (pw !== pw2) { setError("Le due password non coincidono."); return; }
    setBusy(true);
    const res = await acceptInvite(pw);
    setBusy(false);
    if (res.error) setError(res.error); else void navigate({ to: "/dashboard", replace: true });
  }

  if (status === "loading") {
    return <AuthLayout title="Primo accesso"><p role="status" className="mt-4 text-sm text-muted-foreground">Verifica del link in corso…</p></AuthLayout>;
  }
  if (!inviteToken) {
    return (
      <AuthLayout title="Primo accesso">
        <FormMessage tone="warning">{linkError ?? "Il link di invito non è valido o è già stato usato. Chiedi un nuovo invito al proprietario del catalogo."}</FormMessage>
        <p className="mt-4 text-sm"><Link to="/" className="text-primary underline underline-offset-4">Vai all'accesso</Link></p>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title="Scegli la tua password">
      <p className="mt-2 text-sm text-muted-foreground">Sei stato invitato a Bibliotheca. Scegli una password per completare il primo accesso.</p>
      <form className="mt-6 space-y-4" onSubmit={onSubmit} noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="pw">Password (almeno {MIN_PASSWORD} caratteri)</Label>
          <Input id="pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pw2">Ripeti la password</Label>
          <Input id="pw2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
        </div>
        {error && <FormMessage tone="error">{error}</FormMessage>}
        <Button type="submit" className="w-full" disabled={busy}>{busy ? "Salvataggio…" : "Crea l'accesso"}</Button>
      </form>
    </AuthLayout>
  );
}
