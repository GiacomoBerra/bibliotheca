import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { AuthProvider } from "@/lib/auth/AuthProvider";
import { BooksApiProvider } from "@/lib/api/BooksApiContext";
import { routeTree } from "@/routeTree.gen";
import { makeFakeIdentity } from "./fakeIdentity";
import { makeBook, makeMemoryApi } from "./memoryApi";

function renderAs(role: "admin" | "viewer") {
  const api = makeMemoryApi([makeBook({ id: "1", title: "Il nome della rosa" })], { role });
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ["/catalogo/1"] }) });
  render(
    <AuthProvider identity={makeFakeIdentity({ session: true, roles: [role] }).identity}>
      <BooksApiProvider api={api}><RouterProvider router={router} /></BooksApiProvider>
    </AuthProvider>,
  );
  return api;
}

describe("Copie fisiche — scheda del libro", () => {
  it("l'amministratore aggiunge una copia con codice; la tabella e il conteggio si aggiornano", async () => {
    const user = userEvent.setup();
    renderAs("admin");
    expect(await screen.findByRole("heading", { name: /Copie fisiche \(1\)/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Aggiungi una copia" }));
    await user.type(screen.getByLabelText(/Codice di inventario/), "INV-042");
    await user.click(screen.getByRole("button", { name: "Aggiungi la copia" }));
    expect(await screen.findByRole("heading", { name: /Copie fisiche \(2\)/ })).toBeInTheDocument();
    const t = screen.getByRole("table", { name: "Copie fisiche del libro" });
    expect(within(t).getByText("INV-042")).toBeInTheDocument();
  });

  it("codice duplicato: messaggio chiaro e nessuna copia aggiunta", async () => {
    const user = userEvent.setup();
    renderAs("admin");
    for (let i = 0; i < 2; i++) {
      await user.click(await screen.findByRole("button", { name: "Aggiungi una copia" }));
      await user.type(screen.getByLabelText(/Codice di inventario/), "DUP-1");
      await user.click(screen.getByRole("button", { name: "Aggiungi la copia" }));
      if (i === 0) await screen.findByRole("heading", { name: /Copie fisiche \(2\)/ });
    }
    expect(await screen.findByRole("alert")).toHaveTextContent(/già usato/);
    expect(screen.getByRole("heading", { name: /Copie fisiche \(2\)/ })).toBeInTheDocument();
  });

  it("il visualizzatore vede le copie ma non può aggiungerle né modificarle", async () => {
    renderAs("viewer");
    expect(await screen.findByRole("heading", { name: /Copie fisiche \(1\)/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aggiungi una copia" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Modifica codice e note/ })).not.toBeInTheDocument();
  });
});

describe("Nuovo libro — avviso duplicati", () => {
  it("stesso ISBN di una scheda esistente: avviso con link, nessun salvataggio finché non si conferma", async () => {
    const user = userEvent.setup();
    const api = makeMemoryApi([makeBook({ id: "1", title: "Il nome della rosa", isbn: "978-0-306-40615-7" })], { role: "admin" });
    const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ["/catalogo/nuovo"] }) });
    render(
      <AuthProvider identity={makeFakeIdentity({ session: true, roles: ["admin"] }).identity}>
        <BooksApiProvider api={api}><RouterProvider router={router} /></BooksApiProvider>
      </AuthProvider>,
    );
    await user.type(await screen.findByLabelText("Titolo *"), "Il nome della rosa (copia mia)");
    await user.type(screen.getByLabelText("ISBN"), "9780306406157");
    await user.click(screen.getByRole("button", { name: "Salva la scheda" }));
    const box = await screen.findByRole("alert", { name: "Possibile duplicato" });
    expect(within(box).getByRole("link", { name: "Il nome della rosa" })).toBeInTheDocument();
    expect((await api.listBooks({})).items).toHaveLength(1); // nulla salvato
    await user.click(within(box).getByRole("button", { name: "Salva comunque come nuova scheda" }));
    await screen.findByRole("heading", { name: /copia mia/ });
    expect((await api.listBooks({})).items).toHaveLength(2);
  });
});
