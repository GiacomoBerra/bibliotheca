import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { AuthProvider } from "@/lib/auth/AuthProvider";
import { safeRedirect } from "@/lib/auth/redirect";
import { authErrorMessage } from "@/lib/auth/messages";
import { routeTree } from "@/routeTree.gen";
import { makeFakeAuthClient } from "./fakeSupabase";

function renderApp(path: string, fake: ReturnType<typeof makeFakeAuthClient> | null) {
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }) });
  render(
    <AuthProvider client={fake ? fake.client : null}>
      <RouterProvider router={router} />
    </AuthProvider>,
  );
  return router;
}

describe("Protezione delle schermate", () => {
  it.each(["/dashboard", "/catalogo", "/impostazioni"])("%s senza sessione porta al login", async (path) => {
    const router = renderApp(path, makeFakeAuthClient());
    expect(await screen.findByRole("heading", { name: "Accedi al tuo catalogo" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/");
    expect(router.state.location.search).toMatchObject({ redirect: path });
  });

  it("senza configurazione Supabase lo dice chiaramente e non mostra dati", async () => {
    renderApp("/catalogo", null);
    expect(await screen.findByRole("heading", { name: "Servizio non configurato" })).toBeInTheDocument();
  });

  it("non esiste alcuna schermata di registrazione", async () => {
    renderApp("/", makeFakeAuthClient());
    await screen.findByRole("heading", { name: "Accedi al tuo catalogo" });
    expect(screen.queryByText(/registrati|crea account|sign up/i)).toBeNull();
  });
});

describe("Login, logout e sessione scaduta", () => {
  it("credenziali errate: messaggio chiaro, resta sul login", async () => {
    const user = userEvent.setup();
    renderApp("/", makeFakeAuthClient());
    await screen.findByLabelText("Email");
    await user.type(screen.getByLabelText("Email"), "proprietario@esempio.it");
    await user.type(screen.getByLabelText("Password"), "sbagliata");
    await user.click(screen.getByRole("button", { name: "Accedi" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Email o password non corretti");
  });

  it("campi vuoti: nessuna chiamata, messaggio", async () => {
    const user = userEvent.setup();
    renderApp("/", makeFakeAuthClient());
    await user.click(await screen.findByRole("button", { name: "Accedi" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Inserisci email e password");
  });

  it("login corretto porta alla pagina richiesta; uscita manuale riporta al login senza avviso di scadenza", async () => {
    const user = userEvent.setup();
    const router = renderApp("/?redirect=%2Fimpostazioni", makeFakeAuthClient());
    await user.type(await screen.findByLabelText("Email"), "proprietario@esempio.it");
    await user.type(screen.getByLabelText("Password"), "password-corretta-123");
    await user.click(screen.getByRole("button", { name: "Accedi" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/impostazioni"));
    await user.click(await screen.findByRole("button", { name: /Esci/ }));
    expect(await screen.findByRole("heading", { name: "Accedi al tuo catalogo" })).toBeInTheDocument();
    expect(screen.queryByText(/sessione è scaduta/i)).toBeNull();
  });

  it("sessione scaduta (SIGNED_OUT non richiesto) mostra l'avviso nel login", async () => {
    const fake = makeFakeAuthClient({ session: true });
    renderApp("/impostazioni", fake);
    await screen.findByRole("button", { name: /Esci/ });
    act(() => fake.emit("SIGNED_OUT", null));
    expect(await screen.findByText(/sessione è scaduta/i)).toBeInTheDocument();
  });

  it("errore di rete in fase di login: messaggio comprensibile", async () => {
    const user = userEvent.setup();
    renderApp("/", makeFakeAuthClient({ signInError: { message: "Failed to fetch" } }));
    await user.type(await screen.findByLabelText("Email"), "a@b.it");
    await user.type(screen.getByLabelText("Password"), "x");
    await user.click(screen.getByRole("button", { name: "Accedi" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Impossibile contattare il server");
  });
});

describe("Recupero password", () => {
  it("risposta neutra e redirect verso /reimposta-password", async () => {
    const user = userEvent.setup();
    const fake = makeFakeAuthClient();
    renderApp("/recupera-password", fake);
    await user.type(await screen.findByLabelText(/Email/), "chiunque@esempio.it");
    await user.click(screen.getByRole("button", { name: /Invia il link/ }));
    expect(await screen.findByRole("status")).toHaveTextContent("Se l'indirizzo corrisponde a un account");
    expect(fake.calls.resetRedirect).toMatch(/\/reimposta-password$/);
  });

  it("senza link di recupero la pagina di reimpostazione non permette di cambiare password", async () => {
    renderApp("/reimposta-password", makeFakeAuthClient());
    expect(await screen.findByText(/link non è valido o è scaduto/)).toBeInTheDocument();
  });

  it("con evento PASSWORD_RECOVERY valida lunghezza e conferma, poi salva", async () => {
    const user = userEvent.setup();
    const fake = makeFakeAuthClient({ session: true });
    renderApp("/reimposta-password", fake);
    await screen.findByText(/link non è valido/);
    act(() => fake.emit("PASSWORD_RECOVERY", fake.session));
    await user.type(await screen.findByLabelText(/Nuova password/), "corta");
    await user.type(screen.getByLabelText("Ripeti la password"), "corta");
    await user.click(screen.getByRole("button", { name: /Salva/ }));
    expect(screen.getByRole("alert")).toHaveTextContent("almeno 12 caratteri");
    await user.clear(screen.getByLabelText(/Nuova password/));
    await user.clear(screen.getByLabelText("Ripeti la password"));
    await user.type(screen.getByLabelText(/Nuova password/), "una-password-lunga-1");
    await user.type(screen.getByLabelText("Ripeti la password"), "una-password-lunga-2");
    await user.click(screen.getByRole("button", { name: /Salva/ }));
    expect(screen.getByRole("alert")).toHaveTextContent("non coincidono");
    await user.clear(screen.getByLabelText("Ripeti la password"));
    await user.type(screen.getByLabelText("Ripeti la password"), "una-password-lunga-1");
    await user.click(screen.getByRole("button", { name: /Salva/ }));
    await waitFor(() => expect(fake.calls.updatedPassword).toBe("una-password-lunga-1"));
  });
});

describe("Utilità", () => {
  it("safeRedirect accetta solo percorsi interni", () => {
    expect(safeRedirect("/catalogo?q=a")).toBe("/catalogo?q=a");
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil", "catalogo", undefined, 3, "/", "/reimposta-password"]) {
      expect(safeRedirect(bad)).toBeUndefined();
    }
  });
  it("authErrorMessage non espone dettagli interni", () => {
    expect(authErrorMessage({ message: "boom internal stack", status: 500 })).toBe("Operazione non riuscita. Riprova tra poco; se il problema continua, contatta il proprietario del catalogo.");
    expect(authErrorMessage({ status: 429 })).toMatch(/Troppi tentativi/);
  });
});
