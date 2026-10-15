import { useId, useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorBox } from "@/components/app/common";
import { selectClass } from "@/components/app/BookForm";
import { useBooksApi } from "@/lib/api/BooksApiContext";
import { applyLoanRestore, applyRestore, parseBackup, planRestore, relationLabel, type LoanRestoreResult, type ParsedBackup, type PlanItem, type RestoreResult, type Resolution } from "@/lib/backup";
import { csvTemplate, parseCsvCatalog } from "@/lib/csv";
import { downloadText } from "@/lib/export";
import { lookupIsbnList } from "@/lib/isbnImport";
import { testBackupJson, testCatalogCsv } from "@/lib/testData";

const readText = (f: File): Promise<string> =>
  typeof f.text === "function"
    ? f.text()
    : new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error("Lettura del file non riuscita. Nulla è stato modificato.")); r.readAsText(f); });

type Loaded = Extract<ParsedBackup, { ok: true }>;
type Mode = "json" | "csv" | "isbn";
export interface BackupDone { books: number; loans: number }

/**
 * Importazione/ripristino: da backup JSON, da CSV o da elenco di ISBN (ricerca nelle fonti). Flusso comune:
 * sorgente → controllo → anteprima (errori, da controllare, duplicati) → backup verificato → conferma esplicita → scrittura tramite le API autorizzate → esito.
 * Non cancella mai nulla.
 */
export function ImportPanel({ onDownloadBackup }: { onDownloadBackup: () => Promise<BackupDone> }) {
  const uid = useId();
  const api = useBooksApi();
  const [mode, setMode] = useState<Mode>("json");
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [plan, setPlan] = useState<PlanItem[]>([]);
  const [existingCount, setExistingCount] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ books: RestoreResult; loans: LoanRestoreResult | null } | null>(null);
  const [backup, setBackup] = useState<BackupDone | null>(null);
  const [withLoans, setWithLoans] = useState(true);
  const [isbnText, setIsbnText] = useState("");
  const stop = useRef(false);

  const reset = () => { setError(null); setLoaded(null); setPlan([]); setResult(null); setConfirm(false); };

  async function show(parsed: ParsedBackup) {
    if (!parsed.ok) { setError(parsed.message); return; }
    const existing = await api.listAllBooks();
    setExistingCount(existing.length);
    setLoaded(parsed);
    setPlan(planRestore(parsed.items, existing));
    setWithLoans(true);
  }

  async function onFile(file: File | undefined) {
    reset();
    if (!file) return;
    setBusy("Lettura del file…");
    try {
      const text = await readText(file);
      if (mode === "isbn") { setIsbnText(text); return; }
      await show(mode === "csv" ? parseCsvCatalog(text) : parseBackup(text));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lettura del file non riuscita. Nulla è stato modificato.");
    } finally {
      setBusy(null);
    }
  }

  async function searchIsbn() {
    reset();
    stop.current = false;
    try {
      setBusy("Ricerca nelle fonti… (circa 7 secondi per ISBN)");
      const parsed = await lookupIsbnList(api, isbnText, { onProgress: (d, t) => setBusy(`Ricerca nelle fonti… ${d}/${t} (circa 7 secondi per ISBN)`), shouldStop: () => stop.current });
      await show(parsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ricerca non riuscita. Nulla è stato modificato.");
    } finally {
      setBusy(null);
    }
  }

  async function makeBackup() {
    setError(null); setBusy("Preparazione del backup…");
    try { setBackup(await onDownloadBackup()); }
    catch (e) { setError(e instanceof Error ? e.message : "Backup non riuscito."); }
    finally { setBusy(null); }
  }

  const setRes = (i: number, r: Resolution) => setPlan((p) => p.map((x, k) => (k === i ? { ...x, resolution: r } : x)));
  const counts = {
    crea: plan.filter((p) => p.resolution === "crea").length,
    aggiorna: plan.filter((p) => p.resolution === "aggiorna").length,
    salta: plan.filter((p) => p.resolution === "salta").length,
  };
  const conflicts = plan.filter((p) => p.relation !== "nuova");
  const checks = plan.filter((p) => p.item.notes?.length);
  const hasLoans = (loaded?.loans?.length ?? 0) > 0;
  const backupOk = existingCount === 0 || backup !== null;

  async function run() {
    setBusy("Importazione in corso…"); setError(null);
    try {
      const r = await applyRestore(api, plan, (d, t) => setBusy(`Importazione in corso… ${d}/${t}`));
      let lr: LoanRestoreResult | null = null;
      if (hasLoans && withLoans && !r.aborted) lr = await applyLoanRestore(api, loaded!.loans!, r.idMap, (d, t) => setBusy(`Ripristino prestiti… ${d}/${t}`));
      setResult({ books: r, loans: lr }); setLoaded(null); setPlan([]); setConfirm(false);
    } finally {
      setBusy(null);
    }
  }

  const fileLabel = mode === "json" ? "File di backup (.json)" : mode === "csv" ? "File CSV (.csv)" : "Oppure carica un file di testo con gli ISBN (.txt, .csv)";

  return (
    <div className="space-y-4 rounded-lg border bg-card p-5">
      <p className="flex items-center gap-2 text-sm text-muted-foreground"><Upload className="h-4 w-4" aria-hidden /> Importa schede da un backup JSON, da un file CSV o da un elenco di ISBN. L'importazione non cancella nessuna scheda: aggiunge schede nuove o, solo dove scegli «aggiorna», sostituisce i dati di una scheda esistente. Tutto passa dalle API riservate all'amministratore.</p>

      <fieldset className="flex flex-wrap gap-4 text-sm" disabled={busy !== null}>
        <legend className="mb-1 font-medium">Sorgente dei dati</legend>
        {([["json", "Backup JSON (schede e prestiti)"], ["csv", "File CSV (solo schede)"], ["isbn", "Elenco di ISBN (ricerca nelle fonti)"]] as [Mode, string][]).map(([v, l]) => (
          <label key={v} className="flex items-center gap-2"><input type="radio" name={`${uid}-mode`} checked={mode === v} onChange={() => { setMode(v); reset(); }} /> {l}</label>
        ))}
      </fieldset>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => downloadText("bibliotheca-modello-catalogo.csv", csvTemplate(), "text/csv")}><Download aria-hidden /> Scarica il modello CSV</Button>
        <Button type="button" variant="outline" size="sm" onClick={() => downloadText("bibliotheca-PROVA-catalogo.csv", testCatalogCsv(), "text/csv")}><Download aria-hidden /> Scarica il file CSV di prova ([TEST])</Button>
        <Button type="button" variant="outline" size="sm" onClick={() => downloadText("bibliotheca-PROVA-backup.json", testBackupJson(), "application/json")}><Download aria-hidden /> Scarica il file JSON di prova ([TEST], con prestiti)</Button>
      </div>
      <p className="text-xs text-muted-foreground">I file di prova contengono solo record fittizi con titolo «[TEST]»: si importano soltanto se li carichi tu qui sotto. Il modello CSV ha una riga d'esempio che l'importazione rifiuta finché non la elimini.</p>

      {mode === "isbn" && (
        <div className="space-y-2">
          <Label htmlFor={`${uid}-isbn`}>Elenco di ISBN (uno per riga)</Label>
          <textarea id={`${uid}-isbn`} rows={6} value={isbnText} onChange={(e) => setIsbnText(e.target.value)} disabled={busy !== null} className="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm shadow-sm" placeholder={"978…\n978…"} />
          <p className="text-xs text-muted-foreground">Ogni ISBN è cercato in Open Library, Google Books e Library of Congress; si accettano solo corrispondenze esatte. Limiti: circa 10 ricerche al minuto e 150 al giorno. I record entrano come «da revisionare»: i dati delle fonti vanno confrontati con il libro.</p>
          <div className="flex gap-2">
            <Button type="button" disabled={busy !== null || !isbnText.trim()} onClick={() => void searchIsbn()}>Cerca nelle fonti</Button>
            {busy?.startsWith("Ricerca") && <Button type="button" variant="outline" onClick={() => { stop.current = true; }}>Interrompi</Button>}
          </div>
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor={`${uid}-f`}>{fileLabel}</Label>
        <Input id={`${uid}-f`} type="file" accept={mode === "json" ? ".json,application/json" : mode === "csv" ? ".csv,text/csv" : ".txt,.csv,text/plain,text/csv"} disabled={busy !== null} onChange={(e) => void onFile(e.target.files?.[0])} />
      </div>
      <div aria-live="polite">{busy && <p role="status" className="text-sm">{busy}</p>}</div>
      {error && <ErrorBox message={error} />}

      {loaded && (
        <section aria-label="Anteprima del ripristino" className="space-y-3">
          <p className="text-sm">
            Il file contiene <strong>{loaded.items.length + loaded.issues.length}</strong> schede{loaded.exportedAt ? ` (esportato il ${loaded.exportedAt.slice(0, 10)})` : ""}:
            {" "}<strong>{loaded.items.length}</strong> valide, <strong>{loaded.issues.length}</strong> con errori (non verranno importate), <strong>{conflicts.length}</strong> in conflitto o duplicate{hasLoans ? <>; <strong>{loaded.loans!.length}</strong> prestiti nel file</> : null}.
          </p>
          {loaded.warnings.map((w) => <p key={w} role="alert" className="text-sm text-destructive">{w}</p>)}
          {loaded.issues.length > 0 && (
            <div className="text-sm">
              <p className="font-medium text-destructive">Schede con errori (escluse):</p>
              <ul className="list-disc pl-5">{loaded.issues.slice(0, 30).map((i) => <li key={i.index}>{mode === "isbn" ? "" : `Scheda ${i.index + 1} `}(«{i.title}»): {i.errors.join(" ") || "dati non validi."}</li>)}</ul>
              {loaded.issues.length > 30 && <p className="text-muted-foreground">…e altre {loaded.issues.length - 30}.</p>}
            </div>
          )}
          {(loaded.loanIssues?.length ?? 0) > 0 && (
            <div className="text-sm">
              <p className="font-medium text-destructive">Prestiti con errori (esclusi):</p>
              <ul className="list-disc pl-5">{loaded.loanIssues!.slice(0, 20).map((m) => <li key={m}>{m}</li>)}</ul>
            </div>
          )}
          {checks.length > 0 && (
            <div className="text-sm">
              <p className="font-medium">Da controllare (importabili, ma verifica):</p>
              <ul className="list-disc pl-5">{checks.slice(0, 30).map((p) => <li key={p.item.index}><strong>{p.item.input.title}</strong>: {p.item.notes!.join(" ")}</li>)}</ul>
            </div>
          )}
          {conflicts.length > 0 && (
            <div className="space-y-2 text-sm">
              <p className="font-medium">Conflitti e possibili duplicati (di default vengono saltati):</p>
              <ul className="space-y-2">
                {plan.map((p, i) => p.relation === "nuova" ? null : (
                  <li key={i} className="flex flex-wrap items-center gap-2 rounded border p-2">
                    <span className="min-w-48 flex-1"><strong>{p.item.input.title}</strong> — {relationLabel(p.relation)}{p.match ? ` («${p.match.title}»)` : ""}</span>
                    <label className="flex items-center gap-2">
                      <span className="sr-only">Azione per «{p.item.input.title}»</span>
                      <select className={selectClass + " w-auto"} value={p.resolution} onChange={(e) => setRes(i, e.target.value as Resolution)} aria-label={`Azione per «${p.item.input.title}»`}>
                        <option value="salta">Salta (non importare)</option>
                        {p.match && <option value="aggiorna">Aggiorna la scheda esistente</option>}
                        <option value="crea">Crea comunque come nuova</option>
                      </select>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {hasLoans && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={withLoans} onChange={(e) => setWithLoans(e.target.checked)} className="mt-1" />
              <span>Ripristina anche i {loaded.loans!.length} prestiti del file (storico compreso), saltando quelli già presenti. Solo per le schede create, aggiornate o riconosciute come già presenti.</span>
            </label>
          )}
          {!hasLoans && mode === "json" && loaded.version === 1 && <p className="text-sm text-muted-foreground">Questo backup non contiene prestiti.</p>}
          {mode !== "json" && <p className="text-sm text-muted-foreground">Questa sorgente non contiene prestiti né dati MARC21 completi.</p>}

          <div className="rounded-md border border-warning p-3 text-sm">
            <p>Con queste scelte: <strong>{counts.crea}</strong> schede create, <strong>{counts.aggiorna}</strong> aggiornate (i dati attuali vengono sostituiti da quelli del file), <strong>{counts.salta}</strong> saltate. Nessuna scheda viene eliminata.</p>
            <p className="mt-2 font-medium">Backup prima di importare</p>
            {existingCount === 0 ? <p className="text-muted-foreground">Il catalogo è vuoto: non c'è nulla da salvare.</p> : (
              <>
                <p className="text-muted-foreground">Il catalogo contiene {existingCount} schede. Prima di importare scarica un backup completo (schede, copie e prestiti): il programma lo rilegge e ne controlla i conteggi.</p>
                <Button type="button" variant="outline" size="sm" className="mt-2" disabled={busy !== null} onClick={() => void makeBackup()}>Scarica e verifica il backup attuale</Button>
                {backup && <p role="status" className="mt-2">Backup scaricato e verificato: {backup.books} schede e {backup.loans} prestiti. Conservalo fuori da questo browser.</p>}
              </>
            )}
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={confirm} disabled={!backupOk} onChange={(e) => setConfirm(e.target.checked)} className="mt-1" />
            <span>Ho letto le conseguenze e confermo il ripristino con le scelte indicate.</span>
          </label>
          <div className="flex gap-2">
            <Button type="button" disabled={!confirm || !backupOk || busy !== null || counts.crea + counts.aggiorna + (hasLoans && withLoans ? 1 : 0) === 0} onClick={() => void run()}>Ripristina</Button>
            <Button type="button" variant="outline" disabled={busy !== null} onClick={reset}>Annulla</Button>
          </div>
        </section>
      )}

      {result && (
        <section aria-label="Esito del ripristino" className="space-y-2 text-sm">
          <p role="status"><strong>{result.books.created}</strong> schede create, <strong>{result.books.updated}</strong> aggiornate, <strong>{result.books.skipped}</strong> saltate, <strong>{result.books.failed.length}</strong> non riuscite.{result.books.aborted ? " L'importazione si è interrotta: la sessione è scaduta o non hai i permessi. Quanto già scritto resta nel catalogo." : ""}</p>
          {result.books.failed.length > 0 && <ul className="list-disc pl-5 text-destructive">{result.books.failed.slice(0, 20).map((f) => <li key={f.index}>Scheda {f.index + 1} («{f.title}»): {f.message}</li>)}</ul>}
          {result.loans && (
            <>
              <p role="status"><strong>{result.loans.created}</strong> prestiti ripristinati, <strong>{result.loans.duplicates}</strong> già presenti, <strong>{result.loans.noBook}</strong> non collegati a una scheda importata, <strong>{result.loans.failed.length}</strong> non riusciti.</p>
              {result.loans.failed.length > 0 && <ul className="list-disc pl-5 text-destructive">{result.loans.failed.slice(0, 20).map((f) => <li key={f.label}>{f.label}: {f.message}</li>)}</ul>}
            </>
          )}
        </section>
      )}
    </div>
  );
}
