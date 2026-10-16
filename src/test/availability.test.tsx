import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { todayIso } from "@/lib/api/loans";
import { AuthProvider } from "@/lib/auth/AuthProvider";
import { BooksApiProvider } from "@/lib/api/BooksApiContext";
import { routeTree } from "@/routeTree.gen";
import { makeFakeIdentity } from "./fakeIdentity";
import { makeBook, makeMemoryApi } from "./memoryApi";

const books = () => [
  makeBook({ id: "1", title: "Libro libero" }), makeBook({ id: "2", title: "Libro fuori" }),
  makeBook({ id: "3", title: "Libro scaduto" }), makeBook({ id: "4", title: "Libro due copie" }),
];
async function seeded(role: "admin" | "viewer") {
  const api = makeMemoryApi(books(), { role, today: "2026-10-15" });
  await api.createLoan("2", { borrower: "Nome Riservato", contact: "tel", loanDate: "2026-10-10", plannedDays: 30, notes: "privata" });
  await api.createLoan("3", { borrower: "Altro Nome", contact: "", loanDate: "2026-09-01", plannedDays: 5, notes: "" });
  api.forceAvailability("4", { state: "disponibilità parziale", totalCopies: 3, availableCopies: 2 });
  return api;
}
function renderAs(role: "admin" | "viewer", path: string, api: ReturnType<typeof makeMemoryApi>) {
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }) });
  render(
    <AuthProvider identity={makeFakeIdentity({ session: true, roles: [role] }).identity}>
      <BooksApiProvider api={api}><RouterProvider router={router} /></BooksApiProvider>
    </AuthProvider>,
  );
}
const row = (table: HTMLElement, title: string) => within(table).getByText(title).closest("tr")!;

describe("Catalogo — colonna «Stato prestito»", () => {
  it("mostra Disponibile, In prestito, In ritardo e Disponibilità parziale (con il rapporto tra copie) con testo, non solo colore", async () => {
    renderAs("admin", "/catalogo", await seeded("admin"));
    const t = await screen.findByRole("table");
    expect(within(t).getByRole("columnheader", { name: "Stato prestito" })).toBeInTheDocument();
    expect(within(row(t, "Libro libero")).getByText("Disponibile")).toBeInTheDocument();
    expect(within(row(t, "Libro fuori")).getByText("In prestito")).toBeInTheDocument();
    expect(within(row(t, "Libro scaduto")).getByText("In ritardo")).toBeInTheDocument();
    const par = row(t, "Libro due copie");
    expect(within(par).getByText("Disponibilità parziale")).toBeInTheDocument();
    expect(within(par).getByText("2 di 3 copie disponibili")).toBeInTheDocument();
    expect(within(row(t, "Libro libero")).queryByText(/copie disponibili/)).not.toBeInTheDocument(); // una sola copia: nessun rapporto
  });

  it("il visualizzatore vede gli stessi stati e nessun dato personale", async () => {
    const api = await seeded("viewer");
    renderAs("viewer", "/catalogo", api);
    const t = await screen.findByRole("table");
    expect(within(row(t, "Libro fuori")).getByText("In prestito")).toBeInTheDocument();
    expect(within(row(t, "Libro scaduto")).getByText("In ritardo")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Nome Riservato|Altro Nome|privata|tel/);
  });

  it("il filtro «Disponibilità» restringe l'elenco e si combina con la ricerca", async () => {
    const user = userEvent.setup();
    renderAs("admin", "/catalogo", await seeded("admin"));
    await screen.findByRole("table");
    const sel = screen.getByLabelText("Disponibilità");
    expect(within(sel).getAllByRole("option").map((o) => o.textContent)).toEqual(["Tutti", "Disponibili", "In prestito", "In ritardo", "Disponibilità parziale"]);
    await user.selectOptions(sel, "In ritardo");
    await waitFor(() => expect(within(screen.getByRole("table")).queryByText("Libro libero")).not.toBeInTheDocument());
    expect(within(screen.getByRole("table")).getByText("Libro scaduto")).toBeInTheDocument();
    await user.selectOptions(sel, "Disponibilità parziale");
    expect(await within(await screen.findByRole("table")).findByText("Libro due copie")).toBeInTheDocument();
    await user.selectOptions(sel, "Disponibili");
    await waitFor(() => expect(within(screen.getByRole("table")).getByText("Libro libero")).toBeInTheDocument());
    await user.type(screen.getByLabelText("Cerca nel catalogo"), "fuori");
    expect(await screen.findByText("Nessun risultato")).toBeInTheDocument(); // «Libro fuori» non è disponibile
  });

  it("si aggiorna senza ricaricare il sito: dopo un prestito dalla scheda, tornando al catalogo; e al ritorno sulla scheda del browser", async () => {
    const user = userEvent.setup();
    const api = makeMemoryApi(books(), { role: "admin", today: "2026-10-15" });
    renderAs("admin", "/catalogo/1", api);
    await user.click(await screen.findByRole("button", { name: "Registra prestito" }));
    await user.type(screen.getByLabelText(/Destinatario/), "Marta");
    await user.click(screen.getByRole("button", { name: "Verifica i dati" }));
    await user.click(await screen.findByRole("button", { name: "Conferma e registra il prestito" }));
    await screen.findByText(/Prestito registrato a Marta/);
    await user.click(screen.getAllByRole("link", { name: /Catalogo/ })[0]!);
    let t = await screen.findByRole("table");
    await waitFor(() => expect(within(row(t, "Libro libero")).getByText("In prestito")).toBeInTheDocument());
    // restituzione fatta altrove (altra scheda del browser): al ritorno l'elenco si riallinea
    const loan = api.allLoans()[0]!;
    await api.returnLoan(loan.id, todayIso());
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    t = await screen.findByRole("table");
    await waitFor(() => expect(within(row(t, "Libro libero")).getByText("Disponibile")).toBeInTheDocument());
    // un prestito annullato non rende il libro «in prestito»
    const l2 = await api.createLoan("1", { borrower: "Errore", contact: "", loanDate: todayIso(), plannedDays: 7, notes: "" });
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    await waitFor(() => expect(within(row(screen.getByRole("table"), "Libro libero")).getByText("In prestito")).toBeInTheDocument());
    await api.voidLoan(l2.id, "per errore");
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    await waitFor(() => expect(within(row(screen.getByRole("table"), "Libro libero")).getByText("Disponibile")).toBeInTheDocument());
  });
});
