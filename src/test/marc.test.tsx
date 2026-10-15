import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { AuthProvider } from "@/lib/auth/AuthProvider";
import { BooksApiProvider } from "@/lib/api/BooksApiContext";
import { routeTree } from "@/routeTree.gen";
import type { MarcField } from "@/lib/api/types";
import { checkStructure, toReadableText } from "@/lib/marc/structure";
import { checkKnownRules } from "@/lib/marc/rules";
import { compareWithGeneral, generateFromGeneral, mergeGenerated } from "@/lib/marc/fromBook";
import { emptyBookInput } from "@/lib/api/types";
import { makeFakeIdentity } from "./fakeIdentity";
import { makeBook, makeMemoryApi } from "./memoryApi";

const rec: MarcField[] = [
  { tag: "001", value: "ctl-1" },
  { tag: "245", ind1: "1", ind2: "0", subfields: [{ code: "a", value: "Titolo" }, { code: "b", value: "sottotitolo" }] },
  { tag: "650", ind1: " ", ind2: "7", subfields: [{ code: "a", value: "Uno" }, { code: "2", value: "x" }] },
  { tag: "650", ind1: " ", ind2: "7", subfields: [{ code: "a", value: "Due" }] },
];

describe("Validità strutturale MARC21", () => {
  it("un record ben formato non ha errori; il leader deve avere 24 caratteri", () => {
    expect(checkStructure("00000nam a2200000 a 4500", rec)).toEqual([]);
    expect(checkStructure("corto", []).map((i) => i.level)).toEqual(["errore"]);
  });
  it("rileva tag, indicatori, codici e tipi di campo non validi", () => {
    const bad: MarcField[] = [
      { tag: "24", ind1: "1", ind2: "0", subfields: [{ code: "a", value: "x" }] },
      { tag: "245", ind1: "10", ind2: "0", subfields: [{ code: "a", value: "x" }] },
      { tag: "245", ind1: "1", ind2: "0", subfields: [{ code: "A", value: "x" }] },
      { tag: "245", ind1: "1", ind2: "0", subfields: [] },
      { tag: "001", ind1: " ", ind2: " ", subfields: [{ code: "a", value: "x" }] },
      { tag: "245", value: "senza indicatori" },
    ];
    const msgs = checkStructure(null, bad).filter((i) => i.level === "errore").map((i) => i.index);
    expect(new Set(msgs)).toEqual(new Set([0, 1, 2, 3, 4, 5]));
  });
  it("valori vuoti = avviso, non errore; caratteri di controllo = errore", () => {
    expect(checkStructure(null, [{ tag: "245", ind1: " ", ind2: " ", subfields: [{ code: "a", value: " " }] }]).map((i) => i.level)).toEqual(["avviso"]);
    expect(checkStructure(null, [{ tag: "001", value: "a\u0000b" }]).some((i) => i.level === "errore")).toBe(true);
  });
  it("visualizzazione leggibile con ordine e ripetizioni", () => {
    expect(toReadableText("00000nam a2200000 a 4500", rec).split("\n")).toEqual([
      "=LDR  00000nam a2200000 a 4500", "=001  ctl-1", "=245  10$aTitolo$bsottotitolo", "=650  \\7$aUno$2x", "=650  \\7$aDue",
    ]);
  });
});

describe("Regole MARC 21 verificate (solo campi elencati)", () => {
  it("245 e 100 non ripetibili; $a di 245 non ripetibile; indicatori non previsti → avviso", () => {
    const f = (tag: string, ind1: string, ind2: string, subs: [string, string][]): MarcField => ({ tag, ind1, ind2, subfields: subs.map(([code, value]) => ({ code, value })) });
    const w = checkKnownRules([f("245", "1", "0", [["a", "x"], ["a", "y"]]), f("245", "2", "0", [["a", "z"]]), f("100", "1", " ", [["a", "R"]]), f("100", "1", " ", [["a", "S"]])]);
    expect(w.every((x) => x.level === "avviso")).toBe(true);
    expect(w.map((x) => x.message).join("\n")).toMatch(/\$a non è ripetibile/);
    expect(w.map((x) => x.message).join("\n")).toMatch(/Campo 2 \(245 Titolo\): il campo non è ripetibile/);
    expect(w.map((x) => x.message).join("\n")).toMatch(/indicatore 1 «2» non previsto/);
    expect(w.some((x) => x.index === 3)).toBe(true);
  });
  it("650 non ha regole nell'app: nessun giudizio", () => {
    expect(checkKnownRules(rec)).toEqual([]);
  });
});

describe("Generazione dai dati generali e coerenza", () => {
  const book = { ...emptyBookInput(), title: "Il nome", authors: ["Eco, Umberto", "Mario Rossi"], isbn: "978-0-306-40615-7", publisher: "Bompiani", publicationPlace: "Milano", publicationYear: "1980", physicalDescription: "500 p.", subjects: ["Romanzi"] };
  it("genera solo 020,100,245,264,300,653,700 con avvisi sugli indicatori da verificare", () => {
    const g = generateFromGeneral(book);
    expect(g.fields.map((f) => f.tag)).toEqual(["020", "100", "245", "264", "300", "653", "700"]);
    expect(g.fields[1]).toMatchObject({ ind1: "1" });
    expect(g.fields[6]).toMatchObject({ ind1: "0" });
    expect(g.notes.join(" ")).toMatch(/Cognome, Nome/);
    expect(g.notes.join(" ")).toMatch(/245/);
    expect(g.fields[0]!.subfields[0]!.value).toBe("9780306406157");
  });
  it("l'unione conserva i campi non generati e li riordina per tag senza perdere le ripetizioni", () => {
    const merged = mergeGenerated(rec, generateFromGeneral(book).fields);
    expect(merged.map((f) => f.tag)).toEqual(["001", "020", "100", "245", "264", "300", "650", "650", "653", "700"]);
    expect(merged.filter((f) => f.tag === "650")).toEqual([rec[2], rec[3]]);
  });
  it("segnala incoerenze senza modificare nulla", () => {
    expect(compareWithGeneral({ ...book, title: "Altro" }, rec).join(" ")).toMatch(/245 \$a/);
    expect(compareWithGeneral({ ...book, title: "Titolo" }, rec)).toEqual([]);
  });
});

function renderEdit(books = [makeBook({ id: "m1", title: "Titolo", marcLeader: "00000nam a2200000 a 4500", marcFields: rec })]) {
  const api = makeMemoryApi(books);
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ["/catalogo/m1/modifica"] }) });
  render(
    <AuthProvider identity={makeFakeIdentity({ session: true, roles: ["admin"] }).identity}>
      <BooksApiProvider api={api}><RouterProvider router={router} /></BooksApiProvider>
    </AuthProvider>,
  );
  return api;
}

describe("Editor MARC21 nella scheda", () => {
  it("modifica, riordino, duplicazione e salvataggio conservano ordine, indicatori, sottocampi e ripetizioni", async () => {
    const user = userEvent.setup();
    const api = renderEdit();
    await screen.findByRole("heading", { name: "Record MARC21" });
    await user.click(screen.getByRole("button", { name: "Sposta su il campo 4" })); // 650 "Due" prima di 650 "Uno"
    await user.click(screen.getByRole("button", { name: "Aggiungi sottocampo al campo 2" }));
    const code = screen.getByLabelText("Valore del sottocampo 3", { selector: "#m1-s2-v" });
    await user.type(code, "responsabilità");
    await user.clear(screen.getByLabelText("Ind. 1", { selector: "#m1-i1" }));
    await user.type(screen.getByLabelText("Ind. 1", { selector: "#m1-i1" }), "0");
    await user.click(screen.getByRole("button", { name: "Salva le modifiche" }));
    await waitFor(async () => expect((await api.getBook("m1"))!.marcFields).not.toEqual(rec));
    const saved = (await api.getBook("m1"))!;
    expect(saved.marcLeader).toBe("00000nam a2200000 a 4500");
    expect(saved.marcFields).toEqual([
      rec[0],
      { tag: "245", ind1: "0", ind2: "0", subfields: [{ code: "a", value: "Titolo" }, { code: "b", value: "sottotitolo" }, { code: "a", value: "responsabilità" }] },
      rec[3],
      rec[2],
    ]);
  });
  it("con errori strutturali il salvataggio è bloccato e il messaggio spiega cosa correggere", async () => {
    const user = userEvent.setup();
    const api = renderEdit();
    await screen.findByRole("heading", { name: "Record MARC21" });
    await user.clear(screen.getByLabelText("Tag", { selector: "#m2-tag" }));
    await user.type(screen.getByLabelText("Tag", { selector: "#m2-tag" }), "24");
    await user.click(screen.getByRole("button", { name: "Salva le modifiche" }));
    expect(await screen.findByText(/errori strutturali/)).toBeInTheDocument();
    expect((await api.getBook("m1"))!.marcFields).toEqual(rec);
  });
  it("«Genera campi» mostra l'anteprima e non cambia nulla finché non si conferma", async () => {
    const user = userEvent.setup();
    renderEdit();
    await screen.findByRole("heading", { name: "Record MARC21" });
    await user.click(screen.getByRole("button", { name: /Genera campi dai dati generali/ }));
    expect(screen.getByRole("region", { name: "Anteprima dei campi generati" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem", { name: /Campo \d/ })).toHaveLength(4);
    await user.click(within(screen.getByRole("region", { name: "Anteprima dei campi generati" })).getByRole("button", { name: "Annulla" }));
    expect(screen.queryByRole("region", { name: "Anteprima dei campi generati" })).not.toBeInTheDocument();
  });
  it("rimozione del record: richiede conferma", async () => {
    const user = userEvent.setup();
    renderEdit();
    await screen.findByRole("heading", { name: "Record MARC21" });
    await user.click(screen.getByRole("button", { name: /Rimuovi il record MARC21/ }));
    await user.click(screen.getByRole("button", { name: "Sì, rimuovi il record" }));
    expect(screen.getByRole("button", { name: /Crea un record MARC21/ })).toBeInTheDocument();
  });
});
