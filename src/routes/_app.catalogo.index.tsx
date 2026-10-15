import { useEffect, useId, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { BookPlus, Search, SearchX, Library } from "lucide-react";
import { booksApi } from "@/lib/api/booksApi";
import type { Book } from "@/lib/api/types";
import { DemoBadge, PageHeader } from "@/components/app/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export const Route = createFileRoute("/_app/catalogo/")({
  head: () => ({
    meta: [
      { title: "Catalogo — Bibliotheca" },
      { name: "description", content: "Elenco dei libri con ricerca per titolo, autore e ISBN." },
    ],
  }),
  loader: () => booksApi.listBooks(),
  component: Catalogo,
});

function Catalogo() {
  const all = Route.useLoaderData();
  const [q, setQ] = useState("");
  const [books, setBooks] = useState<Book[]>(all);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let live = true;
    booksApi.listBooks(q).then((r) => live && setBooks(r));
    return () => { live = false; };
  }, [q]);

  return (
    <>
      <PageHeader
        title="Catalogo"
        description="Cerca per titolo, autore o ISBN."
        actions={<Button onClick={() => setOpen(true)}><BookPlus aria-hidden /> Aggiungi libro</Button>}
      />
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="w-full max-w-md space-y-1.5">
          <Label htmlFor="cerca">Cerca nel catalogo</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input id="cerca" type="search" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" placeholder="Es. astronomia, Rossi, 9788800…" />
          </div>
        </div>
        <div className="flex items-center gap-3 text-sm text-muted-foreground" aria-live="polite">
          {books.length} {books.length === 1 ? "risultato" : "risultati"} <DemoBadge />
        </div>
      </div>

      {all.length === 0 ? (
        <Empty icon={Library} title="Il catalogo è vuoto" text="Quando aggiungerai i primi libri li troverai qui." />
      ) : books.length === 0 ? (
        <Empty icon={SearchX} title="Nessun risultato" text={`Nessun libro corrisponde a «${q.trim()}». Prova con meno parole o controlla l'ISBN.`} action={<Button variant="outline" onClick={() => setQ("")}>Azzera ricerca</Button>} />
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-lg border bg-card md:block">
            <table className="w-full text-sm">
              <caption className="sr-only">Libri in catalogo</caption>
              <thead className="bg-muted text-left text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">Titolo</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Autore</th>
                  <th scope="col" className="px-4 py-3 font-semibold">ISBN</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Anno</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Stato</th>
                </tr>
              </thead>
              <tbody>
                {books.map((b) => (
                  <tr key={b.id} className="border-t hover:bg-muted/50">
                    <td className="px-4 py-3"><Link to="/catalogo/$id" params={{ id: b.id }} className="font-medium text-primary hover:underline">{b.title}</Link></td>
                    <td className="px-4 py-3">{b.author}</td>
                    <td className="px-4 py-3 font-mono text-xs">{b.isbn}</td>
                    <td className="px-4 py-3">{b.year}</td>
                    <td className="px-4 py-3"><StatusPill status={b.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="space-y-3 md:hidden">
            {books.map((b) => (
              <li key={b.id}>
                <Link to="/catalogo/$id" params={{ id: b.id }} className="block rounded-lg border bg-card p-4 hover:bg-muted/50">
                  <p className="font-serif text-lg font-semibold text-primary">{b.title}</p>
                  <p className="text-sm">{b.author} · {b.year}</p>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="font-mono text-xs text-muted-foreground">{b.isbn}</span>
                    <StatusPill status={b.status} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
      <AddBookDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

function StatusPill({ status }: { status: Book["status"] }) {
  const cls = status === "catalogato" ? "bg-primary/10 text-primary" : status === "bozza" ? "bg-muted text-muted-foreground" : "bg-warning text-warning-foreground";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{status}</span>;
}

function Empty({ icon: Icon, title, text, action }: { icon: typeof Library; title: string; text: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed bg-card px-6 py-14 text-center">
      <Icon className="h-10 w-10 text-muted-foreground" aria-hidden />
      <h2 className="mt-3 text-xl font-semibold">{title}</h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{text}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

function AddBookDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [title, setTitle] = useState("");
  const [isbn, setIsbn] = useState("");
  const [touched, setTouched] = useState({ title: false, isbn: false });
  const ids = { t: useId(), i: useId(), a: useId(), y: useId() };
  const titleErr = touched.title && !title.trim() ? "Il titolo è obbligatorio." : "";
  const isbnClean = isbn.replace(/[\s-]/g, "");
  const isbnErr = touched.isbn && isbnClean && !/^(\d{9}[\dXx]|\d{13})$/.test(isbnClean) ? "L'ISBN deve avere 10 o 13 cifre (trattini e spazi ammessi)." : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Aggiungi libro</DialogTitle>
          <DialogDescription>Form dimostrativo: il salvataggio non è ancora disponibile e nessun dato verrà registrato.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
          <Field id={ids.t} label="Titolo *" error={titleErr}>
            <Input id={ids.t} value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => setTouched((t) => ({ ...t, title: true }))} aria-invalid={!!titleErr} aria-describedby={titleErr ? `${ids.t}-err` : undefined} />
          </Field>
          <Field id={ids.a} label="Autore (Cognome, Nome)"><Input id={ids.a} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field id={ids.i} label="ISBN" error={isbnErr}>
              <Input id={ids.i} inputMode="numeric" value={isbn} onChange={(e) => setIsbn(e.target.value)} onBlur={() => setTouched((t) => ({ ...t, isbn: true }))} aria-invalid={!!isbnErr} aria-describedby={isbnErr ? `${ids.i}-err` : undefined} />
            </Field>
            <Field id={ids.y} label="Anno"><Input id={ids.y} inputMode="numeric" /></Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Chiudi</Button>
            <Button type="submit" disabled title="Funzione non ancora disponibile">Salva (non disponibile)</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error && <p id={`${id}-err`} className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
