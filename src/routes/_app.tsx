import { useEffect, useRef } from "react";
import { createFileRoute, useNavigate, useRouterState } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { useAuth } from "@/lib/auth/AuthProvider";

export const Route = createFileRoute("/_app")({
  component: ProtectedLayout,
});

/**
 * Protezione lato interfaccia: evita di mostrare schermate private senza sessione.
 * NON è la barriera di sicurezza: i dati sono protetti dalle policy RLS nel database.
 */
function ProtectedLayout() {
  const { status } = useAuth();
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
  return <AppShell />;
}
