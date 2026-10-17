import { useEffect } from "react";
import { createRootRoute, HeadContent, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";

import { ErrorPage, NotFoundPage } from "@/components/app/ErrorPages";
import { useAuth } from "@/lib/auth/AuthProvider";

export const Route = createRootRoute({
  component: RootComponent,
  notFoundComponent: NotFoundPage,
  errorComponent: ErrorPage,
});

/** I link ricevuti per email (invito, recupero password) atterrano sulla radice: qui si instradano al modulo giusto. */
function RootComponent() {
  const { inviteToken, recoveryMode } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => {
    if (inviteToken && pathname !== "/accetta-invito") void navigate({ to: "/accetta-invito", replace: true });
    else if (!inviteToken && recoveryMode && pathname !== "/reimposta-password") void navigate({ to: "/reimposta-password", replace: true });
  }, [inviteToken, recoveryMode, pathname, navigate]);
  return (
    <>
      <HeadContent />
      <Outlet />
    </>
  );
}
