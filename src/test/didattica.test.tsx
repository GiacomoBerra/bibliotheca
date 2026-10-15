import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { AuthProvider } from "@/lib/auth/AuthProvider";
import { BooksApiProvider } from "@/lib/api/BooksApiContext";
import { MarcEditor } from "@/components/app/MarcEditor";
import { routeTree } from "@/routeTree.gen";
import { diagnose, EXERCISES, LESSONS, TOPIC_LABELS } from "@/lib/didattica/content";
import { GLOSSARY } from "@/lib/marc/glossary";
import { RULES } from "@/lib/marc/rules";
import { emptyBookInput } from "@/lib/api/types";
import { makeFakeIdentity } from "./fakeIdentity";
import { makeMemoryApi } from "./memoryApi";

describe("Contenuti didattici: coerenza con le regole verificate", () => {
  it("il glossario copre esattamente i campi di RULES, con la stessa ripetibilità, gli stessi indicatori e sottocampi", () => {
    expect(Object.keys(GLOSSARY).sort()).toEqual(Object.keys(RULES).sort());
    for (const [tag, rule] of Object.entries(RULES)) {
      const g = GLOSSARY[tag]!;
      expect(g.repeatable, `${tag} ripetibile`).toBe(rule.repeatable);
      expect(g.url).toBe(rule.url);
      const keys = (v: Record<string, string>) => Object.keys(v).filter((k) => k !== "1–9").sort();
      const expand = (v: Record<string, string>) => (Object.keys(v).includes("1–9") ? [...keys(v), ..."123456789".split("")] : keys(v)).sort();
      expect(expand(g.ind1.values), `${tag} ind1`).toEqual([...rule.ind1].sort());
      expect(expand(g.ind2.values), `${tag} ind2`).toEqual([...rule.ind2].sort());
      for (const s of g.subfields) if (s.code in rule.subfields) expect(s.repeatable, `${tag} $${s.code}`).toBe(rule.subfields[s.code]);
    }
  });
  it("ogni esercizio a scelta ha una risposta corretta tra le opzioni, una spiegazione, id univoci e fonti ufficiali dove citate", () => {
    const ids = EXERCISES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of EXERCISES) {
      expect(TOPIC_LABELS[e.topic]).toBeTruthy();
      if (e.kind !== "choice") continue;
      expect(e.options.length).toBeGreaterThanOrEqual(2);
      expect(e.options.map((o) => o.id)).toContain(e.correct);
      expect(e.explain.length).toBeGreaterThan(20);
      if (e.source) expect(e.source.url).toMatch(/^https:\/\/www\.loc\.gov\/marc\/bibliographic\/bd\d{3}\.html$/);
    }
  });
  it("copertura degli argomenti richiesti: MARC, indicatori, sottocampi, soggetti, Dewey, errori frequenti, formale vs catalografica", () => {
    for (const t of Object.keys(TOPIC_LABELS)) expect(EXERCISES.some((e) => e.topic === t), t).toBe(true);
    expect(LESSONS.map((l) => l.id)).toEqual(expect.arrayContaining(["quattro", "campo", "formale", "frequenti"]));
  });
  it("il conteggio dei caratteri non filing dell'esercizio i2 coincide con la regola (articolo + spazio)", () => {
    const ex = EXERCISES.find((e) => e.id === "i2");
    expect(ex?.kind === "choice" && ex.options.find((o) => o.id === ex.correct)?.text).toBe(String("Il ".length));
  });
  it("le risposte degli esercizi diagnostici sono calcolate dal controllo reale", () => {
    const counts = Object.fromEntries(EXERCISES.filter((e) => e.kind === "diagnose").map((e) => [e.id, diagnose(e as never).count]));
    expect(counts).toEqual({ e1: 1, e2: 1, e3: 1, e4: 1, f1: 0, f2: 0 });
  });
});

function renderDidattica() {
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ["/didattica"] }) });
  render(
    <AuthProvider identity={makeFakeIdentity({ session: true, roles: ["viewer"] }).identity}>
      <BooksApiProvider api={makeMemoryApi()}><RouterProvider router={router} /></BooksApiProvider>
    </AuthProvider>,
  );
}

describe("Pagina didattica", () => {
  it("dichiara i limiti e mostra lezioni, esplora-campi ed esercizi (accessibile anche al visualizzatore)", async () => {
    renderDidattica();
    expect(await screen.findByText(/Limiti, dichiarati/)).toBeInTheDocument();
    expect(screen.getByText("Validità formale e correttezza catalografica", { selector: "summary" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Esplora un campo MARC 21" })).toBeInTheDocument();
  });
  it("risposta sbagliata: feedback con la risposta giusta, la spiegazione e la fonte; risposta giusta: conferma", async () => {
    const user = userEvent.setup();
    renderDidattica();
    const q = (await screen.findByText("Quale di questi campi NON è ripetibile in un record?")).closest("fieldset")!;
    await user.click(within(q).getByLabelText(/700 – accesso aggiuntivo/));
    await user.click(within(q).getByRole("button", { name: "Verifica la risposta" }));
    expect(within(q).getByText("Non è la risposta giusta.")).toBeInTheDocument();
    expect(within(q).getByText(/La risposta corretta è/)).toHaveTextContent("245 – titolo");
    expect(within(q).getByRole("link", { name: /campo 245/ })).toHaveAttribute("href", "https://www.loc.gov/marc/bibliographic/bd245.html");
    const q2 = screen.getByText("Il campo 100 (intestazione principale – nome di persona) è ripetibile?").closest("fieldset")!;
    await user.click(within(q2).getByLabelText(/No: gli altri autori/));
    await user.click(within(q2).getByRole("button", { name: "Verifica la risposta" }));
    expect(within(q2).getByText("Risposta corretta.")).toBeInTheDocument();
    expect(within(q2).getByText(/dipende dalle norme di catalogazione/)).toBeInTheDocument(); // dichiara il contesto
    expect(screen.getByText(/Risposte corrette in questa sessione: 1 su 2/)).toBeInTheDocument();
  });
  it("esercizio diagnostico: il feedback riporta gli avvisi veri del controllo; per «formale» ricorda i limiti", async () => {
    const user = userEvent.setup();
    renderDidattica();
    const card = (await screen.findByText(/Titolo 245 con il titolo sbagliato/)).closest("article")!;
    await user.selectOptions(within(card).getByLabelText("Numero di avvisi"), "1");
    await user.click(within(card).getByRole("button", { name: "Verifica la risposta" }));
    expect(within(card).getByText("Non è la risposta giusta.")).toBeInTheDocument();
    expect(within(card).getByText(/segnala/)).toHaveTextContent("0 avvisi");
    expect(within(card).getByText(/confrontando il record con il libro/)).toBeInTheDocument();
  });
  it("il filtro per argomento mostra solo gli esercizi scelti", async () => {
    const user = userEvent.setup();
    renderDidattica();
    await user.selectOptions(await screen.findByLabelText("Argomento"), "dewey");
    expect(screen.getByText(/Nel campo 082 \(Dewey\)/)).toBeInTheDocument();
    expect(screen.queryByText(/Quale di questi campi NON è ripetibile/)).not.toBeInTheDocument();
  });
  it("l'esplora-campi mostra indicatori, sottocampi e fonte del campo scelto", async () => {
    const user = userEvent.setup();
    renderDidattica();
    await user.selectOptions(await screen.findByLabelText("Campo"), "650");
    expect(screen.getByText(/Library of Congress Subject Headings/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Fonte ufficiale/ })).toHaveAttribute("href", "https://www.loc.gov/marc/bibliographic/bd650.html");
  });
});

describe("Spiegazione contestuale nell'editor MARC", () => {
  it("per un campo documentato spiega indicatori e sottocampi correnti; per un campo ignoto non mostra spiegazioni", async () => {
    const user = userEvent.setup();
    render(<MarcEditor leader="00000nam a2200000   4500" book={emptyBookInput()} onChange={() => {}} fields={[
      { tag: "245", ind1: "1", ind2: "3", subfields: [{ code: "a", value: "Il nome della rosa" }] },
      { tag: "999", ind1: " ", ind2: " ", subfields: [{ code: "a", value: "locale" }] },
    ]} />);
    const help = screen.getAllByText(/Che cos'è il campo/);
    expect(help).toHaveLength(1);
    await user.click(help[0]!);
    const box = screen.getByLabelText("Spiegazione del campo 1");
    expect(within(box).getByText(/Indicatore 2 \(Caratteri da non considerare/)).toHaveTextContent("numero di posizioni iniziali ignorate");
    expect(within(box).getByText(/Titolo \(non ripetibile\)/)).toBeInTheDocument();
  });
});
