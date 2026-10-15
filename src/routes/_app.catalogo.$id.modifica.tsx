import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { BookForm } from "@/components/app/BookForm";
import { AdminOnly, ErrorBox, Loading, PageHeader } from "@/components/app/common";
import { useBooksApi } from "@/lib/api/BooksApiContext";
import { useAsync } from "@/lib/useAsync";

export const Route = createFileRoute("/_app/catalogo/$id/modifica")({
  head: () => ({ meta: [{ title: "Modifica scheda — Bibliotheca" }] }),
  component: Modifica,
});

function Modifica() {
  const { id } = Route.useParams();
  const api = useBooksApi();
  const navigate = useNavigate();
  const { data: book, error, loading, reload } = useAsync(() => api.getBook(id), [api, id]);

  return (
    <>
      <Link to="/catalogo/$id" params={{ id }} className="mb-4 inline-flex items-center gap-1 text-sm text-primary hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden /> Torna alla scheda</Link>
      <PageHeader title="Modifica scheda" />
      <AdminOnly>
      {loading && !book ? <Loading /> : error ? <ErrorBox message={error} onRetry={reload} /> : !book ? (
        <p>Scheda non trovata. <Link to="/catalogo" className="text-primary underline">Torna al catalogo</Link></p>
      ) : (
        <BookForm
          initial={book}
          submitLabel="Salva le modifiche"
          onCancel={() => void navigate({ to: "/catalogo/$id", params: { id } })}
          onSubmit={async (input) => {
            await api.updateBook(id, input);
            await navigate({ to: "/catalogo/$id", params: { id } });
          }}
        />
      )}
      </AdminOnly>
    </>
  );
}
