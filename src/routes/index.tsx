import { createFileRoute, Link } from "@tanstack/react-router";
import { BookOpen, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DemoBadge } from "@/components/app/common";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Accesso — Bibliotheca" },
      { name: "description", content: "Bibliotheca: catalogazione di libri e apprendimento di MARC21, soggettazione e Dewey." },
    ],
  }),
  component: Login,
});

function Login() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-sidebar px-4 py-10">
      <div className="w-full max-w-md rounded-xl bg-card p-8 shadow-xl">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BookOpen className="h-7 w-7 text-primary" aria-hidden />
            <span className="font-serif text-2xl font-semibold">Bibliotheca</span>
          </div>
          <DemoBadge label="Demo" />
        </div>
        <h1 className="text-2xl font-semibold">Accedi al tuo catalogo</h1>
        <div role="note" className="mt-4 flex gap-3 rounded-md border border-warning-foreground/30 bg-warning p-3 text-sm text-warning-foreground">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>Prima versione dell'interfaccia, solo con dati dimostrativi: non è ancora un sistema bibliotecario e non conserva dati reali. L'autenticazione verrà collegata in una fase successiva. Registrazione chiusa, solo su invito.</p>
        </div>
        <form className="mt-6 space-y-4" onSubmit={(e) => e.preventDefault()} aria-describedby="login-off">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" autoComplete="email" disabled placeholder="nome@esempio.it" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" autoComplete="current-password" disabled />
          </div>
          <p id="login-off" className="text-xs text-muted-foreground">I campi sono disattivati: l'accesso reale non è ancora disponibile.</p>
          <Button type="submit" className="w-full" disabled>Accedi (non disponibile)</Button>
        </form>
        <Button asChild variant="outline" className="mt-3 w-full">
          <Link to="/dashboard">Entra nella demo</Link>
        </Button>
      </div>
    </div>
  );
}
