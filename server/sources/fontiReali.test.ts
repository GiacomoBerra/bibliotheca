// @vitest-environment node
/**
 * Verifica CON SERVIZI REALI delle tre fonti (Open Library, Google Books, Library of Congress).
 * Non gira nella suite normale (serve Internet): si lancia a mano con
 *     npm run verifica:fonti
 * Dal sandbox di sviluppo le fonti NON sono raggiungibili, quindi questa prova va fatta sul tuo computer.
 * Scrive il risultato leggibile in `fonti-report.txt` (non committare).
 */
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createLookup } from "./lookup";

const ON = process.env["VERIFICA_FONTI"] === "1";
const lines: string[] = [];
const log = (s: string) => { lines.push(s); };

describe.skipIf(!ON)("fonti bibliografiche reali", () => {
  const lookup = createLookup({ fetch, minIntervalMs: 1500, timeoutMs: 15000, limits: { perMinute: 1000, perDay: 1000 }, env: (k) => process.env[k] });

  const casi = [
    { nome: "ISBN-13 «1984» (Signet)", q: { isbn: "9780451524935" }, atteso: /1984|nineteen/i },
    { nome: "ISBN-13 «Fantastic Mr Fox» (Puffin)", q: { isbn: "9780140328721" }, atteso: /fox/i },
    { nome: "titolo + autore «The Hobbit» / Tolkien", q: { title: "The Hobbit", author: "Tolkien" }, atteso: /hobbit/i },
    { nome: "titolo in italiano «Il nome della rosa» / Eco", q: { title: "Il nome della rosa", author: "Eco" }, atteso: /nome della rosa/i },
  ];

  for (const c of casi) {
    it(c.nome, async () => {
      const r = await lookup.run(c.q, "diagnostica", { refresh: true });
      log(`\n## ${c.nome}`);
      for (const s of r.sources) log(`- ${s.label}: ${s.status}, ${s.count} record${s.message ? ` (${s.message})` : ""}`);
      log(`- gruppi (edizioni uniche): ${r.groups.length}`);
      for (const g of r.groups.slice(0, 3)) log(`  • ${JSON.stringify(g).slice(0, 220)}`);
      const ok = r.sources.filter((s) => s.status === "ok" && s.count > 0).length;
      // Almeno una fonte deve rispondere con risultati pertinenti; le altre sono riportate nel report senza bloccare.
      expect(ok, `nessuna fonte ha risposto per «${c.nome}»`).toBeGreaterThan(0);
      expect(JSON.stringify(r.groups), "nessun risultato pertinente al titolo atteso").toMatch(c.atteso);
      if (c.q.isbn) expect(JSON.stringify(r.groups)).toContain(c.q.isbn);
    }, 90_000);
  }

  it("scrive il report", () => { writeFileSync("fonti-report.txt", lines.join("\n") + "\n"); });
});
