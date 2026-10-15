import { useAuth } from "@/lib/auth/AuthProvider";
import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, FileCode2, Pencil, Trash2 } from "lucide-react";
import { ErrorBox, IllustrativeNote, Loading, StatusPill } from "@/components/app/common";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useBooksApi } from "@/lib/api/BooksApiContext";
import type { Book, MarcField } from "@/lib/api/types";
import { useAsync } from "@/lib/useAsync";

export const Route = createFileRoute("/_app/catalogo/$id/")({
  head: () => ({ meta: [{ title: "Scheda — Bibliotheca" }, { name: "description", content: "Scheda bibliografica del libro." }] }),
  component: Scheda,
});

const dash = <span className="text-muted-foreground">—</span>;

function Scheda() {
  const { id } = Route.useParams();
  const api = useBooksApi();
  const { data: b, error, loading, reload } = useAsync(() => api.getBook(id), [api, id]);

  return (
    <>
      <Link to="/catalogo" className="mb-4 inline-flex items-center gap-1 text-sm text-primary hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Torna al catalogo
      </Link>
      {error ? <ErrorBox message={error} onRetry={reload} /> : loading && !b ? <Loading /> : !b ? (
        <div className="py-16 text-center">
          <h1 className="text-2xl font-semibold">Libro non trovato</h1>
          <p className="mt-2 text-sm text-muted-foreground">Nessuna tua scheda corrisponde a questo indirizzo: potrebbe essere stata cancellata.</p>
          <Link to="/catalogo" className="mt-4 inline-block text-primary underline">Torna al catalogo</Link>
        </div>
      ) : <Dettaglio book={b} />}
    </>
  );
}

function Dettaglio({ book: b }: { book: Book }) {
  const { isAdmin } = useAuth();
  const api = useBooksApi();
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [delError, setDelError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setDelError(null);
    try {
      await api.deleteBook(b.id);
      setConfirm(false);
      await navigate({ to: "/catalogo" });
    } catch (e) {
      setDelError(e instanceof Error ? e.message : "Cancellazione non riuscita.");
    } finally {
      setBusy(false);
    }
  }

  const rows: [string, React.ReactNode][] = [
    ["Titolo", b.title],
    ["Autori", b.authors.length ? b.authors.join("; ") : dash],
    ["ISBN", b.isbn ? <span className="font-mono">{b.isbn}</span> : dash],
    ["Editore", b.publisher || dash],
    ["Luogo di pubblicazione", b.publicationPlace || dash],
    ["Anno", b.publicationYear || dash],
    ["Lingua", b.language || dash],
    ["Descrizione fisica", b.physicalDescription || dash],
    ["Soggetti", b.subjects.length ? <ul className="list-inside list-disc">{b.subjects.map((s, i) => <li key={i}>{s}</li>)}</ul> : dash],
    ["Dewey", b.dewey ? <span className="font-mono">{b.dewey}</span> : dash],
    ["Collocazione", b.shelfMark || dash],
    ["Note", b.notes ? <span className="whitespace-pre-line">{b.notes}</span> : dash],
    ["Stato", <StatusPill status={b.status} />],
  ];

  const subtitle = [b.authors.join("; "), [b.publisher, b.publicationYear].filter(Boolean).join(", ")].filter(Boolean).join(" · ");

  return (
    <>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="break-words text-3xl font-semibold">{b.title}</h1>
          {subtitle && <p className="mt-1 text-muted-foreground">{subtitle}</p>}
        </div>
        {isAdmin && <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline"><Link to="/catalogo/$id/modifica" params={{ id: b.id }}><Pencil aria-hidden /> Modifica</Link></Button>
          <Button variant="outline" className="text-destructive" onClick={() => setConfirm(true)}><Trash2 aria-hidden /> Cancella</Button>
        </div>}
      </div>

      <section aria-labelledby="bib" className="rounded-lg border bg-card p-6">
        <h2 id="bib" className="mb-4 text-xl font-semibold">Vista bibliografica</h2>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[11rem_minmax(0,1fr)]">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-sm font-semibold text-muted-foreground">{k}</dt>
              <dd className="break-words">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <MarcView book={b} />

      <Dialog open={confirm} onOpenChange={(o) => !busy && setConfirm(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancellare questa scheda?</DialogTitle>
            <DialogDescription>«{b.title}» verrà eliminata in modo definitivo. L'operazione non si può annullare e il piano gratuito non include backup automatici.</DialogDescription>
          </DialogHeader>
          {delError && <ErrorBox message={delError} />}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)} disabled={busy}>Annulla</Button>
            <Button variant="destructive" onClick={() => void remove()} disabled={busy}>{busy ? "Cancellazione…" : "Cancella definitivamente"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function formatStored(f: MarcField): string {
  if ("subfields" in f) {
    return `${f.tag} ${(f.ind1 || " ").replace(/ /g, "#")}${(f.ind2 || " ").replace(/ /g, "#")} ${f.subfields.map((s) => `$${s.code} ${s.value}`).join(" ")}`;
  }
  return `${f.tag}    ${f.value}`;
}

function MarcView({ book: b }: { book: Book }) {
  const stored = b.marcFields;
  // Anteprima didattica generata dai campi semplici: NON salvata, NON validata.
  const preview: [string, string, string][] = [
    ...(b.isbn ? [["020", "##", `$a ${b.isbn}`] as [string, string, string]] : []),
    ...(b.dewey ? [["082", "04", `$a ${b.dewey}`] as [string, string, string]] : []),
    ...(b.authors[0] ? [["100", "1#", `$a ${b.authors[0]}`] as [string, string, string]] : []),
    ["245", "10", `$a ${b.title}`],
    ...(b.publisher || b.publicationYear ? [["264", "#1", [b.publisher && `$b ${b.publisher}`, b.publicationYear && `$c ${b.publicationYear}`].filter(Boolean).join(", ")] as [string, string, string]] : []),
    ...b.subjects.map((s) => ["650", "#4", `$a ${s}`] as [string, string, string]),
  ];
  return (
    <section aria-labelledby="marc" className="mt-8 overflow-hidden rounded-lg border-2 border-dashed border-primary/40">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-primary/5 px-6 py-4">
        <h2 id="marc" className="flex items-center gap-2 text-xl font-semibold"><FileCode2 className="h-5 w-5" aria-hidden /> Vista MARC21</h2>
        <IllustrativeNote>{stored ? "Dati salvati, non validati" : "Anteprima illustrativa, non salvata"}</IllustrativeNote>
      </div>
      <div className="px-6 py-4 text-sm text-muted-foreground">
        {stored
          ? "Record MARC21 salvato con la scheda (ordine, ripetizioni, indicatori e sottocampi conservati). L'app non ne verifica la validità."
          : "Anteprima ricavata dai campi della scheda con tag e indicatori a scopo didattico: non è stata validata e non viene salvata."}
        {" "}Una vista testuale come questa <strong className="text-foreground">non è un file MARC interoperabile</strong> (ISO 2709 o MARCXML).
      </div>
      <pre className="overflow-x-auto bg-code p-6 font-mono text-sm leading-relaxed text-code-foreground" aria-label="Record MARC21 in forma testuale">
        {stored ? stored.map(formatStored).join("\n") : preview.map(([t, i, d]) => `${t} ${i} ${d}`).join("\n")}
      </pre>
    </section>
  );
}
