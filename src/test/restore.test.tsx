import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
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
    await user.click(screen.getByRole("checkbox", { name: /confermo il ripristino/ }));
    await user.click(screen.getByRole("button", { name: "Ripristina" }));
    await screen.findByRole("region", { name: "Esito del ripristino" });
    expect(api.all()).toHaveLength(1);
    expect(api.all()[0]!.title).toBe("Esistente aggiornato");
  });

  it("il visualizzatore non vede né esportazione né ripristino", async () => {
    renderSettings(undefined, ["viewer"]);
    expect(await screen.findByText(/riservate agli amministratori/)).toBeInTheDocument();
    expect(screen.queryByLabelText("File di backup (.json)")).not.toBeInTheDocument();
  });
});
