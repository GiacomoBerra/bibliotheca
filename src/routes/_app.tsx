import { useEffect, useRef } from "react";
import { createFileRoute, useNavigate, useRouterState } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { useAuth } from "@/lib/auth/AuthProvider";

export const Route = createFileRoute("/_app")({
  component: ProtectedLayout,
});

/**
 * Protezione lato interfaccia: evita di mostrare schermate private senza sessione.
 * NON è la barriera di sicurezza: identità e ruolo sono verificati dalla Function (server/router.ts) a ogni richiesta.
 */
function ProtectedLayout() {
  const { status, role, signOut } = useAuth();
  const href = useRouterState({ select: (s) => s.location.href });
  const navigate = useNavigate();
  const redirecting = useRef(false);
  useEffect(() => {
    // Una sola redirezione per montaggio: evita cicli se il router aggiorna lo stato durante il caricamento.
    if ((status === "anonymous" || status === "unconfigured") && !redirecting.current) {
      redirecting.current = true;
      void navigate({ to: "/", search: { redirect: href }, replace: true });
    }
  }, [status, href, navigate]);
  if (status !== "authenticated") {
    return <div role="status" className="flex min-h-screen items-center justify-center text-muted-foreground">Verifica della sessione…</div>;
  }
  if (!role) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-6">
        <h1 className="text-2xl font-semibold">Account senza ruolo</h1>
        <p className="text-muted-foreground">Hai effettuato l'accesso, ma al tuo account non è stato assegnato un ruolo (amministratore o visualizzatore). Chiedi all'amministratore di assegnartelo, poi esci e accedi di nuovo.</p>
        <button type="button" className="self-start rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted" onClick={() => void signOut()}>Esci</button>
      </div>
    );
  }
  return <AppShell />;
}
