import { createMemoryHistory, createRouter, rootRouteId } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { routeTree } from "@/routeTree.gen";

// Verifica solo l'abbinamento delle route (senza renderizzare né eseguire i loader).
function matchedIds(path: string) {
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }) });
  return router.matchRoutes(path).map((m) => m.routeId);
}

describe("Routing dell'applicazione", () => {
  it.each(["/", "/recupera-password", "/reimposta-password", "/dashboard", "/catalogo", "/catalogo/3", "/didattica", "/impostazioni"])(
    "%s corrisponde a una pagina reale",
    (path) => {
      expect(matchedIds(path).at(-1)).not.toBe(rootRouteId);
    },
  );

  it("un indirizzo inesistente non corrisponde a nessuna pagina", () => {
    expect(matchedIds("/pagina-inesistente").at(-1)).toBe(rootRouteId);
  });
});
