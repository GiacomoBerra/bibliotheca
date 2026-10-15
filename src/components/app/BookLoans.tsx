import { useState } from "react";
import { HandHelping, Undo2 } from "lucide-react";
import { ErrorBox, Loading } from "@/components/app/common";
import { LoanPill, durationText, fmtDate } from "@/components/app/LoanBits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBooksApi } from "@/lib/api/BooksApiContext";
import { LOAN_LIMITS, addDays, isIsoDate, todayIso } from "@/lib/api/loans";
import { useAsync } from "@/lib/useAsync";

/** Scheda «Prestiti» del dettaglio libro. L'admin gestisce; il visualizzatore vede stato e date, senza dati personali. */
export function BookLoans({ bookId, isAdmin }: { bookId: string; isAdmin: boolean }) {
  const api = useBooksApi();
  const { data, error, loading, reload } = useAsync(() => api.listBookLoans(bookId), [api, bookId]);
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <section aria-labelledby="prestiti" className="mt-8 rounded-lg border bg-card p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 id="prestiti" className="flex items-center gap-2 text-xl font-semibold"><HandHelping className="h-5 w-5" aria-hidden /> Prestiti</h2>
        {data && <p className="flex items-center gap-2 text-sm">Stato attuale: <LoanPill value={data.availability} /></p>}
      </div>
      {msg && <p role="status" className="mb-4 text-sm">{msg}</p>}
      {error ? <ErrorBox message={error} onRetry={reload} /> : loading && !data ? <Loading label="Caricamento prestiti…" /> : data && (
        <>
          {isAdmin && (() => {
            const active = data.loans.find((l) => l.returnedDate === null);
            return active
              ? <ReturnForm loanId={active.id} loanDate={active.loanDate} borrower={active.borrower ?? ""} dueDate={active.dueDate} onDone={(m) => { setMsg(m); reload(); }} />
              : <NewLoanForm bookId={bookId} onDone={(m) => { setMsg(m); reload(); }} />;
          })()}
          <h3 className="mb-2 mt-6 text-lg font-semibold">Storico dei prestiti</h3>
          {!isAdmin && <p className="mb-2 text-xs text-muted-foreground">Per la privacy, nome e recapiti di chi ha preso in prestito il libro sono visibili solo agli amministratori.</p>}
          {data.loans.length === 0 ? <p className="text-sm text-muted-foreground">Questo libro non è mai stato prestato.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-left text-sm">
                <caption className="sr-only">Storico dei prestiti, dal più recente</caption>
                <thead className="border-b text-muted-foreground">
                  <tr>{["Destinatario", "Dal", "Previsto", "Restituito", "Durata", "Stato"].map((h) => <th key={h} scope="col" className="py-2 pr-3 font-semibold">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {data.loans.map((l) => (
                    <tr key={l.id} className="border-b last:border-0 align-top">
                      <td className="py-2 pr-3">
                        {l.borrower ?? <span className="text-muted-foreground">riservato</span>}
                        {l.contact && <span className="block text-xs text-muted-foreground">{l.contact}</span>}
                        {l.notes && <span className="block text-xs text-muted-foreground">{l.notes}</span>}
                      </td>
                      <td className="py-2 pr-3">{fmtDate(l.loanDate)}</td>
                      <td className="py-2 pr-3">{fmtDate(l.dueDate)} <span className="text-xs text-muted-foreground">({l.plannedDays} gg)</span></td>
                      <td className="py-2 pr-3">{fmtDate(l.returnedDate)}</td>
                      <td className="py-2 pr-3">{durationText(l)}</td>
                      <td className="py-2"><LoanPill value={l.state} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function NewLoanForm({ bookId, onDone }: { bookId: string; onDone: (msg: string) => void }) {
  const api = useBooksApi();
  const today = todayIso();
  const [borrower, setBorrower] = useState("");
  const [contact, setContact] = useState("");
  const [loanDate, setLoanDate] = useState(today);
  const [days, setDays] = useState(String(LOAN_LIMITS.defaultDays));
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const n = Number(days);
  const due = isIsoDate(loanDate) && Number.isInteger(n) && n >= 1 && n <= LOAN_LIMITS.maxDays ? addDays(loanDate, n) : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!borrower.trim()) { setErr("Indica il nome di chi riceve il libro."); return; }
    setBusy(true);
    try {
      await api.createLoan(bookId, { borrower, contact, loanDate, plannedDays: n, notes });
      onDone(`Prestito registrato a ${borrower.trim()}.`);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Prestito non registrato.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-3 rounded-md border bg-background p-4" aria-label="Registra un nuovo prestito">
      <h3 className="text-lg font-semibold">Registra un prestito</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><Label htmlFor="ln-borrower">Destinatario *</Label><Input id="ln-borrower" value={borrower} maxLength={LOAN_LIMITS.borrower} onChange={(e) => setBorrower(e.target.value)} /></div>
        <div><Label htmlFor="ln-contact">Recapito (facoltativo)</Label><Input id="ln-contact" value={contact} maxLength={LOAN_LIMITS.contact} onChange={(e) => setContact(e.target.value)} aria-describedby="ln-contact-h" /><p id="ln-contact-h" className="mt-1 text-xs text-muted-foreground">Compila solo se serve davvero per rintracciare la persona.</p></div>
        <div><Label htmlFor="ln-date">Data del prestito</Label><Input id="ln-date" type="date" value={loanDate} max={today} onChange={(e) => setLoanDate(e.target.value)} /></div>
        <div><Label htmlFor="ln-days">Durata prevista (giorni)</Label><Input id="ln-days" type="number" min={1} max={LOAN_LIMITS.maxDays} value={days} onChange={(e) => setDays(e.target.value)} /></div>
      </div>
      <div><Label htmlFor="ln-notes">Note (facoltative)</Label><Input id="ln-notes" value={notes} maxLength={LOAN_LIMITS.notes} onChange={(e) => setNotes(e.target.value)} /></div>
      <p className="text-sm" aria-live="polite">Restituzione prevista: <strong>{due ? fmtDate(due) : "—"}</strong></p>
      {err && <ErrorBox message={err} />}
      <Button type="submit" disabled={busy}>{busy ? "Registrazione…" : "Registra il prestito"}</Button>
    </form>
  );
}

function ReturnForm({ loanId, loanDate, borrower, dueDate, onDone }: { loanId: string; loanDate: string; borrower: string; dueDate: string; onDone: (msg: string) => void }) {
  const api = useBooksApi();
  const today = todayIso();
  const [date, setDate] = useState(today);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await api.returnLoan(loanId, date);
      onDone("Restituzione registrata: il prestito resta nello storico.");
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Restituzione non registrata.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-3 rounded-md border bg-background p-4" aria-label="Registra la restituzione">
      <h3 className="text-lg font-semibold">Prestito in corso</h3>
      <p className="text-sm">Il libro è in prestito a <strong>{borrower}</strong> dal {fmtDate(loanDate)}; restituzione prevista il {fmtDate(dueDate)}.</p>
      <div className="max-w-xs"><Label htmlFor="rt-date">Data di restituzione</Label><Input id="rt-date" type="date" value={date} min={loanDate} max={today} onChange={(e) => setDate(e.target.value)} /></div>
      {err && <ErrorBox message={err} />}
      <Button type="submit" disabled={busy}><Undo2 aria-hidden /> {busy ? "Registrazione…" : "Registra la restituzione"}</Button>
    </form>
  );
}
