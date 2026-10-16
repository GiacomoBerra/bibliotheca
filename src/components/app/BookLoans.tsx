import { useState } from "react";
import { HandHelping, Library, Undo2 } from "lucide-react";
import { ErrorBox, Loading } from "@/components/app/common";
import { LoanPill, durationText, fmtDate } from "@/components/app/LoanBits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBooksApi } from "@/lib/api/BooksApiContext";
import { COPY_LIMITS, LOAN_LIMITS, REASON_LIMITS, addDays, daysBetween, isIsoDate, todayIso, type BookCopy, type Loan } from "@/lib/api/loans";
import { useAsync } from "@/lib/useAsync";

type Panel = null | "new" | { kind: "return" | "void" | "undo"; loan: Loan };
const copyName = (c: { copyNo: number; inventoryCode?: string | null }) => `copia n. ${c.copyNo}${c.inventoryCode ? ` (${c.inventoryCode})` : ""}`;
const when = (iso: string) => `${fmtDate(iso.slice(0, 10))} ${iso.slice(11, 16)}`;

/** Scheda «Prestiti» del dettaglio libro. L'admin gestisce; il visualizzatore vede stato e date, senza dati personali. */
export function BookLoans({ bookId, bookTitle, isAdmin }: { bookId: string; bookTitle: string; isAdmin: boolean }) {
  const api = useBooksApi();
  const { data, error, loading, reload } = useAsync(async () => { const [h, copies] = await Promise.all([api.listBookLoans(bookId), api.listCopies(bookId)]); return { ...h, copies }; }, [api, bookId]);
  const [msg, setMsg] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const done = (m: string) => { setMsg(m); setPanel(null); reload(); };

  const live = data?.loans.filter((l) => !l.voidedAt) ?? [];
  const actives = live.filter((l) => l.returnedDate === null);
  const copies = data?.copies ?? [];
  const multi = copies.length > 1;
  const free = copies.filter((c) => c.state === "disponibile");

  return (
    <section aria-labelledby="prestiti" id="prestiti-sezione" className="mt-8 rounded-lg border bg-card p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 id="prestiti" className="flex items-center gap-2 text-xl font-semibold"><HandHelping className="h-5 w-5" aria-hidden /> Prestiti</h2>
        {data && <p className="flex items-center gap-2 text-sm">Stato attuale: <LoanPill value={data.availability} /></p>}
      </div>
      {msg && <p role="status" className="mb-4 text-sm">{msg}</p>}
      {error ? <ErrorBox message={error} onRetry={reload} /> : loading && !data ? <Loading label="Caricamento prestiti…" /> : data && (
        <>
          <CopiesPanel bookId={bookId} copies={copies} isAdmin={isAdmin} onChanged={(m) => done(m)} />
          {isAdmin && actives.map((a) => <div key={a.id} className="mb-3"><ActivePanel loan={a} multi={multi} panel={panel} setPanel={setPanel} bookTitle={bookTitle} onDone={done} /></div>)}
          {isAdmin && free.length > 0 && <AvailablePanel panel={panel} setPanel={setPanel} bookId={bookId} bookTitle={bookTitle} free={free} multi={multi} onDone={done} />}
          {isAdmin && typeof panel === "object" && panel && panel.kind !== "return" && (
            <CorrectionPanel key={`${panel.kind}-${panel.loan.id}`} kind={panel.kind} loan={panel.loan} bookTitle={bookTitle} onCancel={() => setPanel(null)} onDone={done} />
          )}
          {!isAdmin && (
            <p className="text-sm">{multi ? `${free.length} di ${copies.length} copie disponibili.` : data.availability === "disponibile" ? "Il libro è disponibile." : "Il libro è attualmente in prestito."}</p>
          )}
          <h3 className="mb-2 mt-6 text-lg font-semibold">Storico dei prestiti</h3>
          {!isAdmin && <p className="mb-2 text-xs text-muted-foreground">Per la privacy, nome e recapiti di chi ha preso in prestito il libro sono visibili solo agli amministratori.</p>}
          {data.loans.length === 0 ? <p className="text-sm text-muted-foreground">Questo libro non è mai stato prestato.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-left text-sm">
                <caption className="sr-only">Storico dei prestiti, dal più recente</caption>
                <thead className="border-b text-muted-foreground">
                  <tr>{[...(multi ? ["Copia"] : []), "Destinatario", "Dal", "Previsto", "Restituito", "Durata", "Stato"].map((h) => <th key={h} scope="col" className="py-2 pr-3 font-semibold">{h}</th>)}{isAdmin && <th scope="col" className="py-2 font-semibold">Correzioni</th>}</tr>
                </thead>
                <tbody>
                  {data.loans.map((l) => {
                    const hasLater = live.some((x) => x.id !== l.id && x.loanDate >= l.loanDate);
                    return (
                      <tr key={l.id} className="border-b last:border-0 align-top">
                        {multi && <td className="py-2 pr-3">n. {l.copyNo}</td>}
                        <td className="py-2 pr-3">
                          {l.borrower ?? <span className="text-muted-foreground">riservato</span>}
                          {l.contact && <span className="block text-xs text-muted-foreground">{l.contact}</span>}
                          {l.notes && <span className="block text-xs text-muted-foreground">{l.notes}</span>}
                          {l.voidedAt && isAdmin && <span className="block text-xs text-muted-foreground">Annullato il {when(l.voidedAt)}{l.voidReason ? `: ${l.voidReason}` : ""}</span>}
                        </td>
                        <td className="py-2 pr-3">{fmtDate(l.loanDate)}</td>
                        <td className="py-2 pr-3">{fmtDate(l.dueDate)} <span className="text-xs text-muted-foreground">({l.plannedDays} gg)</span></td>
                        <td className="py-2 pr-3">{fmtDate(l.returnedDate)}</td>
                        <td className="py-2 pr-3">{durationText(l)}</td>
                        <td className="py-2 pr-3"><LoanPill value={l.state} /></td>
                        {isAdmin && (
                          <td className="py-2">
                            <div className="flex flex-col items-start gap-1">
                              {!l.voidedAt && l.returnedDate && !hasLater && (
                                <Button type="button" variant="outline" size="sm" aria-label={`Annulla registrazione della restituzione (${l.borrower ?? ""}, dal ${fmtDate(l.loanDate)})`} onClick={() => setPanel({ kind: "undo", loan: l })}>Annulla registrazione della restituzione</Button>
                              )}
                              {!l.voidedAt && l.returnedDate && (
                                <Button type="button" variant="outline" size="sm" aria-label={`Annulla prestito registrato per errore (${l.borrower ?? ""}, dal ${fmtDate(l.loanDate)})`} onClick={() => setPanel({ kind: "void", loan: l })}>Annulla prestito registrato per errore</Button>
                              )}
                              {l.correctionCount > 0 && <CorrectionLog loanId={l.id} count={l.correctionCount} />}
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function AvailablePanel({ panel, setPanel, bookId, bookTitle, free, multi, onDone }: { panel: Panel; setPanel: (p: Panel) => void; bookId: string; bookTitle: string; free: BookCopy[]; multi: boolean; onDone: (m: string) => void }) {
  return (
    <div className="space-y-3 rounded-md border bg-background p-4">
      <p className="text-lg font-semibold">{multi ? `Copie disponibili: ${free.map((c) => `n. ${c.copyNo}`).join(", ")}` : "Libro disponibile"}</p>
      {panel === "new"
        ? <NewLoanFlow bookId={bookId} bookTitle={bookTitle} free={free} multi={multi} onCancel={() => setPanel(null)} onDone={onDone} />
        : <Button type="button" onClick={() => setPanel("new")}><HandHelping aria-hidden /> Registra prestito</Button>}
    </div>
  );
}

function NewLoanFlow({ bookId, bookTitle, free, multi, onCancel, onDone }: { bookId: string; bookTitle: string; free: BookCopy[]; multi: boolean; onCancel: () => void; onDone: (msg: string) => void }) {
  const api = useBooksApi();
  const today = todayIso();
  const [borrower, setBorrower] = useState("");
  const [contact, setContact] = useState("");
  const [loanDate, setLoanDate] = useState(today);
  const [days, setDays] = useState(String(LOAN_LIMITS.defaultDays));
  const [due, setDue] = useState(addDays(today, LOAN_LIMITS.defaultDays));
  const [notes, setNotes] = useState("");
  const [copyNo, setCopyNo] = useState(String(free[0]?.copyNo ?? 1));
  const [step, setStep] = useState<"form" | "review">("form");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const n = Number(days);

  function changeDays(v: string) { setDays(v); const k = Number(v); if (isIsoDate(loanDate) && Number.isInteger(k) && k >= 1 && k <= LOAN_LIMITS.maxDays) setDue(addDays(loanDate, k)); }
  function changeDue(v: string) { setDue(v); if (isIsoDate(v) && isIsoDate(loanDate)) { const k = daysBetween(loanDate, v); if (k >= 1 && k <= LOAN_LIMITS.maxDays) setDays(String(k)); } }
  function changeLoanDate(v: string) { setLoanDate(v); if (isIsoDate(v) && Number.isInteger(n) && n >= 1 && n <= LOAN_LIMITS.maxDays) setDue(addDays(v, n)); }

  function check(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!borrower.trim()) return setErr("Indica il nome di chi riceve il libro.");
    if (!isIsoDate(loanDate) || loanDate > today) return setErr("La data del prestito non è valida o è nel futuro.");
    if (!Number.isInteger(n) || n < 1 || n > LOAN_LIMITS.maxDays) return setErr(`La durata prevista deve essere un numero intero di giorni da 1 a ${LOAN_LIMITS.maxDays}.`);
    if (!isIsoDate(due) || due !== addDays(loanDate, n)) return setErr("La data prevista di restituzione deve seguire la data del prestito (durata da 1 a 365 giorni).");
    setStep("review");
  }
  async function save() {
    setErr(null);
    setBusy(true);
    try {
      await api.createLoan(bookId, { borrower, contact, loanDate, plannedDays: n, notes, ...(multi ? { copyNo: Number(copyNo) } : {}) });
      onDone(`Prestito registrato a ${borrower.trim()}.`);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Prestito non registrato.");
    } finally {
      setBusy(false);
    }
  }

  if (step === "review") {
    return (
      <div className="space-y-3" role="group" aria-label="Verifica del prestito">
        <h3 className="text-lg font-semibold">Verifica i dati del prestito</h3>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Libro</dt><dd>{bookTitle}{multi && `, ${copyName(free.find((c) => c.copyNo === Number(copyNo)) ?? { copyNo: Number(copyNo) })}`}</dd>
          <dt className="text-muted-foreground">Destinatario</dt><dd>{borrower.trim()}{contact.trim() && <span className="block text-xs text-muted-foreground">{contact.trim()}</span>}</dd>
          <dt className="text-muted-foreground">Data del prestito</dt><dd>{fmtDate(loanDate)}</dd>
          <dt className="text-muted-foreground">Durata prevista</dt><dd>{n} {n === 1 ? "giorno" : "giorni"}</dd>
          <dt className="text-muted-foreground">Restituzione prevista</dt><dd>{fmtDate(due)}</dd>
          {notes.trim() && (<><dt className="text-muted-foreground">Note</dt><dd>{notes.trim()}</dd></>)}
        </dl>
        {err && <ErrorBox message={err} />}
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={busy} onClick={() => void save()}>{busy ? "Registrazione…" : "Conferma e registra il prestito"}</Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => setStep("form")}>Modifica i dati</Button>
        </div>
      </div>
    );
  }
  return (
    <form onSubmit={check} className="space-y-3" aria-label="Registra un nuovo prestito" noValidate>
      <h3 className="text-lg font-semibold">Registra un prestito</h3>
      {multi && (
        <div className="max-w-xs"><Label htmlFor="ln-copy">Copia da prestare *</Label>
          <select id="ln-copy" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={copyNo} onChange={(e) => setCopyNo(e.target.value)}>
            {free.map((c) => <option key={c.copyNo} value={c.copyNo}>{copyName(c)}</option>)}
          </select>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div><Label htmlFor="ln-borrower">Destinatario *</Label><Input id="ln-borrower" value={borrower} maxLength={LOAN_LIMITS.borrower} onChange={(e) => setBorrower(e.target.value)} /></div>
        <div><Label htmlFor="ln-contact">Recapito (facoltativo)</Label><Input id="ln-contact" value={contact} maxLength={LOAN_LIMITS.contact} onChange={(e) => setContact(e.target.value)} aria-describedby="ln-contact-h" /><p id="ln-contact-h" className="mt-1 text-xs text-muted-foreground">Compila solo se serve davvero per rintracciare la persona.</p></div>
        <div><Label htmlFor="ln-date">Data del prestito</Label><Input id="ln-date" type="date" value={loanDate} max={today} onChange={(e) => changeLoanDate(e.target.value)} /></div>
        <div><Label htmlFor="ln-days">Durata prevista (giorni)</Label><Input id="ln-days" type="number" min={1} max={LOAN_LIMITS.maxDays} value={days} onChange={(e) => changeDays(e.target.value)} /></div>
        <div><Label htmlFor="ln-due">Restituzione prevista</Label><Input id="ln-due" type="date" value={due} min={isIsoDate(loanDate) ? addDays(loanDate, 1) : undefined} onChange={(e) => changeDue(e.target.value)} aria-describedby="ln-due-h" /><p id="ln-due-h" className="mt-1 text-xs text-muted-foreground">Si aggiorna con la durata, e viceversa.</p></div>
      </div>
      <div><Label htmlFor="ln-notes">Note (facoltative)</Label><Input id="ln-notes" value={notes} maxLength={LOAN_LIMITS.notes} onChange={(e) => setNotes(e.target.value)} /></div>
      {err && <ErrorBox message={err} />}
      <div className="flex flex-wrap gap-2">
        <Button type="submit">Verifica i dati</Button>
        <Button type="button" variant="outline" onClick={onCancel}>Annulla</Button>
      </div>
    </form>
  );
}

function ActivePanel({ loan, multi, panel, setPanel, bookTitle, onDone }: { loan: Loan; multi: boolean; panel: Panel; setPanel: (p: Panel) => void; bookTitle: string; onDone: (m: string) => void }) {
  return (
    <div className="space-y-3 rounded-md border bg-background p-4">
      <p className="flex flex-wrap items-center gap-2 text-lg font-semibold">{multi ? `Copia n. ${loan.copyNo} in prestito` : "Libro in prestito"} <LoanPill value={loan.state} /></p>
      <p className="text-sm">{multi ? `La copia n. ${loan.copyNo}` : "Il libro"} è in prestito a <strong>{loan.borrower}</strong>.</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Data del prestito</dt><dd>{fmtDate(loan.loanDate)}</dd>
        <dt className="text-muted-foreground">Durata prevista</dt><dd>{loan.plannedDays} {loan.plannedDays === 1 ? "giorno" : "giorni"}</dd>
        <dt className="text-muted-foreground">Restituzione prevista</dt><dd>{fmtDate(loan.dueDate)}{loan.daysLate > 0 && <span className="ml-2 font-medium text-destructive">in ritardo di {loan.daysLate} {loan.daysLate === 1 ? "giorno" : "giorni"}</span>}</dd>
        {loan.contact && (<><dt className="text-muted-foreground">Recapito</dt><dd>{loan.contact}</dd></>)}
        {loan.notes && (<><dt className="text-muted-foreground">Note</dt><dd>{loan.notes}</dd></>)}
      </dl>
      {typeof panel === "object" && panel?.kind === "return" && panel.loan.id === loan.id
        ? <ReturnFlow loan={loan} bookTitle={bookTitle} onCancel={() => setPanel(null)} onDone={onDone} />
        : (
          <>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => setPanel({ kind: "return", loan })} aria-label={multi ? `Registra restituzione della copia n. ${loan.copyNo}` : undefined}><Undo2 aria-hidden /> Registra restituzione</Button>
              <Button type="button" variant="outline" onClick={() => setPanel({ kind: "void", loan })} aria-label={multi ? `Annulla prestito registrato per errore (copia n. ${loan.copyNo})` : undefined}>Annulla prestito registrato per errore</Button>
            </div>
            <p className="text-xs text-muted-foreground">Un nuovo prestito di questa copia si potrà registrare dopo la restituzione.</p>
          </>
        )}
    </div>
  );
}

function ReturnFlow({ loan, bookTitle, onCancel, onDone }: { loan: Loan; bookTitle: string; onCancel: () => void; onDone: (msg: string) => void }) {
  const api = useBooksApi();
  const today = todayIso();
  const [date, setDate] = useState(today);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const valid = isIsoDate(date) && date >= loan.loanDate && date <= today;
  const eff = valid ? daysBetween(loan.loanDate, date) : null;
  const late = valid ? Math.max(0, daysBetween(loan.dueDate, date)) : 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!valid) return setErr(`La data di restituzione deve essere compresa tra il ${fmtDate(loan.loanDate)} e oggi.`);
    setBusy(true);
    try {
      await api.returnLoan(loan.id, date);
      onDone("Restituzione registrata: il prestito resta nello storico.");
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Restituzione non registrata.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-3 border-t pt-3" aria-label="Registra la restituzione" noValidate>
      <h3 className="text-lg font-semibold">Registra la restituzione</h3>
      <div className="max-w-xs"><Label htmlFor="rt-date">Data effettiva di restituzione</Label><Input id="rt-date" type="date" value={date} min={loan.loanDate} max={today} onChange={(e) => setDate(e.target.value)} aria-describedby="rt-h" /><p id="rt-h" className="mt-1 text-xs text-muted-foreground">Preimpostata a oggi: cambiala se il libro è tornato un giorno prima.</p></div>
      <div className="rounded-md bg-muted p-3 text-sm" aria-live="polite">
        <p className="font-medium">Riepilogo prima di confermare</p>
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="text-muted-foreground">Libro</dt><dd>{bookTitle}</dd>
          <dt className="text-muted-foreground">Destinatario</dt><dd>{loan.borrower}</dd>
          <dt className="text-muted-foreground">Restituzione effettiva</dt><dd>{valid ? fmtDate(date) : "—"}</dd>
          <dt className="text-muted-foreground">Durata effettiva</dt><dd>{eff === null ? "—" : `${eff} ${eff === 1 ? "giorno" : "giorni"}${late > 0 ? ` (${late} di ritardo)` : ""}`}</dd>
        </dl>
      </div>
      {err && <ErrorBox message={err} />}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>{busy ? "Registrazione…" : "Conferma restituzione"}</Button>
        <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>Annulla</Button>
      </div>
    </form>
  );
}

function CorrectionPanel({ kind, loan, bookTitle, onCancel, onDone }: { kind: "void" | "undo"; loan: Loan; bookTitle: string; onCancel: () => void; onDone: (m: string) => void }) {
  const api = useBooksApi();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isVoid = kind === "void";
  const title = isVoid ? "Annulla prestito registrato per errore" : "Annulla registrazione della restituzione";
  const effect = isVoid
    ? loan.returnedDate
      ? "Il prestito resterà nello storico come «annullato», con motivo, data e autore della correzione. Non conta più come prestito; lo stato attuale del libro non cambia."
      : "Il prestito resterà nello storico come «annullato», con motivo, data e autore della correzione. La copia tornerà disponibile e si potrà registrare un nuovo prestito."
    : `Il prestito tornerà «in prestito» (restituzione prevista il ${fmtDate(loan.dueDate)}) e la copia risulterà di nuovo non disponibile. La data di restituzione registrata (${fmtDate(loan.returnedDate)}) resta solo nella traccia delle correzioni. L'operazione è bloccata se la copia è stata prestata di nuovo.`;
  const ok = reason.trim().length >= REASON_LIMITS.min;

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!ok) return setErr(`Indica brevemente il motivo della correzione (almeno ${REASON_LIMITS.min} caratteri).`);
    setBusy(true);
    try {
      if (isVoid) await api.voidLoan(loan.id, reason.trim()); else await api.undoLoanReturn(loan.id, reason.trim());
      onDone(isVoid ? "Prestito annullato: resta nello storico come «annullato»." : "Restituzione annullata: il prestito risulta di nuovo in corso.");
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Correzione non eseguita.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void confirm(e)} className="mt-4 space-y-3 rounded-md border-2 border-destructive/40 bg-background p-4" aria-label={title} noValidate>
      <h3 className="text-lg font-semibold">{title}</h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Libro</dt><dd>{bookTitle}</dd>
        <dt className="text-muted-foreground">Destinatario</dt><dd>{loan.borrower}</dd>
        <dt className="text-muted-foreground">Prestito dal</dt><dd>{fmtDate(loan.loanDate)}</dd>
        <dt className="text-muted-foreground">Restituito il</dt><dd>{fmtDate(loan.returnedDate)}</dd>
      </dl>
      <p className="text-sm"><strong>Effetto:</strong> {effect}</p>
      <div><Label htmlFor="co-reason">Motivo della correzione (obbligatorio)</Label><Input id="co-reason" value={reason} maxLength={REASON_LIMITS.max} onChange={(e) => setReason(e.target.value)} placeholder="Es. libro sbagliato, data errata" /></div>
      {err && <ErrorBox message={err} />}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="destructive" disabled={busy || !ok}>{busy ? "Correzione…" : isVoid ? "Conferma: annulla il prestito" : "Conferma: annulla la restituzione"}</Button>
        <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>Non correggere</Button>
      </div>
    </form>
  );
}

/** Traccia delle correzioni di un prestito (caricata solo quando si apre). */
function CorrectionLog({ loanId, count }: { loanId: string; count: number }) {
  const api = useBooksApi();
  const [open, setOpen] = useState(false);
  const { data, error, loading, reload } = useAsync(() => (open ? api.listLoanCorrections(loanId) : Promise.resolve(null)), [api, loanId, open, count]);
  return (
    <div>
      <Button type="button" variant="link" size="sm" className="h-auto p-0" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Nascondi la traccia" : `Traccia delle correzioni (${count})`}</Button>
      {open && (error ? <ErrorBox message={error} onRetry={reload} /> : loading && !data ? <Loading label="Caricamento…" /> : (
        <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
          {data?.map((c) => (
            <li key={c.id}>
              <strong>{c.action === "annulla_prestito" ? "Prestito annullato" : "Restituzione annullata"}</strong> il {when(c.correctedAt)} da {c.correctedBy}: «{c.reason}». Prima: {c.before.state}{c.before.returnedDate ? ` (restituito il ${fmtDate(c.before.returnedDate)})` : ""}; dopo: {c.after.state}.
            </li>
          ))}
        </ul>
      ))}
    </div>
  );
}

/** Copie fisiche del libro: tutti le vedono (senza dati personali); l'admin ne aggiunge e corregge codice e note. Le copie non si cancellano. */
function CopiesPanel({ bookId, copies, isAdmin, onChanged }: { bookId: string; copies: BookCopy[]; isAdmin: boolean; onChanged: (m: string) => void }) {
  const api = useBooksApi();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<BookCopy | null>(null);
  const [code, setCode] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const reset = () => { setAdding(false); setEditing(null); setCode(""); setNote(""); setErr(null); };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      if (editing) {
        await api.updateCopy(editing.id!, { inventoryCode: code, notes: note });
        reset(); onChanged(`Dati della ${copyName(editing)} aggiornati.`);
      } else {
        const c = await api.addCopy(bookId, { inventoryCode: code, notes: note });
        reset(); onChanged(`Aggiunta la copia n. ${c.copyNo}.`);
      }
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Operazione non riuscita.");
    } finally { setBusy(false); }
  }
  const startEdit = (c: BookCopy) => { setAdding(false); setEditing(c); setCode(c.inventoryCode ?? ""); setNote(c.notes ?? ""); setErr(null); };

  return (
    <div className="mb-6 rounded-md border bg-background p-4">
      <h3 className="mb-2 flex items-center gap-2 text-lg font-semibold"><Library className="h-4 w-4" aria-hidden /> Copie fisiche ({copies.length})</h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[28rem] text-left text-sm">
          <caption className="sr-only">Copie fisiche del libro</caption>
          <thead className="border-b text-muted-foreground"><tr>{["Copia", "Codice di inventario", "Stato", "Note"].map((h) => <th key={h} scope="col" className="py-2 pr-3 font-semibold">{h}</th>)}{isAdmin && <th scope="col" className="py-2 font-semibold"><span className="sr-only">Azioni</span></th>}</tr></thead>
          <tbody>
            {copies.map((c) => (
              <tr key={c.copyNo} className="border-b align-top last:border-0">
                <td className="py-2 pr-3">n. {c.copyNo}</td>
                <td className="py-2 pr-3">{c.inventoryCode ?? <span className="text-muted-foreground">—</span>}</td>
                <td className="py-2 pr-3"><LoanPill value={c.state === "disponibile" ? "disponibile" : c.state === "in ritardo" ? "in ritardo" : "in prestito"} />{c.dueDate && <span className="block text-xs text-muted-foreground">entro il {fmtDate(c.dueDate)}</span>}</td>
                <td className="py-2 pr-3">{c.notes ?? <span className="text-muted-foreground">—</span>}</td>
                {isAdmin && <td className="py-2">{c.id !== null && <Button type="button" variant="outline" size="sm" aria-label={`Modifica codice e note della copia n. ${c.copyNo}`} onClick={() => startEdit(c)}>Modifica</Button>}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {isAdmin && !adding && !editing && <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => setAdding(true)}>Aggiungi una copia</Button>}
      {isAdmin && (adding || editing) && (
        <form onSubmit={(e) => void save(e)} className="mt-3 space-y-3 border-t pt-3" aria-label={editing ? `Modifica la ${copyName(editing)}` : "Aggiungi una copia"} noValidate>
          <h4 className="font-semibold">{editing ? `Modifica la copia n. ${editing.copyNo}` : "Nuova copia"}</h4>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label htmlFor="cp-code">Codice di inventario (facoltativo)</Label><Input id="cp-code" value={code} maxLength={COPY_LIMITS.code} onChange={(e) => setCode(e.target.value)} aria-describedby="cp-code-h" /><p id="cp-code-h" className="mt-1 text-xs text-muted-foreground">Deve essere unico nella biblioteca.</p></div>
            <div><Label htmlFor="cp-note">Note (facoltative)</Label><Input id="cp-note" value={note} maxLength={COPY_LIMITS.notes} onChange={(e) => setNote(e.target.value)} placeholder="es. scaffale B, dorso rovinato" /></div>
          </div>
          {err && <ErrorBox message={err} />}
          <div className="flex flex-wrap gap-2"><Button type="submit" disabled={busy}>{busy ? "Salvataggio…" : editing ? "Salva" : "Aggiungi la copia"}</Button><Button type="button" variant="outline" disabled={busy} onClick={reset}>Annulla</Button></div>
        </form>
      )}
      <p className="mt-3 text-xs text-muted-foreground">Le copie non si cancellano: i loro prestiti restano nello storico.</p>
    </div>
  );
}
