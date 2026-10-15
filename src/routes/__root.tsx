import { createRootRoute, HeadContent, Outlet } from "@tanstack/react-router";

import { ErrorPage, NotFoundPage } from "@/components/app/ErrorPages";

export const Route = createRootRoute({
  component: RootComponent,
  notFoundComponent: NotFoundPage,
  errorComponent: ErrorPage,
});

function RootComponent() {
  return (
    <>
      <HeadContent />
      <Outlet />
    </>
  );
}
