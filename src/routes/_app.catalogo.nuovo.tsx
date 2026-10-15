import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { BookForm } from "@/components/app/BookForm";
import { PageHeader } from "@/components/app/common";
import { useBooksApi } from "@/lib/api/BooksApiContext";
import { emptyBookInput } from "@/lib/api/types";

export const Route = createFileRoute("/_app/catalogo/nuovo")({
  head: () => ({ meta: [{ title: "Nuovo libro — Bibliotheca" }] }),
  component: Nuovo,
});

function Nuovo() {
  const api = useBooksApi();
  const navigate = useNavigate();
  return (
    <>
      <Link to="/catalogo" className="mb-4 inline-flex items-center gap-1 text-sm text-primary hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden /> Torna al catalogo</Link>
      <PageHeader title="Nuovo libro" />
      <BookForm
        initial={emptyBookInput()}
        submitLabel="Salva la scheda"
        onCancel={() => void navigate({ to: "/catalogo" })}
        onSubmit={async (input) => {
          const book = await api.createBook(input);
          await navigate({ to: "/catalogo/$id", params: { id: book.id } });
        }}
      />
    </>
  );
}
