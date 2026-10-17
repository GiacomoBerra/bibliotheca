import { useId, useState } from "react";
import { ExternalLink, Mic, RefreshCw, Search, Square, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorBox, Loading } from "@/components/app/common";
import { useBooksApi } from "@/lib/api/BooksApiContext";
import type { BookInput } from "@/lib/api/types";
import { applyPlan, buildPlan, FIELD_LABELS, type ImportResult, type PlanRow, type Selection, type ImportField } from "@/lib/sources/importPlan";
import { parseSpokenRequest, SPEECH_LANGS, type SpeechLang } from "@/lib/sources/spoken";
import type { LookupQuery, LookupResponse, MatchKind, ResultGroup, SourceRecord } from "@/lib/sources/types";
import { PRIVACY_NOTE, useSpeechRecognition } from "@/lib/speech";

const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
const MATCH_LABEL: Record<MatchKind, string> = { esatta: "Corrispondenza esatta (ISBN)", probabile: "Corrispondenza probabile", simile: "Risultato simile" };
const MATCH_CLASS: Record<MatchKind, string> = {
  esatta: "border-success/50 bg-success/10 text-success-foreground", probabile: "border-primary/40 bg-primary/10 text-foreground", simile: "border-border bg-muted text-muted-foreground",
};

interface Props {
  lang: SpeechLang;
  onLangChange(l: SpeechLang): void;
  /** Valori attuali della scheda (per l'anteprima e la protezione dei campi compilati). */
  current: BookInput;
  onApply(result: ImportResult): void;
  /** Annulla l'ultima importazione; restituisce true se ha ripristinato qualcosa. */
  onUndo(): void;
  canUndo: boolean;
}

export function BookLookup({ lang, onLangChange, current, onApply, onUndo, canUndo }: Props) {
  const api = useBooksApi();
  const uid = useId();
  const [text, setText] = useState("");
  const [fields, setFields] = useState({ title: "", author: "", publisher: "", year: "", isbn: "" });
  const [immediate, setImmediate] = useState(false);
  const [state, setState] = useState<{ status: "idle" | "loading" | "done" | "error"; result?: LookupResponse; error?: string; query?: LookupQuery }>({ status: "idle" });
  const [openId, setOpenId] = useState<string | null>(null);
  const [selection, setSelection] = useState<Partial<Record<ImportField, Selection>>>({});
  const [report, setReport] = useState<{ applied: ImportResult["applied"]; notFound: ImportField[] } | null>(null);

  const interpret = (t: string) => setFields(parseSpokenRequest(t, lang) ?? fields);
  const setField = (k: keyof typeof fields, v: string) => setFields((f) => ({ ...f, [k]: v }));

  function buildQuery(t: string, f: typeof fields): LookupQuery {
    if (f.isbn.trim() || f.title.trim()) {
      const q: LookupQuery = {};
      (["isbn", "title", "author", "publisher", "year"] as const).forEach((k) => { if (f[k].trim()) q[k] = f[k].trim(); });
      return q;
    }
    return { q: t.trim() };
  }

  async function search(t = text, f = fields, refresh = false) {
    const q = buildQuery(t, f);
    setOpenId(null);
    setReport(null);
    setState({ status: "loading", query: q });
    try {
      const result = await api.lookupSources(q, { refresh });
      setState({ status: "done", result, query: q });
    } catch (e) {
      setState({ status: "error", error: e instanceof Error ? e.message : "Ricerca non riuscita.", query: q });
    }
  }

  const speech = useSpeechRecognition(lang, (spoken) => {
    setText(spoken);
    const f = parseSpokenRequest(spoken, lang);
    setFields(f);
    if (immediate) void search(spoken, f);
  });

  const canSearch = Boolean(fields.isbn.trim() || fields.title.trim() || text.trim());
  const group = state.result?.groups.find((g) => g.id === openId) ?? null;
  const rows: PlanRow[] = group ? buildPlan(group, current) : [];

  function open(g: ResultGroup) {
    setOpenId(g.id);
    const init: Partial<Record<ImportField, Selection>> = {};
    for (const r of buildPlan(g, current)) init[r.field] = { use: r.defaultUse, choice: 0 };
    setSelection(init);
  }

  function confirm() {
    const res = applyPlan(current, rows, selection);
    onApply(res);
    setReport({ applied: res.applied, notFound: res.notFound });
    setOpenId(null);
  }

  const id = (k: string) => `${uid}-${k}`;

  return (
    <section aria-labelledby={id("h")} className="mb-8 space-y-4 rounded-lg border bg-card p-5">
      <div>
        <h2 id={id("h")} className="text-xl font-semibold">Cerca libro con la voce</h2>
        <p className="mt-1 text-sm text-muted-foreground">Detta o scrivi titolo, autore, editore, anno o ISBN: per esempio «Voglio catalogare Il nome della rosa di Umberto Eco, pubblicato da Bompiani nel 1980». La ricerca parte solo quando la confermi e non modifica il catalogo.</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor={id("lang")}>Lingua della dettatura</Label>
          <select id={id("lang")} className={selectClass} value={lang} onChange={(e) => onLangChange(e.target.value as SpeechLang)}>
            {SPEECH_LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </div>
        {speech.supported ? (
          <Button type="button" variant={speech.listening ? "destructive" : "default"} aria-pressed={speech.listening} onClick={speech.listening ? speech.stop : speech.start}>
            {speech.listening ? <Square aria-hidden /> : <Mic aria-hidden />} {speech.listening ? "Interrompi la registrazione" : "Parla"}
          </Button>
        ) : null}
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" checked={immediate} onChange={(e) => setImmediate(e.target.checked)} /> Cerca subito al termine della dettatura
        </label>
      </div>

      {speech.listening && <p role="status" className="flex items-center gap-2 text-sm font-medium text-destructive"><span className="h-2.5 w-2.5 animate-pulse rounded-full bg-destructive" aria-hidden /> Ascolto attivo: parla ora. {speech.interim && <span className="font-normal text-muted-foreground">«{speech.interim}»</span>}</p>}
      {speech.error && <p role="alert" className="text-sm text-destructive">{speech.error}</p>}
      {!speech.supported && <p role="status" className="text-sm text-muted-foreground">Questo browser non supporta il riconoscimento vocale. Nessun problema: scrivi la richiesta qui sotto, oppure compila direttamente i campi, e cerca come al solito.</p>}
      <p className="text-xs text-muted-foreground">{PRIVACY_NOTE}</p>

      <div className="space-y-1.5">
        <Label htmlFor={id("text")}>Richiesta (puoi correggerla)</Label>
        <textarea id={id("text")} className="min-h-16 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={text} onChange={(e) => setText(e.target.value)} placeholder="Es. Voglio catalogare … di … pubblicato da … nel …" />
        <Button type="button" variant="outline" size="sm" disabled={!text.trim()} onClick={() => interpret(text)}>Interpreta il testo nei campi</Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {([["title", "Titolo da cercare"], ["author", "Autore da cercare"], ["publisher", "Editore da cercare"], ["year", "Anno da cercare"], ["isbn", "ISBN da cercare"]] as const).map(([k, label]) => (
          <div key={k} className="space-y-1.5">
            <Label htmlFor={id(k)}>{label}</Label>
            <Input id={id(k)} value={fields[k]} onChange={(e) => setField(k, e.target.value)} />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-3">
        <Button type="button" disabled={!canSearch || state.status === "loading"} onClick={() => void search()}><Search aria-hidden /> Cerca nelle fonti bibliografiche</Button>
        {state.status === "done" && <Button type="button" variant="outline" onClick={() => void search(text, fields, true)}><RefreshCw aria-hidden /> Ripeti la ricerca (senza cache)</Button>}
      </div>

      <div aria-live="polite" className="space-y-4">
        {state.status === "loading" && <Loading label="Ricerca in corso nelle fonti…" />}
        {state.status === "error" && <ErrorBox message={state.error ?? "Ricerca non riuscita."} onRetry={() => void search()} />}
        {state.status === "done" && state.result && (
          <>
            <ul className="flex flex-wrap gap-2 text-xs" aria-label="Stato delle fonti">
              {state.result.sources.map((s) => (
                <li key={s.id} className={`rounded border px-2 py-1 ${s.status === "ok" ? "" : "border-destructive/50 text-destructive"}`}>
                  <strong>{s.label}</strong>: {s.status === "ok" ? `${s.count} ${s.count === 1 ? "risultato" : "risultati"}${s.cached ? " (dalla cache)" : ""}` : `non disponibile — ${s.message ?? "errore"}`}
                </li>
              ))}
            </ul>
            {state.result.groups.length === 0 ? (
              <p className="rounded-lg border p-4 text-sm">{state.result.sources.every((s) => s.status !== "ok") ? "Nessuna fonte ha risposto: puoi riprovare più tardi o compilare la scheda a mano." : "Nessun risultato. Controlla l'ortografia, prova con meno parole o cerca per ISBN; puoi sempre compilare la scheda a mano."}</p>
            ) : (
              <ul className="grid gap-4 lg:grid-cols-2" aria-label="Risultati">
                {state.result.groups.map((g) => <ResultCard key={g.id} group={g} selected={g.id === openId} onChoose={() => open(g)} />)}
              </ul>
            )}
          </>
        )}
      </div>

      {group && (
        <div role="region" aria-label="Anteprima dell'importazione" className="space-y-4 rounded-lg border-2 border-primary/40 p-4">
          <h3 className="text-lg font-semibold">Anteprima dei dati che saranno importati</h3>
          <p className="text-sm text-muted-foreground">Niente viene scritto finché non premi «Usa questi dati», e anche allora i campi restano modificabili prima del salvataggio. I campi già compilati non vengono toccati se non spunti la riga. {group.records.every((r) => r.granularity === "opera") && <strong>Risultato a livello di opera: si propongono solo titolo, autori e soggetti, perché editore, anno e ISBN potrebbero appartenere a edizioni diverse.</strong>}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead><tr className="border-b text-xs uppercase text-muted-foreground"><th className="py-2 pr-3">Usa</th><th className="pr-3">Campo</th><th className="pr-3">Valore attuale</th><th>Valore proposto e provenienza</th></tr></thead>
              <tbody>
                {rows.map((r) => <PlanRowView key={r.field} row={r} sel={selection[r.field] ?? { use: false, choice: 0 }} onChange={(s) => setSelection((m) => ({ ...m, [r.field]: s }))} />)}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button type="button" onClick={confirm}>Usa questi dati</Button>
            <Button type="button" variant="outline" onClick={() => setOpenId(null)}>Annulla</Button>
          </div>
        </div>
      )}

      {report && (
        <div role="status" className="space-y-2 rounded-lg border bg-accent/40 p-4 text-sm">
          {report.applied.length > 0 ? (
            <>
              <p><strong>Dati importati nella scheda</strong> (modificabili prima di salvare):</p>
              <ul className="list-disc pl-5">{report.applied.map((a) => <li key={a.field}>{FIELD_LABELS[a.field]} — da {a.sources.join(", ")}</li>)}</ul>
            </>
          ) : <p>Nessun campo è stato modificato.</p>}
          {report.notFound.length > 0 && <p>Nessun dato trovato per: {report.notFound.map((f) => FIELD_LABELS[f]).join(", ")}.</p>}
          {canUndo && report.applied.length > 0 && <Button type="button" variant="outline" size="sm" onClick={() => { onUndo(); setReport(null); }}><Undo2 aria-hidden /> Annulla l'importazione</Button>}
        </div>
      )}
    </section>
  );
}

function ResultCard({ group: g, selected, onChoose }: { group: ResultGroup; selected: boolean; onChoose(): void }) {
  const first = g.records[0]!;
  const cover = g.records.find((r) => r.coverUrl)?.coverUrl;
  const pick = <T,>(f: (r: SourceRecord) => T | undefined) => [...new Set(g.records.map(f).filter((x): x is T => x !== undefined && x !== ""))];
  const rec = (label: string, vals: Array<string | number>) => vals.length > 0 && <div><dt className="inline font-medium">{label}: </dt><dd className="inline">{vals.join(" · ")}</dd></div>;
  const desc = g.records.find((r) => r.description)?.description;
  return (
    <li className={`flex gap-4 rounded-lg border bg-background p-4 ${selected ? "ring-2 ring-primary" : ""}`}>
      {cover ? <img src={cover} alt="" className="h-28 w-20 shrink-0 rounded object-cover" loading="lazy" referrerPolicy="no-referrer" /> : <div className="h-28 w-20 shrink-0 rounded bg-muted" aria-hidden />}
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap gap-2 text-xs">
          <span className={`rounded border px-2 py-0.5 font-medium ${MATCH_CLASS[g.match]}`}>{MATCH_LABEL[g.match]}</span>
          {g.incomplete && <span className="rounded border border-warning-foreground/40 px-2 py-0.5 text-warning-foreground">Dati incompleti{g.missing.length ? `: mancano ${g.missing.join(", ")}` : ""}</span>}
          {g.records.every((r) => r.granularity === "opera") && <span className="rounded border px-2 py-0.5">Livello opera</span>}
        </div>
        <h3 className="break-words text-base font-semibold">{first.title}{first.subtitle ? <span className="font-normal text-muted-foreground">: {first.subtitle}</span> : null}</h3>
        <p className="text-xs text-muted-foreground">{g.reason}</p>
        <dl className="space-y-0.5 text-sm">
          {rec("Autori", pick((r) => (r.authors.length ? r.authors.join("; ") : undefined)))}
          {rec("ISBN-13", pick((r) => r.isbn13))}
          {rec("ISBN-10", pick((r) => r.isbn10))}
          {rec("Editore", pick((r) => r.publisher))}
          {rec("Luogo", pick((r) => r.publicationPlace))}
          {rec(g.records.every((r) => r.granularity === "opera") ? "Prima pubblicazione" : "Anno", pick((r) => r.publicationDate))}
          {rec("Lingua", pick((r) => r.language))}
          {rec("Pagine", pick((r) => r.pages))}
          {rec("Soggetti (suggeriti)", pick((r) => (r.subjects.length ? r.subjects.slice(0, 5).join(", ") : undefined)))}
        </dl>
        {desc && <p className="line-clamp-3 text-sm text-muted-foreground">{desc}</p>}
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span>Fonti:</span>
          {g.records.map((r) => r.sourceUrl ? (
            <a key={r.source + r.externalId} href={r.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary underline">{r.sourceLabel} <ExternalLink className="h-3 w-3" aria-hidden /><span className="sr-only">(si apre in una nuova scheda)</span></a>
          ) : <span key={r.source + r.externalId}>{r.sourceLabel}</span>)}
        </p>
        <Button type="button" size="sm" onClick={onChoose} aria-label={`Anteprima e importazione: ${first.title}`}>Anteprima e importazione</Button>
      </div>
    </li>
  );
}

function PlanRowView({ row, sel, onChange }: { row: PlanRow; sel: Selection; onChange(s: Selection): void }) {
  const none = row.candidates.length === 0;
  const cand = row.candidates[sel.choice] ?? row.candidates[0];
  const cid = `plan-${row.field}`;
  return (
    <tr className="border-b align-top">
      <td className="py-2 pr-3">
        <input id={cid} type="checkbox" disabled={none || row.same} checked={sel.use && !none && !row.same} onChange={(e) => onChange({ ...sel, use: e.target.checked })} aria-label={`Usa ${row.label.toLowerCase()}`} />
      </td>
      <td className="pr-3 font-medium"><label htmlFor={cid}>{row.label}</label></td>
      <td className="whitespace-pre-line pr-3 text-muted-foreground">{row.current || "—"}</td>
      <td className="space-y-1">
        {none ? <span className="text-muted-foreground">Nessun dato trovato</span> : (
          <>
            {row.candidates.length > 1 ? (
              <select className={selectClass} aria-label={`Valore per ${row.label.toLowerCase()}`} value={sel.choice} onChange={(e) => onChange({ ...sel, choice: Number(e.target.value) })}>
                {row.candidates.map((c, i) => <option key={c.value} value={i}>{c.value.replace(/\n/g, "; ")} — {c.sources.join(", ")}</option>)}
              </select>
            ) : <span className="whitespace-pre-line">{cand!.value}</span>}
            <p className="text-xs text-muted-foreground">Fonte: {cand!.sources.join(", ")}{cand!.note ? ` — ${cand!.note}` : ""}{row.candidates.length > 1 ? " — le fonti non concordano: scegli il valore corretto." : ""}</p>
            {row.same && <p className="text-xs text-muted-foreground">Già uguale al valore attuale.</p>}
            {row.conflict && <p className="text-xs text-warning-foreground">Il campo è già compilato: spunta «Usa» solo se vuoi sostituirlo.</p>}
          </>
        )}
      </td>
    </tr>
  );
}
