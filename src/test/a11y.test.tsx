import { render, screen } from "@testing-library/react";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import axe from "axe-core";
import { describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/lib/auth/AuthProvider";
import { BooksApiProvider } from "@/lib/api/BooksApiContext";
import { routeTree } from "@/routeTree.gen";
import { makeFakeIdentity } from "./fakeIdentity";
import { makeBook, makeMemoryApi } from "./memoryApi";

vi.setConfig({ testTimeout: 20_000 });

/**
 * Controlli di accessibilità automatici con axe-core (struttura, nomi accessibili, etichette, ruoli ARIA, tabelle…).
 * Limiti: in jsdom NON si valutano contrasto dei colori, layout responsive, ordine visivo, uso con screen reader reali.
 */
async function audit(role: "admin" | "viewer", path: string, ready: RegExp | string) {
  const api = makeMemoryApi([makeBook({ id: "1", title: "Il nome della rosa", authors: ["Eco, Umberto"], subjects: ["Romanzi storici"], dewey: "", marcLeader: "00000nam a2200000   4500", marcFields: [{ tag: "245", ind1: "1", ind2: "0", subfields: [{ code: "a", value: "Il nome della rosa" }] }] })], { role });
  await api.createLoan("1", { borrower: "Marta Rossi", contact: "", loanDate: "2026-10-01", plannedDays: 14, notes: "" });
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }) });
  const { container } = render(
    <AuthProvider identity={makeFakeIdentity({ session: true, roles: [role] }).identity}>
      <BooksApiProvider api={api}><RouterProvider router={router} /></BooksApiProvider>
    </AuthProvider>,
  );
  await screen.findAllByText(ready);
  const res = await axe.run(container, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
  return res.violations.map((v) => `${v.id}: ${v.help} → ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`);
}

describe("Accessibilità (axe-core, senza contrasto né layout)", () => {
  it.each([
    ["admin", "/dashboard", /Dashboard|Catalogo/],
    ["admin", "/catalogo", "Il nome della rosa"],
    ["admin", "/catalogo/1", "Storico dei prestiti"],
    ["viewer", "/catalogo/1", "Storico dei prestiti"],
    ["admin", "/catalogo/nuovo", /Titolo/],
    ["admin", "/prestiti", "Marta Rossi"],
    ["admin", "/didattica", /Esplora un campo MARC 21/],
    ["viewer", "/didattica", /Esplora un campo MARC 21/],
    ["admin", "/impostazioni", /Esporta in JSON/],
  ] as const)("%s %s: nessuna violazione", async (role, path, ready) => {
    expect(await audit(role, path, ready)).toEqual([]);
  });
});
