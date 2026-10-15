import { useId, useState } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorBox } from "@/components/app/common";
import { selectClass } from "@/components/app/BookForm";
import { useBooksApi } from "@/lib/api/BooksApiContext";
import { applyRestore, parseBackup, planRestore, relationLabel, type ParsedBackup, type PlanItem, type RestoreResult, type Resolution } from "@/lib/backup";

const readText = (f: File): Promise<string> =>
  typeof f.text === "function"
    ? f.text()
    : new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error("Lettura del file non riuscita. Nulla è stato modificato.")); r.readAsText(f); });

type Loaded = Extract<ParsedBackup, { ok: true }>;

/** Ripristino da backup JSON: file → controllo → anteprima con conflitti → conferma esplicita → esecuzione → esito. Non cancella nulla. */
export function RestorePanel({ onDownloadBackup }: { onDownloadBackup: () => void }) {
  const uid = useId();
  const api = useBooksApi();
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [plan, setPlan] = useState<PlanItem[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<RestoreResult | null>(null);

  async function onFile(file: File | undefined) {
    setError(null); setLoaded(null); setPlan([]); setResult(null); setConfirm(false);
    if (!file) return;
    setBusy("Lettura del file…");
    try {
      const parsed = parseBackup(await readText(file));
      if (!parsed.ok) { setError(parsed.message); return; }
      const existing = await api.listAllBooks();
      setLoaded(parsed);
      setPlan(planRestore(parsed.items, existing));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lettura del file non riuscita. Nulla è stato modificato.");
    } finally {
      setBusy(null);
    }
  }

  const setRes = (i: number, r: Resolution) => setPlan((p) => p.map((x, k) => (k === i ? { ...x, resolution: r } : x)));
  const counts = {
    crea: plan.filter((p) => p.resolution === "crea").length,
    aggiorna: plan.filter((p) => p.resolution === "aggiorna").length,
    salta: plan.filter((p) => p.resolution === "salta").length,
  };
  const conflicts = plan.filter((p) => p.relation !== "nuova");

  async function run() {
    setBusy("Ripristino in corso…"); setError(null);
    try {
      const r = await applyRestore(api, plan, (d, t) => setBusy(`Ripristino in corso… ${d}/${t}`));
      setResult(r); setLoaded(null); setPlan([]); setConfirm(false);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4 rounded-lg border bg-card p-5">
      <p className="flex items-center gap-2 text-sm text-muted-foreground"><Upload className="h-4 w-4" aria-hidden /> Ripristina da un backup JSON creato da Bibliotheca. Il ripristino non cancella nessuna scheda: aggiunge schede nuove o, solo dove scegli «aggiorna», sostituisce i dati di una scheda esistente con quelli del file.</p>
      <div className="space-y-1.5">
        <Label htmlFor={`${uid}-f`}>File di backup (.json)</Label>
        <Input id={`${uid}-f`} type="file" accept=".json,application/json" disabled={busy !== null} onChange={(e) => void onFile(e.target.files?.[0])} />
      </div>
      <div aria-live="polite">{busy && <p role="status" className="text-sm">{busy}</p>}</div>
      {error && <ErrorBox message={error} />}

      {loaded && (
        <section aria-label="Anteprima del ripristino" className="space-y-3">
          <p className="text-sm">
            Il file contiene <strong>{loaded.items.length + loaded.issues.length}</strong> schede{loaded.exportedAt ? ` (esportato il ${loaded.exportedAt.slice(0, 10)})` : ""}:
            {" "}<strong>{loaded.items.length}</strong> valide, <strong>{loaded.issues.length}</strong> con errori (non verranno importate), <strong>{conflicts.length}</strong> in conflitto o duplicate.
          </p>
          {loaded.warnings.map((w) => <p key={w} role="alert" className="text-sm text-destructive">{w}</p>)}
          {loaded.issues.length > 0 && (
            <div className="text-sm">
              <p className="font-medium text-destructive">Schede con errori (escluse):</p>
              <ul className="list-disc pl-5">{loaded.issues.slice(0, 20).map((i) => <li key={i.index}>Scheda {i.index + 1} («{i.title}»): {i.errors.join(" ") || "dati non validi."}</li>)}</ul>
              {loaded.issues.length > 20 && <p className="text-muted-foreground">…e altre {loaded.issues.length - 20}.</p>}
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
          <div className="rounded-md border border-warning p-3 text-sm">
            <p>Con queste scelte: <strong>{counts.crea}</strong> schede create, <strong>{counts.aggiorna}</strong> aggiornate (i dati attuali vengono sostituiti da quelli del file), <strong>{counts.salta}</strong> saltate. Nessuna scheda viene eliminata.</p>
            <p className="mt-1 text-muted-foreground">Prima di procedere conviene scaricare un backup dello stato attuale.</p>
            <Button type="button" variant="outline" size="sm" className="mt-2" onClick={onDownloadBackup}>Scarica il backup attuale</Button>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} className="mt-1" />
            <span>Ho letto le conseguenze e confermo il ripristino con le scelte indicate.</span>
          </label>
          <div className="flex gap-2">
            <Button type="button" disabled={!confirm || busy !== null || counts.crea + counts.aggiorna === 0} onClick={() => void run()}>Ripristina</Button>
            <Button type="button" variant="outline" disabled={busy !== null} onClick={() => { setLoaded(null); setPlan([]); setConfirm(false); }}>Annulla</Button>
          </div>
        </section>
      )}

      {result && (
        <section aria-label="Esito del ripristino" className="space-y-2 text-sm">
          <p role="status"><strong>{result.created}</strong> schede create, <strong>{result.updated}</strong> aggiornate, <strong>{result.skipped}</strong> saltate, <strong>{result.failed.length}</strong> non riuscite.{result.aborted ? " Il ripristino si è interrotto: la sessione è scaduta o non hai i permessi. Quanto già scritto resta nel catalogo." : ""}</p>
          {result.failed.length > 0 && <ul className="list-disc pl-5 text-destructive">{result.failed.slice(0, 20).map((f) => <li key={f.index}>Scheda {f.index + 1} («{f.title}»): {f.message}</li>)}</ul>}
        </section>
      )}
    </div>
  );
}
