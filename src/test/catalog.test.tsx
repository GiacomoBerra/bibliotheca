import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { AuthProvider } from "@/lib/auth/AuthProvider";
import { BooksApiProvider } from "@/lib/api/BooksApiContext";
import { routeTree } from "@/routeTree.gen";
import { makeFakeIdentity } from "./fakeIdentity";
import { makeBook, makeMemoryApi } from "./memoryApi";

const seed = () => [
  makeBook({ id: "1", title: "Introduzione alla chimica", authors: ["Rossi, Anna"], isbn: "9780306406157", publisher: "Alfa", publicationYear: "2001", status: "catalogato", subjects: ["Chimica"], updatedAt: "2026-01-03T00:00:00Z" }),
  makeBook({ id: "2", title: "Astronomia per tutti", authors: ["Bianchi, Luca"], publicationYear: "1999", status: "bozza", updatedAt: "2026-01-02T00:00:00Z" }),
  makeBook({ id: "3", title: "Storia del libro", authors: ["Verdi, Gino"], publisher: "Alfa", status: "da revisionare", updatedAt: "2026-01-01T00:00:00Z" }),
];

function renderAt(path: string, api = makeMemoryApi(seed())) {
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }) });
  render(
    <AuthProvider identity={makeFakeIdentity({ session: true }).identity}>
      <BooksApiProvider api={api}>
        <RouterProvider router={router} />
      </BooksApiProvider>
    </AuthProvider>,
  );
  return { router, api };
}

describe("Dashboard", () => {
  it("mostra i conteggi calcolati sui dati reali", async () => {
    renderAt("/dashboard");
    const total = (await screen.findByText("Libri in catalogo")).parentElement!;
    expect(within(total).getByText("3")).toBeInTheDocument();
    expect(within(screen.getByText("Catalogati").parentElement!).getByText("1")).toBeInTheDocument();
    expect(within(screen.getByText("Editori distinti").parentElement!).getByText("1")).toBeInTheDocument();
  });
  it("catalogo vuoto: invito ad aggiungere il primo libro", async () => {
    renderAt("/dashboard", makeMemoryApi([]));
    expect(await screen.findByText(/Il catalogo è vuoto/)).toBeInTheDocument();
  });
  it("errore del server: messaggio e pulsante Riprova", async () => {
    renderAt("/dashboard", makeMemoryApi(seed(), { failWith: "Impossibile contattare il server." }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Impossibile contattare il server");
    expect(screen.getByRole("button", { name: "Riprova" })).toBeInTheDocument();
  });
});

describe("Catalogo: elenco, ricerca, filtri, ordinamento", () => {
  it("mostra lo stato di caricamento e poi le schede", async () => {
    renderAt("/catalogo");
    expect(await screen.findAllByText("Astronomia per tutti")).not.toHaveLength(0);
    expect(screen.getByText("3 risultati")).toBeInTheDocument();
  });
  it("cerca per titolo, autore e ISBN (anche senza trattini)", async () => {
    const user = userEvent.setup();
    renderAt("/catalogo");
    const box = await screen.findByLabelText("Cerca nel catalogo");
    await user.type(box, "  ASTRONOMIA ");
    expect(await screen.findByText("1 risultato")).toBeInTheDocument();
    await user.clear(box);
    await user.type(box, "bianchi");
    expect(await screen.findByText("1 risultato")).toBeInTheDocument();
    await user.clear(box);
    await user.type(box, "978-0-306-40615-7");
    await waitFor(() => expect(screen.getAllByText("Introduzione alla chimica").length).toBeGreaterThan(0));
  });
  it("nessun risultato: messaggio e azzeramento", async () => {
    const user = userEvent.setup();
    renderAt("/catalogo");
    await user.type(await screen.findByLabelText("Cerca nel catalogo"), "zzzz");
    expect(await screen.findByRole("heading", { name: "Nessun risultato" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Azzera ricerca/ }));
    expect(await screen.findByText("3 risultati")).toBeInTheDocument();
  });
  it("filtra per stato", async () => {
    const user = userEvent.setup();
    renderAt("/catalogo");
    await screen.findByText("3 risultati");
    await user.selectOptions(screen.getByLabelText("Stato"), "bozza");
    expect(await screen.findByText("1 risultato")).toBeInTheDocument();
  });
  it("ordina per titolo crescente", async () => {
    const user = userEvent.setup();
    renderAt("/catalogo");
    await screen.findByText("3 risultati");
    await user.selectOptions(screen.getByLabelText("Ordina per"), "titolo");
    await waitFor(() => {
      const rows = screen.getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[0]!.textContent);
      expect(rows).toEqual(["Astronomia per tutti", "Introduzione alla chimica", "Storia del libro"]);
    });
  });
  it("durante il caricamento mostra «Caricamento del catalogo…»", async () => {
    const api = makeMemoryApi(seed());
    api.listBooks = () => new Promise(() => {});
    renderAt("/catalogo", api);
    expect(await screen.findByText("Caricamento del catalogo…")).toBeInTheDocument();
  });
  it("catalogo vuoto", async () => {
    renderAt("/catalogo", makeMemoryApi([]));
    expect(await screen.findByRole("heading", { name: "Il catalogo è vuoto" })).toBeInTheDocument();
  });
  it("errore di rete: messaggio chiaro", async () => {
    renderAt("/catalogo", makeMemoryApi(seed(), { failWith: "Impossibile contattare il server." }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Impossibile contattare il server");
  });
});

describe("Inserimento", () => {
  it("senza titolo mostra l'errore e non salva", async () => {
    const user = userEvent.setup();
    const { api } = renderAt("/catalogo/nuovo");
    await user.click(await screen.findByRole("button", { name: "Salva la scheda" }));
    expect(await screen.findAllByText(/titolo è obbligatorio/)).not.toHaveLength(0);
    expect(api.all()).toHaveLength(3);
  });
  it("ISBN con formato errato blocca; cifra di controllo errata avvisa ma salva", async () => {
    const user = userEvent.setup();
    const { api, router } = renderAt("/catalogo/nuovo");
    await user.type(await screen.findByLabelText("Titolo *"), "Con ISBN dubbio");
    await user.type(screen.getByLabelText("ISBN"), "12ab");
    await user.click(screen.getByRole("button", { name: "Salva la scheda" }));
    expect(await screen.findByText(/10 o 13 cifre/)).toBeInTheDocument();
    expect(api.all()).toHaveLength(3);
    await user.clear(screen.getByLabelText("ISBN"));
    await user.type(screen.getByLabelText("ISBN"), "9780306406158");
    expect(await screen.findByText(/cifra di controllo/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Salva la scheda" }));
    await waitFor(() => expect(api.all()).toHaveLength(4));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/catalogo\/new-/));
  });
  it("record incompleto: basta il titolo (stato bozza)", async () => {
    const user = userEvent.setup();
    const { api } = renderAt("/catalogo/nuovo");
    await user.type(await screen.findByLabelText("Titolo *"), "Solo titolo");
    await user.click(screen.getByRole("button", { name: "Salva la scheda" }));
    await waitFor(() => expect(api.all()[0]).toMatchObject({ title: "Solo titolo", status: "bozza", authors: [], isbn: "" }));
  });
  it("autori e soggetti: una voce per riga", async () => {
    const user = userEvent.setup();
    const { api } = renderAt("/catalogo/nuovo");
    await user.type(await screen.findByLabelText("Titolo *"), "Multi");
    await user.type(screen.getByLabelText(/Autori/), "Rossi, Anna{Enter}Verdi, Luca");
    await user.type(screen.getByLabelText("Soggetto 1"), "Uno");
    await user.click(screen.getByRole("button", { name: "Aggiungi un soggetto" }));
    await user.type(screen.getByLabelText("Soggetto 2"), "Tre");
    await user.click(screen.getByRole("button", { name: "Aggiungi un soggetto" }));
    await user.type(screen.getByLabelText("Soggetto 3"), "Due");
    await user.click(screen.getByRole("button", { name: "Rimuovi il soggetto 2" })); // modifica e rimozione
    await user.click(screen.getByRole("button", { name: "Salva la scheda" }));
    await waitFor(() => expect(api.all()[0]).toMatchObject({ authors: ["Rossi, Anna", "Verdi, Luca"], subjects: ["Uno", "Due"] }));
  });
  it("Dewey: notazione, origine della proposta e note si salvano e si rileggono; l'origine non è un'attestazione", async () => {
    const user = userEvent.setup();
    const { api } = renderAt("/catalogo/nuovo");
    await user.type(await screen.findByLabelText("Titolo *"), "Classificato");
    await user.type(screen.getByLabelText("Classificazione Dewey"), "853.914");
    await user.selectOptions(screen.getByLabelText("Origine della proposta Dewey"), "fonte-esterna");
    await user.type(screen.getByLabelText(/Annotazioni sulla Dewey/), "Da controllare sulle tavole");
    expect(screen.getByText(/non ne attesta la correttezza/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Salva la scheda" }));
    await waitFor(() => expect(api.all()[0]).toMatchObject({ dewey: "853.914", deweySource: "fonte-esterna", deweyNotes: "Da controllare sulle tavole" }));
  });
  it("errore del server in salvataggio: messaggio, nessun falso successo, resta nel modulo", async () => {
    const user = userEvent.setup();
    const api = makeMemoryApi(seed());
    api.createBook = async () => { throw new Error("Impossibile contattare il server. Controlla la connessione e riprova: i dati non sono stati modificati."); };
    const { router } = renderAt("/catalogo/nuovo", api);
    await user.type(await screen.findByLabelText("Titolo *"), "Fallirà");
    await user.click(screen.getByRole("button", { name: "Salva la scheda" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("i dati non sono stati modificati");
    expect(router.state.location.pathname).toBe("/catalogo/nuovo");
  });
});

describe("Dettaglio, modifica e cancellazione", () => {
  it("mostra tutti i campi della scheda", async () => {
    renderAt("/catalogo/1");
    expect(await screen.findByRole("heading", { level: 1, name: "Introduzione alla chimica" })).toBeInTheDocument();
    expect(screen.getByText("Rossi, Anna")).toBeInTheDocument();
    expect(screen.getByText("Vista MARC21")).toBeInTheDocument();
    expect(screen.getByText(/Anteprima illustrativa, non salvata/)).toBeInTheDocument();
  });
  it("scheda inesistente", async () => {
    renderAt("/catalogo/nope");
    expect(await screen.findByRole("heading", { name: "Libro non trovato" })).toBeInTheDocument();
  });
  it("modifica e salva", async () => {
    const user = userEvent.setup();
    const { api, router } = renderAt("/catalogo/2/modifica");
    const title = await screen.findByLabelText("Titolo *");
    expect(title).toHaveValue("Astronomia per tutti");
    await user.clear(title);
    await user.type(title, "Astronomia moderna");
    await user.selectOptions(screen.getByLabelText("Stato della scheda"), "catalogato");
    await user.click(screen.getByRole("button", { name: "Salva le modifiche" }));
    await waitFor(() => expect(api.all().find((b) => b.id === "2")).toMatchObject({ title: "Astronomia moderna", status: "catalogato" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/catalogo/2"));
  });
  it("la modifica conserva i dati MARC non toccati dal modulo", async () => {
    const user = userEvent.setup();
    const marcFields = [{ tag: "650", ind1: " ", ind2: "7", subfields: [{ code: "a", value: "x" }] }, { tag: "650", ind1: " ", ind2: "7", subfields: [{ code: "a", value: "y" }] }];
    const api = makeMemoryApi([makeBook({ id: "m", title: "Con MARC", marcFields, marcLeader: "00000nam a2200000 a 4500" })]);
    renderAt("/catalogo/m/modifica", api);
    await user.type(await screen.findByLabelText("Note"), "nota");
    await user.click(screen.getByRole("button", { name: "Salva le modifiche" }));
    await waitFor(() => expect(api.all()[0]).toMatchObject({ notes: "nota", marcFields, marcLeader: "00000nam a2200000 a 4500" }));
  });
  it("cancellazione: chiede conferma, Annulla non cancella, Conferma cancella", async () => {
    const user = userEvent.setup();
    const { api, router } = renderAt("/catalogo/3");
    await user.click(await screen.findByRole("button", { name: /Cancella/ }));
    const dlg = await screen.findByRole("dialog");
    expect(dlg).toHaveTextContent("Storia del libro");
    await user.click(within(dlg).getByRole("button", { name: "Annulla" }));
    expect(api.all()).toHaveLength(3);
    await user.click(screen.getByRole("button", { name: /Cancella/ }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancella definitivamente" }));
    await waitFor(() => expect(api.all()).toHaveLength(2));
    await waitFor(() => expect(router.state.location.pathname).toBe("/catalogo"));
  });
  it("cancellazione fallita: errore visibile, la scheda resta", async () => {
    const user = userEvent.setup();
    const api = makeMemoryApi(seed());
    api.deleteBook = async () => { throw new Error("Impossibile contattare il server."); };
    renderAt("/catalogo/3", api);
    await user.click(await screen.findByRole("button", { name: /Cancella/ }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancella definitivamente" }));
    expect(await screen.findByText("Impossibile contattare il server.")).toBeInTheDocument();
    expect(api.all()).toHaveLength(3);
  });
  it("vista MARC con dati salvati: ordine, ripetizioni e indicatori", async () => {
    const marcFields = [{ tag: "245", ind1: "1", ind2: "0", subfields: [{ code: "a", value: "T" }] }, { tag: "650", ind1: " ", ind2: "7", subfields: [{ code: "a", value: "uno" }] }, { tag: "650", ind1: " ", ind2: "7", subfields: [{ code: "a", value: "due" }] }];
    renderAt("/catalogo/m", makeMemoryApi([makeBook({ id: "m", title: "T", marcFields })]));
    const pre = await screen.findByLabelText("Record MARC21 in forma testuale");
    expect(pre.textContent).toBe("245 10 $a T\n650 #7 $a uno\n650 #7 $a due");
  });
});

describe("Esportazione", () => {
  it("la pagina Backup espone esportazione JSON e CSV", async () => {
    renderAt("/impostazioni");
    expect(await screen.findByRole("button", { name: /Scarica il backup JSON/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Scarica il CSV/ })).toBeEnabled();
  });
});
