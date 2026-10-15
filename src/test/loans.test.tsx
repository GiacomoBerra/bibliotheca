import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { AuthProvider } from "@/lib/auth/AuthProvider";
import { BooksApiProvider } from "@/lib/api/BooksApiContext";
import { routeTree } from "@/routeTree.gen";
import { makeFakeIdentity } from "./fakeIdentity";
import { makeBook, makeMemoryApi } from "./memoryApi";

function renderAs(role: "admin" | "viewer", path: string, api = makeMemoryApi([makeBook({ id: "1", title: "Il nome della rosa" })], { role })) {
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }) });
  render(
    <AuthProvider identity={makeFakeIdentity({ session: true, roles: [role] }).identity}>
      <BooksApiProvider api={api}><RouterProvider router={router} /></BooksApiProvider>
    </AuthProvider>,
  );
  return api;
}

describe("Prestiti — scheda del libro", () => {
  it("admin: registra un prestito, il libro risulta «in prestito» e compare nello storico", async () => {
    const user = userEvent.setup();
    const api = renderAs("admin", "/catalogo/1");
    expect(await screen.findByText("Questo libro non è mai stato prestato.")).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Destinatario/), "Marta Rossi");
    expect(screen.getByText(/Restituzione prevista:/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Registra il prestito" }));
    expect(await screen.findByText(/Prestito registrato a Marta Rossi/)).toBeInTheDocument();
    const tabella = await screen.findByRole("table");
    expect(within(tabella).getByText("Marta Rossi")).toBeInTheDocument();
    expect(within(tabella).getByText("in prestito")).toBeInTheDocument();
    expect(api.allLoans()).toHaveLength(1);
  });

  it("admin: senza nome non si registra nulla e il messaggio spiega cosa fare", async () => {
    const user = userEvent.setup();
    const api = renderAs("admin", "/catalogo/1");
    await user.click(await screen.findByRole("button", { name: "Registra il prestito" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Indica il nome di chi riceve il libro.");
    expect(api.allLoans()).toHaveLength(0);
  });

  it("admin: con un prestito in corso non si può registrarne un altro; la restituzione conserva lo storico", async () => {
    const user = userEvent.setup();
    const api = renderAs("admin", "/catalogo/1");
    await user.type(await screen.findByLabelText(/Destinatario/), "Luca Bianchi");
    await user.click(screen.getByRole("button", { name: "Registra il prestito" }));
    await screen.findByText(/Prestito registrato/);
    expect(screen.queryByRole("button", { name: "Registra il prestito" })).not.toBeInTheDocument();
    expect(screen.getByText(/in prestito a/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Registra la restituzione/ }));
    expect(await screen.findByText(/Restituzione registrata: il prestito resta nello storico/)).toBeInTheDocument();
    await waitFor(() => expect(within(screen.getByRole("table")).getByText("restituito")).toBeInTheDocument());
    expect(api.allLoans()).toHaveLength(1);
    expect(api.allLoans()[0]!.returnedDate).not.toBeNull();
    expect(await screen.findByRole("button", { name: "Registra il prestito" })).toBeInTheDocument(); // di nuovo disponibile
  });

  it("viewer: vede stato e date ma non nomi né moduli di gestione", async () => {
    const api = makeMemoryApi([makeBook({ id: "1", title: "Il nome della rosa" })], { role: "viewer" });
    await api.createLoan("1", { borrower: "Nome Riservato", contact: "tel", loanDate: "2026-10-01", plannedDays: 14, notes: "privata" });
    renderAs("viewer", "/catalogo/1", api);
    const tabella = await screen.findByRole("table");
    expect(within(tabella).getByText("riservato")).toBeInTheDocument();
    expect(screen.queryByText("Nome Riservato")).not.toBeInTheDocument();
    expect(screen.queryByText("privata")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Registra/ })).not.toBeInTheDocument();
    expect(screen.getByText(/visibili solo agli amministratori/)).toBeInTheDocument();
  });
});

describe("Prestiti — pagina elenco (solo admin)", () => {
  const seed = async () => {
    const api = makeMemoryApi([makeBook({ id: "1", title: "Libro Uno" }), makeBook({ id: "2", title: "Libro Due" })], { role: "admin", today: "2026-10-15" });
    await api.createLoan("1", { borrower: "Zeno Zanetti", contact: "", loanDate: "2026-05-01", plannedDays: 10, notes: "" });
    const l2 = await api.createLoan("2", { borrower: "Ylenia Verdi", contact: "", loanDate: "2026-10-10", plannedDays: 30, notes: "" });
    void l2;
    return api;
  };
  it("mostra i prestiti attivi con lo stato «in ritardo» e filtra per destinatario e stato", async () => {
    const user = userEvent.setup();
    renderAs("admin", "/prestiti", await seed());
    const t = await screen.findByRole("table");
    expect(within(t).getByText("Zeno Zanetti")).toBeInTheDocument();
    expect(within(t).getByText("in ritardo")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Destinatario"), "ylenia");
    await waitFor(() => expect(within(screen.getByRole("table")).queryByText("Zeno Zanetti")).not.toBeInTheDocument());
    expect(within(screen.getByRole("table")).getByText("Ylenia Verdi")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Stato"), "restituiti");
    expect(await screen.findByText("Nessun prestito")).toBeInTheDocument();
  });
  it("il visualizzatore non vede l'elenco né la voce di menu", async () => {
    renderAs("viewer", "/prestiti", await seed());
    expect(await screen.findByText(/riservata agli amministratori/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Prestiti" })).not.toBeInTheDocument();
  });
  it("l'admin vede la voce «Prestiti» nel menu", async () => {
    renderAs("admin", "/dashboard");
    expect(await screen.findByRole("link", { name: "Prestiti" })).toBeInTheDocument();
  });
});
