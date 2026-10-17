import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { AuthProvider } from "@/lib/auth/AuthProvider";
import { safeRedirect } from "@/lib/auth/redirect";
import { authErrorMessage } from "@/lib/auth/messages";
import { BooksApiProvider } from "@/lib/api/BooksApiContext";
import { routeTree } from "@/routeTree.gen";
import { makeMemoryApi } from "./memoryApi";
import { makeFakeIdentity } from "./fakeIdentity";

function renderApp(path: string, fake: ReturnType<typeof makeFakeIdentity>) {
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }) });
  render(
    <AuthProvider identity={fake.identity}>
      <BooksApiProvider api={makeMemoryApi()}>
        <RouterProvider router={router} />
      </BooksApiProvider>
    </AuthProvider>,
  );
  return router;
}

describe("Protezione delle schermate", () => {
  it.each(["/dashboard", "/catalogo", "/impostazioni"])("%s senza sessione porta al login", async (path) => {
    const router = renderApp(path, makeFakeIdentity());
    expect(await screen.findByRole("heading", { name: "Accedi al tuo catalogo" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/");
    expect(router.state.location.search).toMatchObject({ redirect: path });
  });

  it("senza Netlify Identity (es. npm run dev) lo dice chiaramente e non mostra dati", async () => {
    const err = Object.assign(new Error("no identity"), { name: "MissingIdentityError" });
    renderApp("/catalogo", makeFakeIdentity({ getUserThrows: err }));
    expect(await screen.findByRole("heading", { name: "Accesso non disponibile" })).toBeInTheDocument();
  });

  it("non esiste alcuna schermata di registrazione", async () => {
    renderApp("/", makeFakeIdentity());
    await screen.findByRole("heading", { name: "Accedi al tuo catalogo" });
    expect(screen.queryByText(/registrati|crea account|sign up/i)).toBeNull();
  });
});

describe("Login, logout e sessione scaduta", () => {
  it("credenziali errate: messaggio chiaro, resta sul login", async () => {
    const user = userEvent.setup();
    renderApp("/", makeFakeIdentity());
    await screen.findByLabelText("Email");
    await user.type(screen.getByLabelText("Email"), "proprietario@esempio.it");
    await user.type(screen.getByLabelText("Password"), "sbagliata");
    await user.click(screen.getByRole("button", { name: "Accedi" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Email o password non corretti");
  });

  it("campi vuoti: nessuna chiamata, messaggio", async () => {
    const user = userEvent.setup();
    renderApp("/", makeFakeIdentity());
    await user.click(await screen.findByRole("button", { name: "Accedi" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Inserisci email e password");
  });

  it("login corretto porta alla pagina richiesta; uscita manuale riporta al login senza avviso di scadenza", async () => {
    const user = userEvent.setup();
    const router = renderApp("/?redirect=%2Fimpostazioni", makeFakeIdentity());
    await user.type(await screen.findByLabelText("Email"), "proprietario@esempio.it");
    await user.type(screen.getByLabelText("Password"), "password-corretta-123");
    await user.click(screen.getByRole("button", { name: "Accedi" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/impostazioni"));
    await user.click(await screen.findByRole("button", { name: /Esci/ }));
    expect(await screen.findByRole("heading", { name: "Accedi al tuo catalogo" })).toBeInTheDocument();
    expect(screen.queryByText(/sessione è scaduta/i)).toBeNull();
  });

  it("sessione scaduta (SIGNED_OUT non richiesto) mostra l'avviso nel login", async () => {
    const fake = makeFakeIdentity({ session: true });
    renderApp("/impostazioni", fake);
    await screen.findByRole("button", { name: /Esci/ });
    act(() => fake.emit("logout", null));
    expect(await screen.findByText(/sessione è scaduta/i)).toBeInTheDocument();
  });

  it("errore di rete in fase di login: messaggio comprensibile", async () => {
    const user = userEvent.setup();
    renderApp("/", makeFakeIdentity({ loginError: Object.assign(new Error("Failed to fetch"), {}) }));
    await user.type(await screen.findByLabelText("Email"), "a@b.it");
    await user.type(screen.getByLabelText("Password"), "x");
    await user.click(screen.getByRole("button", { name: "Accedi" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Impossibile contattare il server");
  });
});

describe("Recupero password", () => {
  it("risposta neutra e redirect verso /reimposta-password", async () => {
    const user = userEvent.setup();
    const fake = makeFakeIdentity();
    renderApp("/recupera-password", fake);
    await user.type(await screen.findByLabelText(/Email/), "chiunque@esempio.it");
    await user.click(screen.getByRole("button", { name: /Invia il link/ }));
    expect(await screen.findByRole("status")).toHaveTextContent("Se l'indirizzo corrisponde a un account");
    expect(fake.calls.recoveryEmail).toBe("chiunque@esempio.it");
  });

  it("senza link di recupero la pagina di reimpostazione non permette di cambiare password", async () => {
    renderApp("/reimposta-password", makeFakeIdentity());
    expect(await screen.findByText(/link non è valido o è scaduto/)).toBeInTheDocument();
  });

  it("con evento PASSWORD_RECOVERY valida lunghezza e conferma, poi salva", async () => {
    const user = userEvent.setup();
    const fake = makeFakeIdentity({ session: true });
    renderApp("/reimposta-password", fake);
    await screen.findByText(/link non è valido/);
    act(() => fake.emit("recovery", fake.user));
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
    await waitFor(() => expect(fake.calls.newPassword).toBe("una-password-lunga-1"));
  });
});

describe("Link ricevuti per email (invito e recupero)", () => {
  it("invito: il link atterra sulla radice, si sceglie la password e si entra", async () => {
    const user = userEvent.setup();
    const fake = makeFakeIdentity({ callback: { type: "invite", token: "tok-invito" } });
    const router = renderApp("/", fake);
    await user.type(await screen.findByLabelText(/Password \(almeno/), "una-password-lunga-1");
    await user.type(screen.getByLabelText("Ripeti la password"), "una-password-lunga-1");
    expect(router.state.location.pathname).toBe("/accetta-invito");
    await user.click(screen.getByRole("button", { name: /Crea l'accesso/ }));
    await waitFor(() => expect(fake.calls).toMatchObject({ inviteToken: "tok-invito", invitePassword: "una-password-lunga-1" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard"));
  });
  it("invito: password troppo corta o diversa non viene inviata", async () => {
    const user = userEvent.setup();
    const fake = makeFakeIdentity({ callback: { type: "invite", token: "t" } });
    renderApp("/", fake);
    await user.type(await screen.findByLabelText(/Password \(almeno/), "corta");
    await user.type(screen.getByLabelText("Ripeti la password"), "corta");
    await user.click(screen.getByRole("button", { name: /Crea l'accesso/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("almeno 12 caratteri");
    expect(fake.calls.invitePassword).toBe("");
  });
  it("recupero: il link atterra sulla radice e porta al modulo della nuova password", async () => {
    const router = renderApp("/", makeFakeIdentity({ session: true, callback: { type: "recovery" } }));
    expect(await screen.findByRole("heading", { name: "Scegli una nuova password" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/reimposta-password");
  });
  it("link non valido o scaduto: errore chiaro, nessun accesso", async () => {
    renderApp("/", makeFakeIdentity({ callbackThrows: Object.assign(new Error("invalid token"), { name: "AuthError" }) }));
    expect(await screen.findByText(/link ricevuto per email non è valido/)).toBeInTheDocument();
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
