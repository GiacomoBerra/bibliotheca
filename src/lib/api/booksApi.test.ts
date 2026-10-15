import { describe, it, expect } from "vitest";
import { filterBooks, computeStats, booksApi } from "./booksApi";
import { demoBooks } from "@/data/demoBooks";

describe("ricerca catalogo", () => {
  it("ignora maiuscole e spazi superflui nel titolo", () => {
    expect(filterBooks(demoBooks, "  ASTRONOMIA   per ").map((b) => b.id)).toEqual(["8"]);
  });
  it("trova per autore", () => {
    expect(filterBooks(demoBooks, "bianchi").map((b) => b.id)).toEqual(["2"]);
  });
  it("trova per ISBN", () => {
    expect(filterBooks(demoBooks, "9788800000073").map((b) => b.id)).toEqual(["7"]);
  });
  it("nessun risultato", () => {
    expect(filterBooks(demoBooks, "zzzz")).toHaveLength(0);
  });
  it("conteggi calcolati", () => {
    expect(computeStats(demoBooks).total).toBe(9);
    expect(computeStats([]).total).toBe(0);
  });
});

describe("livello dati demo", () => {
  it("è dichiarato dimostrativo", () => {
    expect(booksApi.isDemo).toBe(true);
  });
  it("restituisce null per un libro inesistente", async () => {
    expect(await booksApi.getBook("inesistente")).toBeNull();
  });
});
