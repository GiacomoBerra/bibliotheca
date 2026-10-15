import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowLeft, FileCode2, Pencil } from "lucide-react";
import { booksApi } from "@/lib/api/booksApi";
import { DemoBadge, IllustrativeNote, useUnavailable } from "@/components/app/common";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_app/catalogo/$id")({
  loader: async ({ params }) => {
    const book = await booksApi.getBook(params.id);
    if (!book) throw notFound();
    return book;
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: loaderData ? `${loaderData.title} — Bibliotheca` : "Scheda non trovata — Bibliotheca" },
      { name: "description", content: "Scheda bibliografica del libro." },
    ],
  }),
  notFoundComponent: () => (
    <div className="py-16 text-center">
      <h1 className="text-2xl font-semibold">Libro non trovato</h1>
      <p className="mt-2 text-sm text-muted-foreground">Nessun libro dimostrativo corrisponde a questo indirizzo.</p>
      <Link to="/catalogo" className="mt-4 inline-block text-primary underline">Torna al catalogo</Link>
    </div>
  ),
  component: Scheda,
});

function Scheda() {
  const b = Route.useLoaderData();
  const unavailable = useUnavailable();
  const rows: [string, React.ReactNode][] = [
    ["Titolo", b.title],
    ["Autore", b.author],
    ["ISBN", <span className="font-mono">{b.isbn}</span>],
    ["Editore", b.publisher],
    ["Anno", b.year],
    ["Soggetti", <span className="flex flex-wrap items-center gap-2">{b.subjects.join("; ")} <IllustrativeNote /></span>],
    ["Dewey", <span className="flex items-center gap-2 font-mono">{b.dewey} <IllustrativeNote /></span>],
    ["Collocazione", b.location],
  ];
  const marc = [
    ["020", "  ", `$a ${b.isbn}`],
    ["082", "04", `$a ${b.dewey}`],
    ["100", "1 ", `$a ${b.author}`],
    ["245", "10", `$a ${b.title}`],
    ["264", " 1", `$b ${b.publisher}, $c ${b.year}`],
    ...b.subjects.map((s) => ["650", " 4", `$a ${s}`]),
  ];

  return (
    <>
      <Link to="/catalogo" className="mb-4 inline-flex items-center gap-1 text-sm text-primary hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Torna al catalogo
      </Link>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold">{b.title}</h1>
          <p className="mt-1 text-muted-foreground">{b.author} · {b.publisher}, {b.year}</p>
        </div>
        <div className="flex items-center gap-2">
          <DemoBadge />
          <Button variant="outline" onClick={() => unavailable("Modifica scheda")}><Pencil aria-hidden /> Modifica</Button>
        </div>
      </div>

      <section aria-labelledby="bib" className="rounded-lg border bg-card p-6">
        <h2 id="bib" className="mb-4 text-xl font-semibold">Vista bibliografica</h2>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[10rem_1fr]">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-sm font-semibold text-muted-foreground">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="marc" className="mt-8 overflow-hidden rounded-lg border-2 border-dashed border-primary/40">
        <div className="flex flex-wrap items-center justify-between gap-2 bg-primary/5 px-6 py-4">
          <h2 id="marc" className="flex items-center gap-2 text-xl font-semibold"><FileCode2 className="h-5 w-5" aria-hidden /> Vista MARC21</h2>
          <IllustrativeNote />
        </div>
        <div className="px-6 py-4 text-sm text-muted-foreground">
          Solo layout con un esempio illustrativo: campi, indicatori e sottocampi non sono stati validati. Una vista testuale come questa <strong className="text-foreground">non è un file MARC interoperabile</strong> (ISO 2709 o MARCXML).
        </div>
        <pre className="overflow-x-auto bg-code p-6 font-mono text-sm leading-relaxed text-code-foreground" aria-label="Esempio di record MARC21 in forma testuale">
          {marc.map(([tag, ind, data]) => `${tag} ${(ind ?? "").replace(/ /g, "#")} ${data}`).join("\n")}
        </pre>
      </section>
    </>
  );
}
