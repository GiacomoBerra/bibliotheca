import { createFileRoute, Link } from "@tanstack/react-router";
import { BookPlus, GraduationCap, Library, Lightbulb } from "lucide-react";
import { ErrorBox, Loading, PageHeader } from "@/components/app/common";
import { Button } from "@/components/ui/button";
import { useBooksApi } from "@/lib/api/BooksApiContext";
import { useAsync } from "@/lib/useAsync";

export const Route = createFileRoute("/_app/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Bibliotheca" },
      { name: "description", content: "Sintesi del catalogo e azioni rapide." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const api = useBooksApi();
  const { data: s, error, loading, reload } = useAsync(() => api.getStats(), [api]);
  const cards = s ? [
    { label: "Libri in catalogo", value: s.total },
    { label: "Catalogati", value: s.byStatus.catalogato },
    { label: "Da revisionare", value: s.byStatus["da revisionare"] },
    { label: "Bozze", value: s.byStatus.bozza },
    { label: "Editori distinti", value: s.publishers },
    { label: "Soggetti distinti", value: s.subjects },
  ] : [];
  return (
    <>
      <PageHeader title="Dashboard" description="Una sintesi del tuo catalogo, calcolata sulle schede salvate." />
      {s && s.total === 0 && (
        <section aria-labelledby="guida" className="mb-8 flex gap-4 rounded-lg border bg-accent/50 p-5">
          <Lightbulb className="h-6 w-6 shrink-0 text-accent-foreground" aria-hidden />
          <div>
            <h2 id="guida" className="text-lg font-semibold">Da dove iniziare</h2>
            <p className="mt-1 text-sm text-muted-foreground">Il catalogo è vuoto. <Link to="/catalogo/nuovo" className="font-medium text-primary underline">Aggiungi il primo libro</Link>: basta il titolo, il resto si può completare dopo.</p>
          </div>
        </section>
      )}
      {loading && !s ? <Loading /> : error ? <ErrorBox message={error} onRetry={reload} /> : (
        <section aria-label="Statistiche" className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          {cards.map((c) => (
            <div key={c.label} className="rounded-lg border bg-card p-5">
              <p className="text-sm text-muted-foreground">{c.label}</p>
              <p className="mt-1 font-serif text-3xl font-semibold">{c.value}</p>
            </div>
          ))}
        </section>
      )}
      <section aria-labelledby="azioni" className="mt-8">
        <h2 id="azioni" className="mb-3 text-xl font-semibold">Azioni rapide</h2>
        <div className="flex flex-wrap gap-3">
          <Button asChild><Link to="/catalogo"><Library aria-hidden /> Apri il catalogo</Link></Button>
          <Button asChild variant="outline"><Link to="/catalogo/nuovo"><BookPlus aria-hidden /> Aggiungi libro</Link></Button>
          <Button asChild variant="outline"><Link to="/didattica"><GraduationCap aria-hidden /> Percorso didattico</Link></Button>
        </div>
      </section>
    </>
  );
}
