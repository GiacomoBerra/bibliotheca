import { useState, type FormEvent } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthLayout, FormMessage } from "@/components/app/AuthLayout";
import { useAuth } from "@/lib/auth/AuthProvider";

export const Route = createFileRoute("/reimposta-password")({
  head: () => ({ meta: [{ title: "Nuova password — Bibliotheca" }] }),
  component: Reimposta,
});

export const MIN_PASSWORD = 12;

function Reimposta() {
  const { status, recoveryMode, updatePassword } = useAuth();
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
    const res = await updatePassword(pw);
    setBusy(false);
    if (res.error) setError(res.error); else void navigate({ to: "/dashboard", replace: true });
  }

  if (status === "loading") {
    return <AuthLayout title="Nuova password"><p role="status" className="mt-4 text-sm text-muted-foreground">Verifica del link in corso…</p></AuthLayout>;
  }
  // Il link di recupero crea una sessione temporanea: senza di essa il link non è valido.
  if (status !== "authenticated" || !recoveryMode) {
    return (
      <AuthLayout title="Nuova password">
        <FormMessage tone="warning">Il link non è valido o è scaduto. Richiedine uno nuovo dalla pagina di recupero.</FormMessage>
        <p className="mt-4 text-sm"><Link to="/recupera-password" className="text-primary underline underline-offset-4">Richiedi un nuovo link</Link></p>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title="Scegli una nuova password">
      <form className="mt-6 space-y-4" onSubmit={onSubmit} noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="pw">Nuova password (almeno {MIN_PASSWORD} caratteri)</Label>
          <Input id="pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pw2">Ripeti la password</Label>
          <Input id="pw2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
        </div>
        {error && <FormMessage tone="error">{error}</FormMessage>}
        <Button type="submit" className="w-full" disabled={busy}>{busy ? "Salvataggio…" : "Salva la nuova password"}</Button>
      </form>
    </AuthLayout>
  );
}
