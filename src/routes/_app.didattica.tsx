import { createFileRoute } from "@tanstack/react-router";
import { Hash, Tags, FileCode2, BookCheck } from "lucide-react";
import { PageHeader } from "@/components/app/common";

export const Route = createFileRoute("/_app/didattica")({
  head: () => ({
    meta: [
      { title: "Modalità didattica — Bibliotheca" },
      { name: "description", content: "Percorso guidato per imparare catalogazione, MARC21, soggettazione e Dewey." },
    ],
  }),
  component: Didattica,
});

const steps = [
  { icon: BookCheck, title: "Descrizione bibliografica", text: "Osservare il libro e individuare titolo, responsabilità, edizione, pubblicazione." },
  { icon: FileCode2, title: "Struttura di un record MARC21", text: "Capire come campi, indicatori e sottocampi organizzano i dati." },
  { icon: Tags, title: "Soggettazione", text: "Esprimere di che cosa tratta un'opera con un linguaggio controllato." },
  { icon: Hash, title: "Classificazione Decimale Dewey", text: "Assegnare una notazione che colloca l'opera in una disciplina." },
];

function Didattica() {
  return (
    <>
      <PageHeader title="Modalità didattica" description="Un percorso guidato, passo dopo passo, per imparare a catalogare." />
      <div role="note" className="mb-8 rounded-md border bg-warning p-4 text-sm text-warning-foreground">
        I contenuti delle lezioni sono in preparazione. Le regole verranno inserite solo dopo verifica sulle fonti ufficiali (documentazione MARC21 della Library of Congress, edizioni autorizzate della Dewey, linee guida di soggettazione).
      </div>
      <ol className="grid gap-4 sm:grid-cols-2">
        {steps.map((s, i) => (
          <li key={s.title} className="rounded-lg border bg-card p-5">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary font-serif text-primary-foreground">{i + 1}</span>
              <s.icon className="h-5 w-5 text-primary" aria-hidden />
            </div>
            <h2 className="mt-3 text-lg font-semibold">{s.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{s.text}</p>
            <p className="mt-3 text-xs font-medium text-muted-foreground">Stato: in arrivo</p>
          </li>
        ))}
      </ol>
    </>
  );
}
