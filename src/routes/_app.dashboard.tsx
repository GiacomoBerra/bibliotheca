import { createFileRoute, Link } from "@tanstack/react-router";
import { BookPlus, GraduationCap, Library, Lightbulb } from "lucide-react";
import { booksApi } from "@/lib/api/booksApi";
import { PageHeader, useUnavailable } from "@/components/app/common";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_app/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Bibliotheca" },
      { name: "description", content: "Sintesi del catalogo e azioni rapide." },
    ],
  }),
  loader: () => booksApi.getStats(),
  component: Dashboard,
});

function Dashboard() {
  const s = Route.useLoaderData();
  const unavailable = useUnavailable();
  const cards = [
    { label: "Libri in catalogo", value: s.total },
    { label: "Catalogati", value: s.byStatus.catalogato },
    { label: "Da revisionare", value: s.byStatus["da revisionare"] },
    { label: "Bozze", value: s.byStatus.bozza },
    { label: "Editori", value: s.publishers },
    { label: "Soggetti distinti", value: s.subjects },
  ];
  return (
    <>
      <PageHeader title="Dashboard" description="Una sintesi del catalogo, calcolata sui dati dimostrativi." />
      <section aria-labelledby="guida" className="mb-8 flex gap-4 rounded-lg border bg-accent/50 p-5">
        <Lightbulb className="h-6 w-6 shrink-0 text-accent-foreground" aria-hidden />
        <div>
          <h2 id="guida" className="text-lg font-semibold">Da dove iniziare</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Esplora il <Link to="/catalogo" className="font-medium text-primary underline">catalogo</Link> e apri una scheda per vedere la vista bibliografica e un esempio di vista MARC21. Poi leggi la <Link to="/didattica" className="font-medium text-primary underline">modalità didattica</Link> per conoscere il percorso guidato.
          </p>
        </div>
      </section>
      <section aria-label="Statistiche" className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        {cards.map((c) => (
          <div key={c.label} className="rounded-lg border bg-card p-5">
            <p className="text-sm text-muted-foreground">{c.label}</p>
            <p className="mt-1 font-serif text-3xl font-semibold">{c.value}</p>
          </div>
        ))}
      </section>
      <section aria-labelledby="azioni" className="mt-8">
        <h2 id="azioni" className="mb-3 text-xl font-semibold">Azioni rapide</h2>
        <div className="flex flex-wrap gap-3">
          <Button asChild><Link to="/catalogo"><Library aria-hidden /> Apri il catalogo</Link></Button>
          <Button variant="outline" onClick={() => unavailable("Aggiungi libro")}><BookPlus aria-hidden /> Aggiungi libro</Button>
          <Button asChild variant="outline"><Link to="/didattica"><GraduationCap aria-hidden /> Percorso didattico</Link></Button>
        </div>
      </section>
    </>
  );
}
