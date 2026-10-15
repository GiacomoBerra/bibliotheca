import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/lib/auth/AuthProvider";
import { BooksApiProvider } from "@/lib/api/BooksApiContext";
import { BooksApiError } from "@/lib/api/errors";
import { routeTree } from "@/routeTree.gen";
import type { LookupResponse, SourceRecord } from "@/lib/sources/types";
import { makeFakeIdentity } from "./fakeIdentity";
import { makeBook, makeMemoryApi } from "./memoryApi";

// ---- finto SpeechRecognition del browser (nessun microfono nei test) ----
class FakeRecognition {
  static instances: FakeRecognition[] = [];
  lang = ""; continuous = true; interimResults = false; maxAlternatives = 0; started = false; aborted = false;
  onresult: ((e: unknown) => void) | null = null; onerror: ((e: { error: string }) => void) | null = null; onend: (() => void) | null = null;
  constructor() { FakeRecognition.instances.push(this); }
  start() { this.started = true; }
  stop() { this.onend?.(); }
  abort() { this.aborted = true; }
  say(text: string) { this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal: true })] }); this.onend?.(); }
  fail(code: string) { this.onerror?.({ error: code }); this.onend?.(); }
}
const last = () => FakeRecognition.instances[FakeRecognition.instances.length - 1]!;
const say = (text: string) => act(() => { last().say(text); });
const fail = (code: string) => act(() => { last().fail(code); });
beforeEach(() => { FakeRecognition.instances = []; (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition = FakeRecognition; });
afterEach(() => { delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition; });

// ---- risultati simulati (dati di prova, non bibliografici reali) ----
const R = (o: Partial<SourceRecord>): SourceRecord => ({ source: "googlebooks", sourceLabel: "Google Books", externalId: "g1", sourceUrl: "https://books.example/g1", granularity: "edizione", title: "Libro di prova", authors: ["Anna Rossi"], subjects: ["Prova"], ...o });
const RESULT: LookupResponse = {
  cached: false,
  sources: [{ id: "openlibrary", label: "Open Library", status: "ok", count: 1 }, { id: "googlebooks", label: "Google Books", status: "ok", count: 1 }],
  groups: [
    { id: "g1", match: "probabile", reason: "Coincidono: titolo, autore, anno, editore.", incomplete: false, missing: [], records: [
      R({ isbn13: "9780306406157", publisher: "Alfa", publicationDate: "1980-05-01", language: "it", pages: 320, description: "Una descrizione." }),
      R({ source: "openlibrary", sourceLabel: "Open Library", externalId: "o1", sourceUrl: "https://openlibrary.org/x", publisher: "Alfa", publicationPlace: "Milano", publicationDate: "1980" }),
    ] },
    { id: "g2", match: "simile", reason: "Non coincidono: anno.", incomplete: true, missing: ["editore", "ISBN"], records: [R({ externalId: "g2", sourceUrl: "https://books.example/g2", publicationDate: "2005" })] },
  ],
};

function renderAt(path: string, opts: { books?: ReturnType<typeof makeBook>[]; lookup?: ReturnType<typeof vi.fn>; roles?: string[] } = {}) {
  const lookup = opts.lookup ?? vi.fn(async () => RESULT);
  const api = makeMemoryApi(opts.books ?? [], { lookup: lookup as never });
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }) });
  render(
    <AuthProvider identity={makeFakeIdentity({ session: true, roles: opts.roles ?? ["admin"] }).identity}>
      <BooksApiProvider api={api}>
        <RouterProvider router={router} />
      </BooksApiProvider>
    </AuthProvider>,
  );
  return { api, lookup };
}
const panel = async () => within(await screen.findByRole("region", { name: "Cerca libro con la voce" }, { timeout: 3000 }).catch(async () => (await screen.findByText("Cerca libro con la voce")).closest("section")!) as HTMLElement);

describe("Cerca libro con la voce: dettatura", () => {
  it("il pulsante è ben visibile; l'ascolto parte solo al clic, è segnalato, si può interrompere, la lingua è quella scelta", async () => {
    const user = userEvent.setup();
    renderAt("/catalogo/nuovo");
    expect(await screen.findByRole("heading", { name: "Cerca libro con la voce" })).toBeInTheDocument();
    expect(FakeRecognition.instances).toHaveLength(0); // nessun ascolto in background
    await user.selectOptions(screen.getByLabelText("Lingua della dettatura"), "de");
    await user.click(screen.getByRole("button", { name: "Parla" }));
    expect(last()).toMatchObject({ started: true, lang: "de-DE", continuous: false, interimResults: true });
    expect(screen.getByText(/Ascolto attivo: parla ora/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Interrompi la registrazione" }));
    await waitFor(() => expect(screen.queryByText(/Ascolto attivo: parla ora/)).not.toBeInTheDocument());
  });
  it("la trascrizione compare nel testo modificabile e nei campi; la ricerca NON parte da sola", async () => {
    const user = userEvent.setup();
    const { lookup } = renderAt("/catalogo/nuovo");
    await user.click(await screen.findByRole("button", { name: "Parla" }));
    await say("Voglio catalogare Il nome della rosa di Umberto Eco, pubblicato da Bompiani nel 1980");
    await waitFor(() => expect(screen.getByLabelText("Titolo da cercare")).toHaveValue("Il nome della rosa"));
    expect(screen.getByLabelText("Richiesta (puoi correggerla)")).toHaveValue("Voglio catalogare Il nome della rosa di Umberto Eco, pubblicato da Bompiani nel 1980");
    expect(screen.getByLabelText("Autore da cercare")).toHaveValue("Umberto Eco");
    expect(screen.getByLabelText("Editore da cercare")).toHaveValue("Bompiani");
    expect(screen.getByLabelText("Anno da cercare")).toHaveValue("1980");
    expect(lookup).not.toHaveBeenCalled();
    // correzione manuale, poi conferma esplicita
    await user.clear(screen.getByLabelText("Titolo da cercare"));
    await user.type(screen.getByLabelText("Titolo da cercare"), "Il nome della rosa (edizione illustrata)");
    await user.click(screen.getByRole("button", { name: /Cerca nelle fonti bibliografiche/ }));
    await waitFor(() => expect(lookup).toHaveBeenCalledTimes(1));
    expect(lookup.mock.calls[0]![0]).toEqual({ title: "Il nome della rosa (edizione illustrata)", author: "Umberto Eco", publisher: "Bompiani", year: "1980" });
  });
  it("«Cerca subito al termine della dettatura» avvia la ricerca soltanto se l'utente l'ha attivato", async () => {
    const user = userEvent.setup();
    const { lookup } = renderAt("/catalogo/nuovo");
    await user.click(await screen.findByLabelText("Cerca subito al termine della dettatura"));
    await user.click(screen.getByRole("button", { name: "Parla" }));
    await say("cerca ISBN 978 0 306 40615 7");
    await waitFor(() => expect(lookup).toHaveBeenCalledTimes(1));
    expect(lookup.mock.calls[0]![0]).toEqual({ isbn: "9780306406157" });
  });
  it("permesso negato / nessun microfono: messaggio chiaro e il lavoro manuale resta possibile", async () => {
    const user = userEvent.setup();
    const { lookup } = renderAt("/catalogo/nuovo");
    await user.click(await screen.findByRole("button", { name: "Parla" }));
    await fail("not-allowed");
    expect(await screen.findByText(/permesso di usare il microfono è stato negato/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("Titolo da cercare"), "Libro di prova");
    await user.click(screen.getByRole("button", { name: /Cerca nelle fonti/ }));
    await waitFor(() => expect(lookup).toHaveBeenCalled());
  });
  it("browser senza riconoscimento vocale: messaggio chiaro, niente pulsante Parla, ricerca digitata funzionante", async () => {
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    const user = userEvent.setup();
    const { lookup } = renderAt("/catalogo/nuovo");
    expect(await screen.findByText(/non supporta il riconoscimento vocale/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Parla" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Detta:/ })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Richiesta (puoi correggerla)"), "Libro di prova di Anna Rossi");
    await user.click(screen.getByRole("button", { name: "Interpreta il testo nei campi" }));
    expect(screen.getByLabelText("Autore da cercare")).toHaveValue("Anna Rossi");
    await user.click(screen.getByRole("button", { name: /Cerca nelle fonti/ }));
    await waitFor(() => expect(lookup).toHaveBeenCalledTimes(1));
  });
  it("informativa sulla privacy sempre visibile: audio non conservato, possibile invio a un servizio remoto del browser", async () => {
    renderAt("/catalogo/nuovo");
    expect(await screen.findByText(/inviano l'audio a un servizio remoto/)).toBeInTheDocument();
    expect(screen.getByText(/non conserva alcun file audio/)).toBeInTheDocument();
  });
  it("dettatura nei singoli campi: accoda al testo; per gli autori va a capo", async () => {
    const user = userEvent.setup();
    renderAt("/catalogo/nuovo");
    await user.type(await screen.findByLabelText("Titolo *"), "Libro");
    await user.click(screen.getByRole("button", { name: "Detta: Titolo" }));
    await say("di prova");
    await waitFor(() => expect(screen.getByLabelText("Titolo *")).toHaveValue("Libro di prova"));
    await user.click(screen.getByRole("button", { name: /^Detta: Autori/ }));
    await say("Rossi, Anna");
    await user.click(screen.getByRole("button", { name: /^Detta: Autori/ }));
    await say("Bianchi, Luca");
    await waitFor(() => expect((screen.getByLabelText(/^Autori/) as HTMLTextAreaElement).value).toBe("Rossi, Anna\nBianchi, Luca"));
  });
});

describe("Risultati, anteprima e importazione", () => {
  async function searchBy(user: ReturnType<typeof userEvent.setup>, title = "Libro di prova") {
    await user.type(await screen.findByLabelText("Titolo da cercare"), title);
    await user.click(screen.getByRole("button", { name: /Cerca nelle fonti/ }));
    return screen.findByRole("list", { name: "Risultati" });
  }
  it("mostra schede confrontabili con tipo di corrispondenza, dati incompleti, fonti con collegamento, stato delle fonti", async () => {
    const user = userEvent.setup();
    renderAt("/catalogo/nuovo");
    const list = await searchBy(user);
    const cards = within(list).getAllByRole("listitem");
    expect(cards).toHaveLength(2);
    expect(within(cards[0]!).getByText("Corrispondenza probabile")).toBeInTheDocument();
    expect(within(cards[0]!).getByText(/ISBN-13/)).toBeInTheDocument();
    expect(within(cards[0]!).getByText("9780306406157")).toBeInTheDocument();
    expect(within(cards[0]!).getByRole("link", { name: /Open Library/ })).toHaveAttribute("href", "https://openlibrary.org/x");
    expect(within(cards[0]!).getByRole("link", { name: /Google Books/ })).toHaveAttribute("rel", "noopener noreferrer");
    expect(within(cards[1]!).getByText("Risultato simile")).toBeInTheDocument();
    expect(within(cards[1]!).getByText(/Dati incompleti: mancano editore, ISBN/)).toBeInTheDocument();
    const status = screen.getByRole("list", { name: "Stato delle fonti" });
    expect(within(status).getByText(/Open Library/)).toBeInTheDocument();
    expect(screen.getAllByText("Libro di prova", { selector: "h3" })).toHaveLength(2);
  });
  it("stati: caricamento, nessun risultato, errore del server con Riprova, fonte non disponibile", async () => {
    const user = userEvent.setup();
    let resolve!: (v: LookupResponse) => void;
    const lookup = vi.fn(() => new Promise<LookupResponse>((r) => { resolve = r; }));
    renderAt("/catalogo/nuovo", { lookup });
    await user.type(await screen.findByLabelText("Titolo da cercare"), "zzz");
    await user.click(screen.getByRole("button", { name: /Cerca nelle fonti/ }));
    expect(await screen.findByText("Ricerca in corso nelle fonti…")).toBeInTheDocument();
    resolve({ cached: false, groups: [], sources: [{ id: "openlibrary", label: "Open Library", status: "timeout", count: 0, message: "La fonte non ha risposto in tempo." }, { id: "googlebooks", label: "Google Books", status: "ok", count: 0 }] });
    expect(await screen.findByText(/Nessun risultato\./)).toBeInTheDocument();
    expect(screen.getByText(/non disponibile — La fonte non ha risposto in tempo/)).toBeInTheDocument();
  });
  it("errore (es. limite di ricerche raggiunto): messaggio del server e pulsante Riprova", async () => {
    const user = userEvent.setup();
    const lookup = vi.fn(async () => { throw new BooksApiError("unavailable", "Troppe ricerche in poco tempo. Attendi un minuto e riprova."); });
    renderAt("/catalogo/nuovo", { lookup: lookup as never });
    await user.type(await screen.findByLabelText("Titolo da cercare"), "abc");
    await user.click(screen.getByRole("button", { name: /Cerca nelle fonti/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Troppe ricerche in poco tempo");
    expect(screen.getByRole("button", { name: "Riprova" })).toBeInTheDocument();
  });
  it("selezione → anteprima → «Usa questi dati»: compila i campi, mostra la provenienza, segnala i campi senza dati; nulla è salvato finché non si preme Salva", async () => {
    const user = userEvent.setup();
    const { api } = renderAt("/catalogo/nuovo");
    const list = await searchBy(user);
    await user.click(within(within(list).getAllByRole("listitem")[0]!).getByRole("button", { name: /Anteprima e importazione/ }));
    const preview = await screen.findByRole("region", { name: "Anteprima dell'importazione" });
    expect(within(preview).getByText("320 pagine")).toBeInTheDocument();
    expect(within(preview).getAllByText(/Fonte: Google Books, Open Library/).length).toBeGreaterThan(0);
    await user.click(within(preview).getByRole("button", { name: "Usa questi dati" }));
    expect(screen.getByLabelText("Titolo *")).toHaveValue("Libro di prova");
    expect(screen.getByLabelText("Editore")).toHaveValue("Alfa");
    expect(screen.getByLabelText("Luogo di pubblicazione")).toHaveValue("Milano");
    expect(screen.getByLabelText("ISBN")).toHaveValue("9780306406157");
    expect((screen.getByLabelText(/^Autori/) as HTMLTextAreaElement).value).toBe("Anna Rossi");
    expect(screen.getByLabelText("Descrizione fisica")).toHaveValue("320 pagine");
    expect((screen.getByLabelText(/^Soggetti/) as HTMLTextAreaElement).value).toBe(""); // suggeriti: non importati di default
    expect(screen.getByLabelText(/^Note/)).toHaveValue("");
    expect(screen.getAllByText(/Importato da/).length).toBeGreaterThan(3);
    expect(api.all()).toHaveLength(0); // l'importazione non tocca il catalogo
    await user.click(screen.getByRole("button", { name: "Salva la scheda" }));
    await waitFor(() => expect(api.all()).toHaveLength(1));
    expect(api.all()[0]).toMatchObject({ title: "Libro di prova", publisher: "Alfa", isbn: "9780306406157", publicationPlace: "Milano" });
  });
  it("campi per cui nessuna fonte ha dati: anteprima «Nessun dato trovato» e segnalazione dopo l'importazione", async () => {
    const user = userEvent.setup();
    renderAt("/catalogo/nuovo");
    const list = await searchBy(user);
    await user.click(within(within(list).getAllByRole("listitem")[1]!).getByRole("button", { name: /Anteprima e importazione/ }));
    const preview = await screen.findByRole("region", { name: "Anteprima dell'importazione" });
    expect(within(preview).getAllByText("Nessun dato trovato").length).toBeGreaterThan(3);
    await user.click(within(preview).getByRole("button", { name: "Usa questi dati" }));
    expect(screen.getByText(/Nessun dato trovato per: ISBN, Editore/)).toBeInTheDocument();
  });
  it("se le fonti non concordano si sceglie il valore; i campi compilati a mano non vengono sovrascritti senza spuntare la riga", async () => {
    const user = userEvent.setup();
    const split: LookupResponse = { ...RESULT, groups: [{ ...RESULT.groups[0]!, records: [R({ publisher: "Alfa", publicationDate: "1980" }), R({ source: "openlibrary", sourceLabel: "Open Library", externalId: "o1", publisher: "Alfa & C.", publicationDate: "1981" })] }] };
    renderAt("/catalogo/nuovo", { lookup: vi.fn(async () => split) });
    await user.type(await screen.findByLabelText("Editore"), "Il mio editore");
    const list = await searchBy(user);
    await user.click(within(list).getByRole("button", { name: /Anteprima e importazione/ }));
    const preview = await screen.findByRole("region", { name: "Anteprima dell'importazione" });
    expect(within(preview).getByText(/Il campo è già compilato/)).toBeInTheDocument();
    expect(within(preview).getByLabelText("Usa editore")).not.toBeChecked();
    await user.selectOptions(within(preview).getByLabelText("Valore per anno di pubblicazione"), "1");
    expect(within(preview).getAllByText(/le fonti non concordano/).length).toBeGreaterThan(0);
    await user.click(within(preview).getByRole("button", { name: "Usa questi dati" }));
    expect(screen.getByLabelText("Editore")).toHaveValue("Il mio editore");
    expect(screen.getByLabelText("Anno di pubblicazione")).toHaveValue("1981");
  });
  it("sostituzione esplicita di un campo compilato e annullamento dell'importazione", async () => {
    const user = userEvent.setup();
    renderAt("/catalogo/nuovo");
    await user.type(await screen.findByLabelText("Editore"), "Il mio editore");
    const list = await searchBy(user);
    await user.click(within(within(list).getAllByRole("listitem")[0]!).getByRole("button", { name: /Anteprima e importazione/ }));
    const preview = await screen.findByRole("region", { name: "Anteprima dell'importazione" });
    await user.click(within(preview).getByLabelText("Usa editore"));
    await user.click(within(preview).getByRole("button", { name: "Usa questi dati" }));
    expect(screen.getByLabelText("Editore")).toHaveValue("Alfa");
    await user.click(screen.getByRole("button", { name: /Annulla l'importazione/ }));
    expect(screen.getByLabelText("Editore")).toHaveValue("Il mio editore");
    expect(screen.getByLabelText("Titolo *")).toHaveValue("");
    expect(screen.queryByText(/Importato da/)).not.toBeInTheDocument();
  });
  it("modifica di una scheda con record MARC21: l'importazione e il salvataggio conservano struttura, ordine e ripetizioni", async () => {
    const user = userEvent.setup();
    const marc = [
      { tag: "650", ind1: " ", ind2: "7", subfields: [{ code: "a", value: "Uno" }, { code: "a", value: "Ripetuto" }, { code: "2", value: "x" }] },
      { tag: "245", ind1: "1", ind2: "0", subfields: [{ code: "a", value: "Titolo MARC" }] },
      { tag: "650", ind1: " ", ind2: "7", subfields: [{ code: "a", value: "Due" }] },
    ];
    const { api } = renderAt("/catalogo/m1/modifica", { books: [makeBook({ id: "m1", title: "Vecchio titolo", marcLeader: "00000nam a2200000 a 4500", marcFields: marc, dewey: "002.09", shelfMark: "A1", status: "catalogato" })] });
    await user.type(await screen.findByLabelText("Titolo da cercare"), "Libro di prova");
    await user.click(screen.getByRole("button", { name: /Cerca nelle fonti/ }));
    const list = await screen.findByRole("list", { name: "Risultati" });
    await user.click(within(within(list).getAllByRole("listitem")[0]!).getByRole("button", { name: /Anteprima e importazione/ }));
    const preview = await screen.findByRole("region", { name: "Anteprima dell'importazione" });
    await user.click(within(preview).getByLabelText("Usa titolo")); // sostituzione esplicita
    await user.click(within(preview).getByRole("button", { name: "Usa questi dati" }));
    await user.click(screen.getByRole("button", { name: "Salva le modifiche" }));
    await waitFor(() => expect(api.all()[0]!.title).toBe("Libro di prova"));
    expect(api.all()[0]).toMatchObject({ marcLeader: "00000nam a2200000 a 4500", marcFields: marc, dewey: "002.09", shelfMark: "A1", status: "catalogato", publisher: "Alfa" });
  });
  it("percorso completo: detto → cercato → scelto → importato → salvato nel catalogo", async () => {
    const user = userEvent.setup();
    const { api, lookup } = renderAt("/catalogo/nuovo");
    await user.click(await screen.findByRole("button", { name: "Parla" }));
    await say("Voglio catalogare Libro di prova di Anna Rossi, pubblicato da Alfa nel 1980");
    await waitFor(() => expect(screen.getByLabelText("Titolo da cercare")).toHaveValue("Libro di prova"));
    await user.click(screen.getByRole("button", { name: /Cerca nelle fonti/ }));
    const list = await screen.findByRole("list", { name: "Risultati" });
    expect(lookup.mock.calls[0]![0]).toEqual({ title: "Libro di prova", author: "Anna Rossi", publisher: "Alfa", year: "1980" });
    await user.click(within(within(list).getAllByRole("listitem")[0]!).getByRole("button", { name: /Anteprima/ }));
    await user.click(within(await screen.findByRole("region", { name: "Anteprima dell'importazione" })).getByRole("button", { name: "Usa questi dati" }));
    await user.click(screen.getByRole("button", { name: "Salva la scheda" }));
    await waitFor(() => expect(api.all()).toHaveLength(1));
    expect(api.all()[0]).toMatchObject({ title: "Libro di prova", authors: ["Anna Rossi"], publisher: "Alfa", publicationYear: "1980", isbn: "9780306406157" });
  });
});

describe("Visualizzatore", () => {
  it("non vede la ricerca né il modulo e non effettua alcuna chiamata alle fonti", async () => {
    const lookup = vi.fn(async () => RESULT);
    renderAt("/catalogo/nuovo", { roles: ["viewer"], lookup });
    expect(await screen.findByText(/riservata agli amministratori/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Cerca libro con la voce" })).not.toBeInTheDocument();
    expect(lookup).not.toHaveBeenCalled();
    expect(FakeRecognition.instances).toHaveLength(0);
  });
});
