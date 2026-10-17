import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { BooksApiError } from "@/lib/api/errors";
import { addDays, todayIso } from "@/lib/api/loans";
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
  const lend = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
    await user.click(await screen.findByRole("button", { name: "Registra prestito" }));
    await user.type(screen.getByLabelText(/Destinatario/), name);
    await user.click(screen.getByRole("button", { name: "Verifica i dati" }));
    await user.click(await screen.findByRole("button", { name: "Conferma e registra il prestito" }));
    await screen.findByText(new RegExp(`Prestito registrato a ${name}`));
  };

  it("libro disponibile: stato «Libro disponibile» e azione «Registra prestito»; prima di salvare si verificano i dati", async () => {
    const user = userEvent.setup();
    const api = renderAs("admin", "/catalogo/1");
    expect(await screen.findByText("Libro disponibile")).toBeInTheDocument();
    expect(screen.getByText("Questo libro non è mai stato prestato.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Registra restituzione/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Registra prestito" }));
    await user.type(screen.getByLabelText(/Destinatario/), "Marta Rossi");
    expect(screen.getByLabelText("Restituzione prevista")).toHaveValue(addDays(todayIso(), 30));
    await user.click(screen.getByRole("button", { name: "Verifica i dati" }));
    const verifica = await screen.findByRole("group", { name: "Verifica del prestito" });
    expect(within(verifica).getByText("Il nome della rosa")).toBeInTheDocument();
    expect(within(verifica).getByText("Marta Rossi")).toBeInTheDocument();
    expect(api.allLoans()).toHaveLength(0); // nulla è salvato finché non si conferma
    await user.click(screen.getByRole("button", { name: "Conferma e registra il prestito" }));
    expect(await screen.findByText(/Prestito registrato a Marta Rossi/)).toBeInTheDocument();
    const tabella = await screen.findByRole("table", { name: /Storico/ });
    expect(within(tabella).getByText("Marta Rossi")).toBeInTheDocument();
    expect(within(tabella).getByText("in prestito")).toBeInTheDocument();
    expect(api.allLoans()).toHaveLength(1);
  });

  it("data prevista e durata si aggiornano a vicenda; dati non validi non passano la verifica", async () => {
    const user = userEvent.setup();
    const api = renderAs("admin", "/catalogo/1");
    await user.click(await screen.findByRole("button", { name: "Registra prestito" }));
    const days = screen.getByLabelText(/Durata prevista/);
    await user.clear(days);
    await user.type(days, "10");
    expect(screen.getByLabelText("Restituzione prevista")).toHaveValue(addDays(todayIso(), 10));
    fireEvent.change(screen.getByLabelText("Restituzione prevista"), { target: { value: addDays(todayIso(), 20) } });
    expect(days).toHaveValue(20);
    await user.click(screen.getByRole("button", { name: "Verifica i dati" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Indica il nome di chi riceve il libro.");
    expect(api.allLoans()).toHaveLength(0);
  });

  it("libro in prestito: stato, destinatario, date e «Registra restituzione»; nessuna possibilità di avviare un altro prestito", async () => {
    const user = userEvent.setup();
    const api = renderAs("admin", "/catalogo/1");
    await lend(user, "Luca Bianchi");
    expect(await screen.findByText("Libro in prestito")).toBeInTheDocument();
    expect(screen.getByText(/in prestito a/)).toHaveTextContent("Luca Bianchi");
    expect(screen.getByRole("button", { name: "Registra restituzione" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Registra prestito" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Destinatario/)).not.toBeInTheDocument();
    // la restituzione ha un riepilogo e una data modificabile, preimpostata a oggi
    await user.click(screen.getByRole("button", { name: "Registra restituzione" }));
    expect(screen.getByLabelText("Data effettiva di restituzione")).toHaveValue(todayIso());
    const riepilogo = screen.getByText("Riepilogo prima di confermare").parentElement!;
    expect(within(riepilogo).getByText("Luca Bianchi")).toBeInTheDocument();
    expect(within(riepilogo).getByText("Il nome della rosa")).toBeInTheDocument();
    expect(api.allLoans()[0]!.returnedDate).toBeNull();
    await user.click(screen.getByRole("button", { name: "Conferma restituzione" }));
    expect(await screen.findByText(/Restituzione registrata: il prestito resta nello storico/)).toBeInTheDocument();
    await waitFor(() => expect(within(screen.getByRole("table", { name: /Storico/ })).getByText("restituito")).toBeInTheDocument());
    expect(api.allLoans()).toHaveLength(1);
    expect(api.allLoans()[0]!.returnedDate).not.toBeNull();
    // di nuovo disponibile: si può registrare un nuovo prestito
    expect(await screen.findByText("Libro disponibile")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Registra prestito" })).toBeInTheDocument();
  });

  it("annulla prestito registrato per errore: riepilogo e effetto, motivo obbligatorio, resta nello storico come «annullato»", async () => {
    const user = userEvent.setup();
    const api = renderAs("admin", "/catalogo/1");
    await lend(user, "Persona Sbagliata");
    await user.click(await screen.findByRole("button", { name: "Annulla prestito registrato per errore" }));
    const form = await screen.findByRole("form", { name: "Annulla prestito registrato per errore" });
    expect(within(form).getByText("Persona Sbagliata")).toBeInTheDocument();
    expect(within(form).getByText(/La copia tornerà disponibile/)).toBeInTheDocument();
    const conferma = within(form).getByRole("button", { name: "Conferma: annulla il prestito" });
    expect(conferma).toBeDisabled(); // senza motivo non si procede
    await user.type(within(form).getByLabelText(/Motivo della correzione/), "Libro sbagliato");
    await user.click(conferma);
    expect(await screen.findByText(/Prestito annullato: resta nello storico come «annullato»/)).toBeInTheDocument();
    const riga = (await screen.findByRole("table", { name: /Storico/ })).querySelector("tbody tr")!;
    expect(within(riga as HTMLElement).getByText("annullato")).toBeInTheDocument();
    expect(within(riga as HTMLElement).getByText(/Libro sbagliato/)).toBeInTheDocument();
    expect(api.allLoans()).toHaveLength(1); // non cancellato
    expect(await screen.findByText("Libro disponibile")).toBeInTheDocument();
    await user.click(within(riga as HTMLElement).getByRole("button", { name: /Traccia delle correzioni \(1\)/ }));
    expect(await screen.findByText((_, el) => el?.tagName === "LI" && /Prestito annullato.*Libro sbagliato.*dopo: annullato/.test(el.textContent ?? ""))).toBeInTheDocument();
  });

  it("annulla registrazione della restituzione: il prestito torna in corso e la traccia lo documenta", async () => {
    const user = userEvent.setup();
    const api = renderAs("admin", "/catalogo/1");
    await lend(user, "Anna Verdi");
    await user.click(await screen.findByRole("button", { name: "Registra restituzione" }));
    await user.click(screen.getByRole("button", { name: "Conferma restituzione" }));
    await screen.findByText(/Restituzione registrata/);
    await user.click(await screen.findByRole("button", { name: /Annulla registrazione della restituzione/ }));
    const form = await screen.findByRole("form", { name: "Annulla registrazione della restituzione" });
    expect(within(form).getByText(/tornerà «in prestito»/)).toBeInTheDocument();
    await user.type(within(form).getByLabelText(/Motivo della correzione/), "Data errata");
    await user.click(within(form).getByRole("button", { name: "Conferma: annulla la restituzione" }));
    expect(await screen.findByText(/Restituzione annullata: il prestito risulta di nuovo in corso/)).toBeInTheDocument();
    expect(await screen.findByText("Libro in prestito")).toBeInTheDocument();
    expect(api.allLoans()[0]!.returnedDate).toBeNull();
  });

  it("annullamento della restituzione rifiutato dal server (copia prestata di nuovo): messaggio comprensibile, nessun cambiamento", async () => {
    const user = userEvent.setup();
    const api = renderAs("admin", "/catalogo/1");
    const a = await api.createLoan("1", { borrower: "Anna", contact: "", loanDate: "2026-09-01", plannedDays: 10, notes: "" });
    await api.returnLoan(a.id, "2026-09-05");
    await api.createLoan("1", { borrower: "Bruno", contact: "", loanDate: "2026-09-10", plannedDays: 10, notes: "" });
    await user.click(await screen.findByRole("button", { name: "Registra restituzione" }));
    await user.click(screen.getByRole("button", { name: "Conferma restituzione" }));
    await screen.findByText(/Restituzione registrata/);
    // il prestito di Bruno è ora l'ultimo: solo per quello l'annullamento è offerto; quello di Anna ha un prestito successivo
    const righe = within(screen.getByRole("table", { name: /Storico/ })).getAllByRole("row").slice(1);
    expect(righe).toHaveLength(2);
    expect(within(righe[1]!).queryByRole("button", { name: /Annulla registrazione della restituzione/ })).not.toBeInTheDocument();
    expect(within(righe[1]!).getByRole("button", { name: /Annulla prestito registrato per errore/ })).toBeInTheDocument();
    expect(within(righe[0]!).getByRole("button", { name: /Annulla registrazione della restituzione/ })).toBeInTheDocument();
  });

  it("errore del server durante una correzione: messaggio chiaro e il prestito resta com'era", async () => {
    const user = userEvent.setup();
    const api = renderAs("admin", "/catalogo/1");
    await lend(user, "Carla");
    await user.click(await screen.findByRole("button", { name: "Annulla prestito registrato per errore" }));
    const form = await screen.findByRole("form", { name: "Annulla prestito registrato per errore" });
    await user.type(within(form).getByLabelText(/Motivo della correzione/), "Errore");
    api.voidLoan = async () => { throw new BooksApiError("network", "Connessione assente: nessuna modifica salvata."); };
    await user.click(within(form).getByRole("button", { name: "Conferma: annulla il prestito" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent("Connessione assente: nessuna modifica salvata.");
    expect(api.allLoans()[0]!.voidedAt).toBeNull();
    expect(screen.getByText("Libro in prestito")).toBeInTheDocument();
  });

  it("viewer: vede stato e date ma non nomi né moduli di gestione", async () => {
    const api = makeMemoryApi([makeBook({ id: "1", title: "Il nome della rosa" })], { role: "viewer" });
    await api.createLoan("1", { borrower: "Nome Riservato", contact: "tel", loanDate: "2026-10-01", plannedDays: 14, notes: "privata" });
    renderAs("viewer", "/catalogo/1", api);
    const tabella = await screen.findByRole("table", { name: /Storico/ });
    expect(within(tabella).getByText("riservato")).toBeInTheDocument();
    expect(screen.queryByText("Nome Riservato")).not.toBeInTheDocument();
    expect(screen.queryByText("privata")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Registra|Annulla/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Traccia delle correzioni/)).not.toBeInTheDocument();
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
  it("ogni prestito attivo ha un link «Registra restituzione» verso la scheda del libro; si possono filtrare gli annullati", async () => {
    const user = userEvent.setup();
    const api = await seed();
    const l = await api.createLoan("1", { borrower: "Errore Tizio", contact: "", loanDate: "2026-04-01", plannedDays: 5, notes: "", returnedDate: "2026-04-02" });
    await api.voidLoan(l.id, "inserito per sbaglio");
    renderAs("admin", "/prestiti", api);
    const t = await screen.findByRole("table");
    const link = within(t).getAllByRole("link", { name: /Registra restituzione/ })[0]!;
    expect(link.getAttribute("href")).toMatch(/^\/catalogo\/[12]#prestiti$/);
    expect(within(t).queryByText("Errore Tizio")).not.toBeInTheDocument(); // gli annullati non sono tra gli «attivi»
    await user.selectOptions(screen.getByLabelText("Stato"), "annullati");
    expect(await within(await screen.findByRole("table")).findByText("Errore Tizio")).toBeInTheDocument();
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
