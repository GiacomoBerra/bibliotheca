import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { HandHelping } from "lucide-react";
import { LoanPill, durationText, fmtDate } from "@/components/app/LoanBits";
import { EmptyState, ErrorBox, Loading, PageHeader } from "@/components/app/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBooksApi } from "@/lib/api/BooksApiContext";
import type { LoanStateFilter } from "@/lib/api/loans";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useAsync } from "@/lib/useAsync";

export const Route = createFileRoute("/_app/prestiti")({
  head: () => ({ meta: [{ title: "Prestiti — Bibliotheca" }, { name: "description", content: "Prestiti attivi e storico dei prestiti." }] }),
  component: Prestiti,
});

const STATES: [LoanStateFilter, string][] = [["attivi", "Attivi"], ["in ritardo", "In ritardo"], ["restituiti", "Restituiti"], ["tutti", "Tutti"]];

function Prestiti() {
  const { isAdmin } = useAuth();
  if (!isAdmin) {
    return (
      <>
        <PageHeader title="Prestiti" />
        <p className="rounded-lg border bg-card p-5 text-sm text-muted-foreground">La gestione dei prestiti è riservata agli amministratori. Lo stato di ogni libro è consultabile nella sua scheda, nella sezione «Prestiti».</p>
      </>
    );
  }
  return <Elenco />;
}

function Elenco() {
  const api = useBooksApi();
  const [state, setState] = useState<LoanStateFilter>("attivi");
  const [borrower, setBorrower] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useAsync(
    () => api.listLoans({ state, borrower: borrower.trim(), from, to, page }),
    [api, state, borrower, from, to, page],
  );
  const reset = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <PageHeader title="Prestiti" description="Prestiti in corso e storico. La registrazione di un prestito o di una restituzione si fa dalla scheda del libro." />
      <form role="search" aria-label="Filtri prestiti" onSubmit={(e) => e.preventDefault()} className="mb-6 grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Label htmlFor="f-state">Stato</Label>
          <select id="f-state" value={state} onChange={(e) => reset(setState)(e.target.value as LoanStateFilter)} className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-base shadow-sm md:text-sm">
            {STATES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div><Label htmlFor="f-borrower">Destinatario</Label><Input id="f-borrower" value={borrower} onChange={(e) => reset(setBorrower)(e.target.value)} placeholder="Nome o parte del nome" /></div>
        <div><Label htmlFor="f-from">Prestiti dal</Label><Input id="f-from" type="date" value={from} onChange={(e) => reset(setFrom)(e.target.value)} /></div>
        <div><Label htmlFor="f-to">Prestiti fino al</Label><Input id="f-to" type="date" value={to} onChange={(e) => reset(setTo)(e.target.value)} /></div>
      </form>
      {error ? <ErrorBox message={error} onRetry={reload} /> : loading && !data ? <Loading /> : data && data.items.length === 0 ? (
        <EmptyState icon={HandHelping} title="Nessun prestito" text="Nessun prestito corrisponde ai filtri scelti." />
      ) : data && (
        <>
          <p className="mb-2 text-sm text-muted-foreground" aria-live="polite">{data.total} {data.total === 1 ? "prestito" : "prestiti"}</p>
          <div className="overflow-x-auto rounded-lg border bg-card">
            <table className="w-full min-w-[46rem] text-left text-sm">
              <caption className="sr-only">Elenco dei prestiti</caption>
              <thead className="border-b text-muted-foreground">
                <tr>{["Libro", "Destinatario", "Dal", "Previsto", "Restituito", "Durata", "Stato"].map((h) => <th key={h} scope="col" className="p-3 font-semibold">{h}</th>)}</tr>
              </thead>
              <tbody>
                {data.items.map((l) => (
                  <tr key={l.id} className="border-b last:border-0 align-top">
                    <td className="p-3"><Link to="/catalogo/$id" params={{ id: l.bookId }} className="text-primary underline">{l.bookTitle}</Link></td>
                    <td className="p-3">{l.borrower}{l.contact && <span className="block text-xs text-muted-foreground">{l.contact}</span>}</td>
                    <td className="p-3">{fmtDate(l.loanDate)}</td>
                    <td className="p-3">{fmtDate(l.dueDate)}</td>
                    <td className="p-3">{fmtDate(l.returnedDate)}</td>
                    <td className="p-3">{durationText(l)}</td>
                    <td className="p-3"><LoanPill value={l.state} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <nav aria-label="Pagine" className="mt-4 flex items-center justify-between gap-2">
              <Button variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Precedente</Button>
              <span className="text-sm">Pagina {page} di {pages}</span>
              <Button variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>Successiva</Button>
            </nav>
          )}
        </>
      )}
    </>
  );
}
