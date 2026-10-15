import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, ExternalLink, XCircle } from "lucide-react";
import { PageHeader } from "@/components/app/common";
import { Button } from "@/components/ui/button";
import { diagnose, EXERCISES, LESSONS, TOPIC_LABELS, type DiagnoseExercise, type Exercise, type Topic } from "@/lib/didattica/content";
import { GLOSSARY } from "@/lib/marc/glossary";
import { toReadableText } from "@/lib/marc/structure";

export const Route = createFileRoute("/_app/didattica")({
  head: () => ({
    meta: [
      { title: "Modalità didattica — Bibliotheca" },
      { name: "description", content: "Lezioni, esercizi e spiegazioni per imparare catalogazione, MARC21, soggettazione e Dewey." },
    ],
  }),
  component: Didattica,
});

function Didattica() {
  const [topic, setTopic] = useState<Topic | "tutti">("tutti");
  const [results, setResults] = useState<Record<string, boolean>>({});
  const list = useMemo(() => EXERCISES.filter((e) => topic === "tutti" || e.topic === topic), [topic]);
  const done = Object.keys(results).length, right = Object.values(results).filter(Boolean).length;

  return (
    <>
      <PageHeader title="Modalità didattica" description="Lezioni brevi, un esplora-campi MARC 21 e esercizi con spiegazione di ogni risposta." />
      <div role="note" className="mb-8 rounded-md border bg-warning p-4 text-sm text-warning-foreground">
        <strong>Limiti, dichiarati.</strong> Le regole sui campi MARC 21 qui riportate (nove campi: 020, 082, 100, 245, 264, 300, 650, 653, 700) provengono dalla documentazione della Library of Congress consultata il 15/10/2026 e ogni esercizio che le usa rimanda alla fonte. Su soggetti, forma dei nomi e numeri Dewey l'app non ha thesauri, archivi d'autorità né tavole DDC: dove la risposta dipende da regole locali o da fonti non disponibili, lo dice e non decide al posto tuo.
      </div>

      <section aria-labelledby="lezioni" className="mb-10">
        <h2 id="lezioni" className="mb-3 text-xl font-semibold">Lezioni</h2>
        <div className="space-y-2">
          {LESSONS.map((l) => (
            <details key={l.id} className="rounded-lg border bg-card p-4">
              <summary className="cursor-pointer font-semibold">{l.title}</summary>
              <div className="mt-3 space-y-2 text-sm">
                {l.paragraphs.map((p, i) => <p key={i}>{p}</p>)}
                {l.source && <p className="text-xs"><a href={l.source.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline">Fonte: {l.source.label} <ExternalLink className="h-3 w-3" aria-hidden /></a></p>}
              </div>
            </details>
          ))}
        </div>
      </section>

      <FieldExplorer />

      <section aria-labelledby="esercizi" className="mt-10">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <h2 id="esercizi" className="text-xl font-semibold">Esercizi</h2>
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 text-sm">
            <label htmlFor="argomento">Argomento</label>
            <select id="argomento" value={topic} onChange={(e) => setTopic(e.target.value as Topic | "tutti")} className="h-9 min-w-0 max-w-full rounded-md border border-input bg-background px-3 text-base shadow-sm md:text-sm">
              <option value="tutti">Tutti</option>
              {(Object.keys(TOPIC_LABELS) as Topic[]).map((t) => <option key={t} value={t}>{TOPIC_LABELS[t]}</option>)}
            </select>
          </div>
        </div>
        <p className="mb-4 text-sm text-muted-foreground" aria-live="polite">Risposte corrette in questa sessione: {right} su {done} (il punteggio non viene salvato).</p>
        <ol className="space-y-4">
          {list.map((ex) => <li key={ex.id}><ExerciseCard ex={ex} onResult={(ok) => setResults((r) => ({ ...r, [ex.id]: ok }))} /></li>)}
        </ol>
      </section>
    </>
  );
}

function FieldExplorer() {
  const tags = Object.keys(GLOSSARY).sort();
  const [tag, setTag] = useState(tags[0]!);
  const g = GLOSSARY[tag]!;
  const ind = (x: { meaning: string; values: Record<string, string> }) => (
    <>
      <p className="font-medium">{x.meaning}</p>
      <ul className="list-inside list-disc text-muted-foreground">{Object.entries(x.values).map(([k, v]) => <li key={k}><code className="font-mono">{k === " " ? "spazio" : k}</code> — {v}</li>)}</ul>
    </>
  );
  return (
    <section aria-labelledby="campi" className="rounded-lg border bg-card p-5">
      <h2 id="campi" className="mb-3 text-xl font-semibold">Esplora un campo MARC 21</h2>
      <div className="mb-3 flex min-w-0 flex-wrap items-center gap-2 text-sm">
        <label htmlFor="campo-tag">Campo</label>
        <select id="campo-tag" value={tag} onChange={(e) => setTag(e.target.value)} className="h-9 min-w-0 max-w-full rounded-md border border-input bg-background px-3 text-base shadow-sm md:text-sm">
          {tags.map((t) => <option key={t} value={t}>{t} — {GLOSSARY[t]!.name}</option>)}
        </select>
      </div>
      <div className="space-y-3 text-sm" aria-live="polite">
        <p><strong>{g.tag} {g.name}</strong> — {g.repeatable ? "campo ripetibile" : "campo NON ripetibile"}</p>
        <div><span className="font-semibold">Primo indicatore.</span> {ind(g.ind1)}</div>
        <div><span className="font-semibold">Secondo indicatore.</span> {ind(g.ind2)}</div>
        <div>
          <p className="font-semibold">Sottocampi</p>
          <ul className="list-inside list-disc text-muted-foreground">{g.subfields.map((s) => <li key={s.code}><code className="font-mono">${s.code}</code> {s.name} — {s.repeatable ? "ripetibile" : "non ripetibile"}</li>)}</ul>
        </div>
        {g.note && <p className="rounded border border-dashed p-2 text-muted-foreground"><strong>Nota didattica (non normativa):</strong> {g.note}</p>}
        <a href={g.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline">Fonte ufficiale (Library of Congress, consultata il 15/10/2026) <ExternalLink className="h-3 w-3" aria-hidden /></a>
      </div>
    </section>
  );
}

function Feedback({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <div role="status" className={`mt-3 rounded-md border p-3 text-sm ${ok ? "border-primary/40 bg-primary/5" : "border-destructive/40 bg-destructive/5"}`}>
      <p className="mb-1 flex items-center gap-2 font-semibold">{ok ? <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden /> : <XCircle className="h-4 w-4 text-destructive" aria-hidden />}{ok ? "Risposta corretta." : "Non è la risposta giusta."}</p>
      {children}
    </div>
  );
}

function ExerciseCard({ ex, onResult }: { ex: Exercise; onResult: (ok: boolean) => void }) {
  return (
    <article className="rounded-lg border bg-card p-5" aria-labelledby={`q-${ex.id}`}>
      <p className="mb-1 text-xs font-medium text-muted-foreground">{TOPIC_LABELS[ex.topic]}</p>
      {ex.kind === "choice" ? <ChoiceCard ex={ex} onResult={onResult} /> : <DiagnoseCard ex={ex} onResult={onResult} />}
    </article>
  );
}

function ChoiceCard({ ex, onResult }: { ex: Extract<Exercise, { kind: "choice" }>; onResult: (ok: boolean) => void }) {
  const [sel, setSel] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const ok = sel === ex.correct;
  return (
    <fieldset>
      <legend id={`q-${ex.id}`} className="mb-2 font-semibold">{ex.prompt}</legend>
      <div className="space-y-1">
        {ex.options.map((o) => (
          <label key={o.id} className="flex cursor-pointer items-start gap-2 text-sm">
            <input type="radio" name={ex.id} value={o.id} checked={sel === o.id} disabled={checked} onChange={() => setSel(o.id)} className="mt-1" />
            <span>{o.text}</span>
          </label>
        ))}
      </div>
      {!checked && <Button className="mt-3" size="sm" disabled={!sel} onClick={() => { setChecked(true); onResult(sel === ex.correct); }}>Verifica la risposta</Button>}
      {checked && (
        <Feedback ok={ok}>
          {!ok && <p>La risposta corretta è: <strong>{ex.options.find((o) => o.id === ex.correct)!.text}</strong></p>}
          <p>{ex.explain}</p>
          {ex.caveat && <p className="mt-1 text-muted-foreground"><strong>Attenzione:</strong> {ex.caveat}</p>}
          {ex.source && <p className="mt-1 text-xs"><a href={ex.source.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline">Fonte: {ex.source.label} <ExternalLink className="h-3 w-3" aria-hidden /></a></p>}
        </Feedback>
      )}
    </fieldset>
  );
}

function DiagnoseCard({ ex, onResult }: { ex: DiagnoseExercise; onResult: (ok: boolean) => void }) {
  const [sel, setSel] = useState("");
  const [checked, setChecked] = useState(false);
  const result = useMemo(() => diagnose(ex), [ex]);
  const ok = Number(sel) === result.count;
  return (
    <div>
      <p id={`q-${ex.id}`} className="mb-2 font-semibold">{ex.prompt}</p>
      <pre className="mb-3 overflow-x-auto rounded bg-code p-3 font-mono text-sm text-code-foreground" aria-label="Campi MARC 21 dell'esercizio">{toReadableText(null, ex.fields)}</pre>
      <p className="-mt-2 mb-3 text-xs text-muted-foreground">I due caratteri dopo il tag sono gli indicatori; «\» sta per uno spazio (indicatore non definito).</p>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor={`n-${ex.id}`}>Numero di avvisi</label>
        <select id={`n-${ex.id}`} value={sel} disabled={checked} onChange={(e) => setSel(e.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-base shadow-sm md:text-sm">
          <option value="">Scegli…</option>
          {[0, 1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        {!checked && <Button size="sm" disabled={sel === ""} onClick={() => { setChecked(true); onResult(Number(sel) === result.count); }}>Verifica la risposta</Button>}
      </div>
      {!checked && <p className="mt-2 text-xs text-muted-foreground">Suggerimento: {ex.hint}</p>}
      {checked && (
        <Feedback ok={ok}>
          <p>Il controllo strutturale dell'editor MARC21 segnala <strong>{result.count}</strong> {result.count === 1 ? "avviso" : "avvisi"}.</p>
          {result.messages.length > 0 && <ul className="mt-1 list-inside list-disc">{result.messages.map((m, i) => <li key={i}>{m}</li>)}</ul>}
          {ex.topic === "formale" && <p className="mt-2 text-muted-foreground"><strong>Da ricordare:</strong> il controllo guarda la FORMA del record. Se il titolo non corrisponde al frontespizio, o se un soggetto o un numero Dewey non sono adatti al libro, nessun avviso apparirà: questo si verifica confrontando il record con il libro e con le fonti autorevoli, non con l'app.</p>}
        </Feedback>
      )}
    </div>
  );
}
