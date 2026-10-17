import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { BookForm } from "@/components/app/BookForm";
import { AdminOnly, PageHeader } from "@/components/app/common";
import { useBooksApi } from "@/lib/api/BooksApiContext";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { findProbableDuplicates } from "@/lib/backup";
import { emptyBookInput, type Book, type BookInput } from "@/lib/api/types";

export const Route = createFileRoute("/_app/catalogo/nuovo")({
  head: () => ({ meta: [{ title: "Nuovo libro — Bibliotheca" }] }),
  component: Nuovo,
});

function Nuovo() {
  const api = useBooksApi();
  const navigate = useNavigate();
  const [dup, setDup] = useState<{ input: BookInput; found: ReturnType<typeof findProbableDuplicates> } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const create = async (input: BookInput) => {
    const book = await api.createBook(input);
    await navigate({ to: "/catalogo/$id", params: { id: book.id } });
  };
  /** Cerca per ISBN e per titolo: se la ricerca non riesce non si blocca l'inserimento (l'avviso è un aiuto, non un vincolo). */
  const lookForDuplicates = async (input: BookInput) => {
    const terms = [input.isbn.trim(), input.title.trim()].filter(Boolean);
    const seen = new Map<string, Book>();
    try { for (const q of terms) for (const b of (await api.listBooks({ query: q, pageSize: 50 })).items) seen.set(b.id, b); } catch { return []; }
    return findProbableDuplicates(input, [...seen.values()]);
  };
  return (
    <>
      <Link to="/catalogo" className="mb-4 inline-flex items-center gap-1 text-sm text-primary hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden /> Torna al catalogo</Link>
      <PageHeader title="Nuovo libro" />
      <AdminOnly>
      <BookForm
        initial={emptyBookInput()}
        submitLabel="Salva la scheda"
        onCancel={() => void navigate({ to: "/catalogo" })}
        onSubmit={async (input) => {
          setErr(null);
          const found = await lookForDuplicates(input);
          if (found.length > 0) { setDup({ input, found }); return; }
          setDup(null);
          await create(input);
        }}
      />
      {dup && (
        <section role="alert" aria-label="Possibile duplicato" className="mt-6 rounded-md border border-amber-500 bg-amber-50 p-4 text-amber-950 dark:bg-amber-950 dark:text-amber-50">
          <h2 className="font-semibold">Questo libro sembra già presente nel catalogo</h2>
          <ul className="mt-2 list-disc pl-5">
            {dup.found.map(({ book, why }) => (
              <li key={book.id}><Link to="/catalogo/$id" params={{ id: book.id }} className="underline">{book.title}</Link> — stesso {why}{book.authors[0] ? ` (${book.authors[0]})` : ""}</li>
            ))}
          </ul>
          <p className="mt-2 text-sm">Se hai un altro esemplare dello stesso libro, apri la scheda esistente e usa «Aggiungi una copia»: così non nascono schede doppie. Se invece è davvero un&apos;altra edizione, puoi salvare comunque.</p>
          {err && <p className="mt-2 font-medium text-destructive">{err}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={() => setDup(null)}>Rivedi i dati</Button>
            <Button type="button" disabled={busy} onClick={() => { setBusy(true); setErr(null); void create(dup.input).catch((e) => setErr(e instanceof Error ? e.message : "Salvataggio non riuscito.")).finally(() => setBusy(false)); }}>{busy ? "Salvataggio…" : "Salva comunque come nuova scheda"}</Button>
          </div>
        </section>
      )}
      </AdminOnly>
    </>
  );
}
