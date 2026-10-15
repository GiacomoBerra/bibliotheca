import { render, screen } from "@testing-library/react";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { AuthProvider } from "@/lib/auth/AuthProvider";
import { BooksApiProvider } from "@/lib/api/BooksApiContext";
import { routeTree } from "@/routeTree.gen";
import { makeFakeIdentity } from "./fakeIdentity";
import { makeBook, makeMemoryApi } from "./memoryApi";

const marc = [{ tag: "245", ind1: "1", ind2: "0", subfields: [{ code: "a", value: "Titolo MARC" }] }];
const seed = () => [makeBook({ id: "1", title: "Libro condiviso", marcFields: marc, marcLeader: "00000nam a2200000 a 4500" })];

function renderAs(roles: string[], path: string) {
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }) });
  render(
    <AuthProvider identity={makeFakeIdentity({ session: true, roles }).identity}>
      <BooksApiProvider api={makeMemoryApi(seed())}>
        <RouterProvider router={router} />
      </BooksApiProvider>
    </AuthProvider>,
  );
}

describe("Interfaccia per ruolo (aiuto visivo: i permessi veri sono nel server)", () => {
  it("admin: vede Aggiungi libro, Modifica, Cancella ed Esporta", async () => {
    renderAs(["admin"], "/catalogo");
    expect(await screen.findByRole("link", { name: /Aggiungi libro/ })).toBeInTheDocument();
  });
  it("admin: la scheda ha Modifica e Cancella", async () => {
    renderAs(["admin"], "/catalogo/1");
    expect(await screen.findByRole("link", { name: /Modifica/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cancella/ })).toBeInTheDocument();
  });
  it("viewer: consulta elenco e scheda con i campi MARC21, senza pulsanti di scrittura", async () => {
    renderAs(["viewer"], "/catalogo");
    expect((await screen.findAllByText("Libro condiviso")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("link", { name: /Aggiungi libro/ })).not.toBeInTheDocument();
  });
  it("viewer: scheda completa con MARC, senza Modifica/Cancella", async () => {
    renderAs(["viewer"], "/catalogo/1");
    expect(await screen.findByRole("heading", { name: "Libro condiviso" })).toBeInTheDocument();
    expect(screen.getByText(/Titolo MARC/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Modifica/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Cancella/ })).not.toBeInTheDocument();
  });
  it("viewer: le pagine di inserimento e modifica mostrano il blocco, non il modulo", async () => {
    renderAs(["viewer"], "/catalogo/nuovo");
    expect(await screen.findByText(/riservata agli amministratori/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Salva la scheda/ })).not.toBeInTheDocument();
  });
  it("viewer: niente pulsanti di esportazione nelle impostazioni", async () => {
    renderAs(["viewer"], "/impostazioni");
    expect(await screen.findByText(/riservate agli amministratori/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Scarica/ })).not.toBeInTheDocument();
  });
  it("account senza ruolo: schermata dedicata e nessun dato", async () => {
    renderAs([], "/catalogo");
    expect(await screen.findByText("Account senza ruolo")).toBeInTheDocument();
    expect(screen.queryByText("Libro condiviso")).not.toBeInTheDocument();
  });
});
