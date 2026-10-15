import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { BookPlus, Library, Search, SearchX } from "lucide-react";
import { selectClass } from "@/components/app/BookForm";
import { EmptyState, ErrorBox, Loading, PageHeader, StatusPill } from "@/components/app/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBooksApi } from "@/lib/api/BooksApiContext";
import { BOOK_STATUSES, type BookStatus, type SortDir, type SortKey } from "@/lib/api/types";
import { useAsync } from "@/lib/useAsync";

export const Route = createFileRoute("/_app/catalogo/")({
  head: () => ({
    meta: [
      { title: "Catalogo — Bibliotheca" },
      { name: "description", content: "Elenco dei libri con ricerca, filtri e ordinamento." },
    ],
  }),
  component: Catalogo,
});

const PAGE_SIZE = 25;

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

function Catalogo() {
  const api = useBooksApi();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<BookStatus | "tutti">("tutti");
  const [sort, setSort] = useState<SortKey>("aggiornamento");
  const [dir, setDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);

  useEffect(() => { setPage(1); }, [dq, status, sort, dir]);

  const { data, error, loading, reload } = useAsync(
    () => api.listBooks({ query: dq, status, sort, dir, page, pageSize: PAGE_SIZE }),
    [api, dq, status, sort, dir, page],
  );
  const filtering = dq.trim() !== "" || status !== "tutti";
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  function onSort(v: SortKey) {
    setSort(v);
    setDir(v === "aggiornamento" ? "desc" : "asc");
  }

  return (
    <>
      <PageHeader
        title="Catalogo"
        description="Cerca per titolo, autore, ISBN, editore, soggetto, Dewey o collocazione."
        actions={<Button asChild><Link to="/catalogo/nuovo"><BookPlus aria-hidden /> Aggiungi libro</Link></Button>}
      />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_11rem_12rem_9rem]">
        <div className="space-y-1.5">
          <Label htmlFor="cerca">Cerca nel catalogo</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input id="cerca" type="search" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" placeholder="Es. astronomia, Rossi, 9788800…" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="stato">Stato</Label>
          <select id="stato" className={selectClass} value={status} onChange={(e) => setStatus(e.target.value as BookStatus | "tutti")}>
            <option value="tutti">Tutti</option>
            {BOOK_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ordina">Ordina per</Label>
          <select id="ordina" className={selectClass} value={sort} onChange={(e) => onSort(e.target.value as SortKey)}>
            <option value="aggiornamento">Ultima modifica</option>
            <option value="titolo">Titolo</option>
            <option value="autore">Autore</option>
            <option value="anno">Anno</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="direzione">Direzione</Label>
          <select id="direzione" className={selectClass} value={dir} onChange={(e) => setDir(e.target.value as SortDir)}>
            <option value="asc">Crescente</option>
            <option value="desc">Decrescente</option>
          </select>
        </div>
      </div>

      <p className="mb-3 text-sm text-muted-foreground" aria-live="polite">
        {data ? `${data.total} ${data.total === 1 ? "risultato" : "risultati"}` : " "}
      </p>

      {error ? (
        <ErrorBox message={error} onRetry={reload} />
      ) : loading && !data ? (
        <Loading label="Caricamento del catalogo…" />
      ) : data && data.total === 0 ? (
        filtering ? (
          <EmptyState icon={SearchX} title="Nessun risultato" text="Nessun libro corrisponde ai criteri. Prova con meno parole, cambia lo stato o controlla l'ISBN."
            action={<Button variant="outline" onClick={() => { setQ(""); setStatus("tutti"); }}>Azzera ricerca e filtri</Button>} />
        ) : (
          <EmptyState icon={Library} title="Il catalogo è vuoto" text="Aggiungi la prima scheda: basta il titolo, il resto si può completare in seguito."
            action={<Button asChild><Link to="/catalogo/nuovo"><BookPlus aria-hidden /> Aggiungi libro</Link></Button>} />
        )
      ) : data ? (
        <div aria-busy={loading}>
          <div className="hidden overflow-hidden rounded-lg border bg-card md:block">
            <table className="w-full text-sm">
              <caption className="sr-only">Libri in catalogo</caption>
              <thead className="bg-muted text-left text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">Titolo</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Autori</th>
                  <th scope="col" className="px-4 py-3 font-semibold">ISBN</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Anno</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Stato</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((b) => (
                  <tr key={b.id} className="border-t hover:bg-muted/50">
                    <td className="px-4 py-3"><Link to="/catalogo/$id" params={{ id: b.id }} className="break-words font-medium text-primary hover:underline">{b.title}</Link></td>
                    <td className="px-4 py-3">{b.authors.join("; ") || <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-4 py-3 font-mono text-xs">{b.isbn || <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-4 py-3">{b.publicationYear || <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-4 py-3"><StatusPill status={b.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="space-y-3 md:hidden">
            {data.items.map((b) => (
              <li key={b.id}>
                <Link to="/catalogo/$id" params={{ id: b.id }} className="block rounded-lg border bg-card p-4 hover:bg-muted/50">
                  <p className="break-words font-serif text-lg font-semibold text-primary">{b.title}</p>
                  <p className="text-sm">{[b.authors.join("; "), b.publicationYear].filter(Boolean).join(" · ") || "—"}</p>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{b.isbn}</span>
                    <StatusPill status={b.status} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          {pages > 1 && (
            <nav aria-label="Paginazione" className="mt-6 flex items-center justify-between gap-3 text-sm">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Precedenti</Button>
              <span>Pagina {data.page} di {pages}</span>
              <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Successivi</Button>
            </nav>
          )}
        </div>
      ) : null}
    </>
  );
}
