import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/lib/auth/AuthProvider";
import { BooksApiProvider } from "@/lib/api/BooksApiContext";
import { routeTree } from "@/routeTree.gen";
import { booksToJson } from "@/lib/export";
import { makeFakeIdentity } from "./fakeIdentity";
import { makeBook, makeMemoryApi } from "./memoryApi";

function renderSettings(books = [makeBook({ id: "11111111-1111-4111-8111-111111111111", title: "Esistente", authors: ["Rossi, Anna"] })], roles = ["admin"]) {
  const api = makeMemoryApi(books);
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ["/impostazioni"] }) });
  render(
    <AuthProvider identity={makeFakeIdentity({ session: true, roles }).identity}>
      <BooksApiProvider api={api}><RouterProvider router={router} /></BooksApiProvider>
    </AuthProvider>,
  );
  return api;
}
vi.mock("@/lib/export", async (orig) => ({ ...(await orig<typeof import("@/lib/export")>()), downloadText: vi.fn() }));
const file = (text: string) => new File([text], "backup.json", { type: "application/json" });

describe("Ripristino da backup (interfaccia)", () => {
  it("anteprima con conflitti, nessun cambiamento finché non si conferma; poi esito con conteggi; nulla viene cancellato", async () => {
    const user = userEvent.setup();
    const api = renderSettings();
    const backup = booksToJson([
      makeBook({ id: "11111111-1111-4111-8111-111111111111", title: "Esistente", authors: ["Rossi, Anna"] }),
      makeBook({ id: "22222222-2222-4222-8222-222222222222", title: "Nuovo libro", authors: ["Verdi, Luca"] }),
    ]);
    await user.upload(await screen.findByLabelText("File di backup (.json)"), file(backup));
    const prev = await screen.findByRole("region", { name: "Anteprima del ripristino" });
    expect(prev).toHaveTextContent(/2 valide/);
    expect(within(prev).getByText(/Stessa scheda già presente/)).toBeInTheDocument();
    expect(prev).toHaveTextContent(/1 schede create, 0 aggiornate/);
    expect(prev).toHaveTextContent(/1 saltate/);
    expect(prev).toHaveTextContent(/Nessuna scheda viene eliminata/);
    expect(api.all()).toHaveLength(1); // nulla è cambiato
    const go = screen.getByRole("button", { name: "Ripristina" });
    expect(go).toBeDisabled(); // serve la conferma esplicita
    expect(screen.getByRole("checkbox", { name: /confermo il ripristino/ })).toBeDisabled(); // serve prima il backup verificato
    await user.click(screen.getByRole("button", { name: "Scarica e verifica il backup attuale" }));
    expect(await screen.findByText(/Backup scaricato e verificato: 1 schede e 0 prestiti/)).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: /confermo il ripristino/ }));
    await user.click(go);
    const out = await screen.findByRole("region", { name: "Esito del ripristino" });
    expect(out).toHaveTextContent(/1 schede create, 0 aggiornate, 1 saltate, 0 non riuscite/);
    await waitFor(() => expect(api.all().map((b) => b.title).sort()).toEqual(["Esistente", "Nuovo libro"]));
  });

  it("file non valido: messaggio chiaro e nessuna anteprima", async () => {
    const user = userEvent.setup();
    const api = renderSettings();
    await user.upload(await screen.findByLabelText("File di backup (.json)"), file("questo non è json"));
    expect(await screen.findByText(/non è un JSON valido/)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Anteprima del ripristino" })).not.toBeInTheDocument();
    expect(api.all()).toHaveLength(1);
  });

  it("la scelta «Aggiorna la scheda esistente» è per singolo conflitto e viene applicata", async () => {
    const user = userEvent.setup();
    const api = renderSettings();
    const backup = booksToJson([makeBook({ id: "11111111-1111-4111-8111-111111111111", title: "Esistente aggiornato", authors: ["Rossi, Anna"] })]);
    await user.upload(await screen.findByLabelText("File di backup (.json)"), file(backup));
    await screen.findByRole("region", { name: "Anteprima del ripristino" });
    await user.selectOptions(screen.getByLabelText(/Azione per «Esistente aggiornato»/), "aggiorna");
    await user.click(screen.getByRole("button", { name: "Scarica e verifica il backup attuale" }));
    await screen.findByText(/Backup scaricato e verificato/);
    await user.click(screen.getByRole("checkbox", { name: /confermo il ripristino/ }));
    await user.click(screen.getByRole("button", { name: "Ripristina" }));
    await screen.findByRole("region", { name: "Esito del ripristino" });
    expect(api.all()).toHaveLength(1);
    expect(api.all()[0]!.title).toBe("Esistente aggiornato");
  });

  it("catalogo vuoto: non serve il backup e l'importazione CSV funziona; la riga d'esempio del modello è rifiutata", async () => {
    const user = userEvent.setup();
    const api = renderSettings([]);
    await user.click(await screen.findByRole("radio", { name: /File CSV/ }));
    const csv = "titolo,autori,isbn,editore,anno,stato\r\n[ESEMPIO] Titolo del libro,\"Rossi, Anna | Verdi, Luca\",9780306406157,Alfa,1980,bozza\r\nLibro vero di prova,,,,,\r\n";
    await user.upload(await screen.findByLabelText("File CSV (.csv)"), new File([csv], "catalogo.csv", { type: "text/csv" }));
    const prev = await screen.findByRole("region", { name: "Anteprima del ripristino" });
    expect(prev).toHaveTextContent(/1 valide, 1 con errori/);
    expect(prev).toHaveTextContent(/riga di esempio/);
    expect(prev).toHaveTextContent(/Il catalogo è vuoto/);
    await user.click(screen.getByRole("checkbox", { name: /confermo il ripristino/ }));
    await user.click(screen.getByRole("button", { name: "Ripristina" }));
    await screen.findByRole("region", { name: "Esito del ripristino" });
    expect(api.all().map((b) => b.title)).toEqual(["Libro vero di prova"]);
  });

  it("backup v2: ripristina anche i prestiti (storico e prestito in corso), una sola volta", async () => {
    const user = userEvent.setup();
    const api = renderSettings([]);
    const bid = "33333333-3333-4333-8333-333333333333";
    const text = JSON.stringify({ format: "bibliotheca-backup", version: 2, count: 1, loanCount: 2, books: [makeBook({ id: bid, title: "Con prestiti" })], copies: [{ bookId: bid, copyNo: 1 }], loans: [
      { bookId: bid, bookTitle: "Con prestiti", copyNo: 1, borrower: "Anna", contact: "", notes: "", loanDate: "2026-08-01", plannedDays: 14, dueDate: "2026-08-15", returnedDate: "2026-08-12" },
      { bookId: bid, bookTitle: "Con prestiti", copyNo: 1, borrower: "Bruno", contact: "", notes: "", loanDate: "2026-10-01", plannedDays: 30, dueDate: "2026-10-31", returnedDate: null },
    ] });
    await user.upload(await screen.findByLabelText("File di backup (.json)"), file(text));
    expect(await screen.findByRole("region", { name: "Anteprima del ripristino" })).toHaveTextContent(/2 prestiti nel file/);
    await user.click(screen.getByRole("checkbox", { name: /confermo il ripristino/ }));
    await user.click(screen.getByRole("button", { name: "Ripristina" }));
    const out = await screen.findByRole("region", { name: "Esito del ripristino" });
    expect(out).toHaveTextContent(/2 prestiti ripristinati, 0 già presenti/);
    expect(api.allLoans().map((l) => [l.borrower, l.returnedDate])).toEqual(expect.arrayContaining([["Anna", "2026-08-12"], ["Bruno", null]]));
    expect(api.allLoans()).toHaveLength(2);
  });

  it("il visualizzatore non vede né esportazione né ripristino", async () => {
    renderSettings(undefined, ["viewer"]);
    expect(await screen.findByText(/riservate agli amministratori/)).toBeInTheDocument();
    expect(screen.queryByLabelText("File di backup (.json)")).not.toBeInTheDocument();
  });
});
