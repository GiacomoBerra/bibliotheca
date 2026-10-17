import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorBox } from "@/components/app/common";
import { MarcEditor } from "@/components/app/MarcEditor";
import { checkStructure } from "@/lib/marc/structure";
import type { MarcField } from "@/lib/api/types";
import { BookLookup } from "@/components/app/BookLookup";
import { DictationButton } from "@/components/app/Dictation";
import { undoImport, type ImportField, type ImportResult } from "@/lib/sources/importPlan";
import type { SpeechLang } from "@/lib/sources/spoken";
import { Plus, Trash2 } from "lucide-react";
import { BOOK_STATUSES, DEWEY_SOURCES, DEWEY_SOURCE_LABELS, type BookInput, type BookStatus, type DeweySource } from "@/lib/api/types";
import { LIMITS, validateBook, warnings, type FieldErrors } from "@/lib/api/validation";

export const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
const textareaClass =
  "min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

const LIMITS_ITEM = 500;
const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);

interface Props {
  initial: BookInput;
  submitLabel: string;
  onSubmit: (input: BookInput) => Promise<void>;
  onCancel: () => void;
}

export function BookForm({ initial, submitLabel, onSubmit, onCancel }: Props) {
  const uid = useId();
  const [f, setF] = useState({
    title: initial.title, authors: initial.authors.join("\n"), isbn: initial.isbn, publisher: initial.publisher,
    publicationPlace: initial.publicationPlace, publicationYear: initial.publicationYear, language: initial.language,
    physicalDescription: initial.physicalDescription, notes: initial.notes, dewey: initial.dewey, deweyNotes: initial.deweyNotes, deweySource: initial.deweySource as DeweySource | "", shelfMark: initial.shelfMark, status: initial.status as BookStatus,
  });
  const [mode, setMode] = useState<"assistita" | "manuale">("assistita");
  const [subs, setSubs] = useState<string[]>(initial.subjects.length ? initial.subjects : [""]);
  const [marc, setMarc] = useState<{ leader: string | null; fields: MarcField[] | null }>({ leader: initial.marcLeader, fields: initial.marcFields });
  const [dictLang, setDictLang] = useState<SpeechLang>("it");
  const [prov, setProv] = useState<Partial<Record<ImportField, string>>>({});
  const [lastImport, setLastImport] = useState<ImportResult["applied"] | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));

  const toInput = (): BookInput => ({
    title: f.title, authors: lines(f.authors), isbn: f.isbn, publisher: f.publisher, publicationPlace: f.publicationPlace,
    publicationYear: f.publicationYear, language: f.language, physicalDescription: f.physicalDescription, notes: f.notes,
    subjects: subs.map((x) => x.trim()).filter(Boolean), dewey: f.dewey, deweyNotes: f.deweyNotes, deweySource: f.deweySource, shelfMark: f.shelfMark, status: f.status,
    marcLeader: marc.leader, marcFields: marc.fields,
  });
  const current = toInput();

  /** Riporta nel modulo i soli campi importati (MARC, Dewey, collocazione e stato non vengono mai toccati). */
  const fromInput = (b: BookInput) => ({
    title: b.title, authors: b.authors.join("\n"), isbn: b.isbn, publisher: b.publisher, publicationPlace: b.publicationPlace,
    publicationYear: b.publicationYear, language: b.language, physicalDescription: b.physicalDescription, notes: b.notes,
  });
  const applyImport = (res: ImportResult) => {
    setF((s) => ({ ...s, ...fromInput(res.next) }));
    setSubs(res.next.subjects.length ? res.next.subjects : [""]);
    setLastImport(res.applied.length ? res.applied : null);
    setProv(Object.fromEntries(res.applied.map((a) => [a.field, a.sources.join(", ")])));
  };
  const undo = () => {
    if (!lastImport) return;
    const undone = undoImport(toInput(), lastImport);
    setF((s) => ({ ...s, ...fromInput(undone) }));
    setSubs(undone.subjects.length ? undone.subjects : [""]);
    setProv({});
    setLastImport(null);
  };
  /** Aggiunge testo dettato a un campo: le liste (autori, soggetti) vanno a capo, gli altri campi si accodano con uno spazio. */
  const dictate = (k: "title" | "authors" | "publisher" | "publicationPlace" | "physicalDescription" | "notes") => (text: string) =>
    setF((s) => ({ ...s, [k]: s[k] ? s[k] + (k === "authors" ? "\n" : " ") + text : text }));
  const dictateSubject = (text: string) => setSubs((l) => (l.length === 1 && l[0] === "" ? [text] : [...l, text]));
  const errors: FieldErrors = submitted ? validateBook(current) : {};
  const warn = warnings(current);

  async function handle(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    setServerError(null);
    const input = toInput();
    if (Object.keys(validateBook(input)).length > 0) return;
    if (checkStructure(input.marcLeader, input.marcFields).some((i) => i.level === "errore")) {
      setServerError("Il record MARC21 contiene errori strutturali: correggili (vedi «Controlli» nella sezione Record MARC21) prima di salvare.");
      return;
    }
    setBusy(true);
    try {
      await onSubmit(input);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Salvataggio non riuscito.");
    } finally {
      setBusy(false);
    }
  }

  const id = (k: string) => `${uid}-${k}`;
  const field = (k: keyof BookInput, label: string, control: (p: { id: string; "aria-invalid": boolean; "aria-describedby"?: string }) => ReactNode, hint?: string, onDictate?: (text: string) => void) => {
    const err = errors[k];
    const w = !err ? warn[k] : undefined;
    const msg = err ?? w;
    const props = { id: id(k), "aria-invalid": Boolean(err), ...(msg || hint ? { "aria-describedby": `${id(k)}-d` } : {}) };
    return (
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label htmlFor={id(k)}>{label}</Label>
          {onDictate && <DictationButton lang={dictLang} label={label.replace(/\s*\(.*$/, "").replace(" *", "")} onText={onDictate} />}
        </div>
        {control(props)}
        {prov[k as ImportField] && <p className="text-xs text-primary">Importato da {prov[k as ImportField]}: controlla e correggi se serve.</p>}
        {(msg || hint) && (
          <p id={`${id(k)}-d`} className={`text-sm ${err ? "text-destructive" : w ? "text-warning-foreground" : "text-muted-foreground"}`}>{msg ?? hint}</p>
        )}
      </div>
    );
  };

  return (
    <>
    <fieldset className="mb-4 flex flex-wrap gap-4 text-sm">
      <legend className="mb-1 font-medium">Modalità di inserimento</legend>
      <label className="flex items-center gap-2"><input type="radio" name={`${uid}-mode`} checked={mode === "manuale"} onChange={() => setMode("manuale")} /> Inserimento manuale</label>
      <label className="flex items-center gap-2"><input type="radio" name={`${uid}-mode`} checked={mode === "assistita"} onChange={() => setMode("assistita")} /> Ricerca assistita (testo o voce)</label>
    </fieldset>
    {mode === "assistita" && <BookLookup lang={dictLang} onLangChange={setDictLang} current={current} onApply={applyImport} onUndo={undo} canUndo={lastImport !== null} />}
    <form onSubmit={handle} noValidate className="space-y-6">
      <p className="text-sm text-muted-foreground">Solo il titolo è obbligatorio: puoi salvare una scheda incompleta come <strong>bozza</strong> e completarla in seguito.</p>
      {field("title", "Titolo *", (p) => <Input {...p} value={f.title} maxLength={LIMITS.title + 50} onChange={(e) => set("title", e.target.value)} />, undefined, dictate("title"))}
      {field("authors", "Autori (uno per riga, es. «Rossi, Anna»)", (p) => <textarea {...p} className={textareaClass} value={f.authors} onChange={(e) => set("authors", e.target.value)} />, undefined, dictate("authors"))}
      <div className="grid gap-4 sm:grid-cols-2">
        {field("isbn", "ISBN", (p) => <Input {...p} inputMode="text" value={f.isbn} onChange={(e) => set("isbn", e.target.value)} />)}
        {field("publicationYear", "Anno di pubblicazione", (p) => <Input {...p} value={f.publicationYear} onChange={(e) => set("publicationYear", e.target.value)} />, "Testo libero: ammette forme come «c1998» o «[1998?]».")}
        {field("publisher", "Editore", (p) => <Input {...p} value={f.publisher} onChange={(e) => set("publisher", e.target.value)} />, undefined, dictate("publisher"))}
        {field("publicationPlace", "Luogo di pubblicazione", (p) => <Input {...p} value={f.publicationPlace} onChange={(e) => set("publicationPlace", e.target.value)} />, undefined, dictate("publicationPlace"))}
        {field("language", "Lingua", (p) => <Input {...p} value={f.language} onChange={(e) => set("language", e.target.value)} />, "Testo libero (es. «italiano»). Nessuna codifica ufficiale è verificata dall'app.")}
        {field("physicalDescription", "Descrizione fisica", (p) => <Input {...p} value={f.physicalDescription} onChange={(e) => set("physicalDescription", e.target.value)} />, undefined, dictate("physicalDescription"))}
      </div>
      <fieldset className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <legend className="text-sm font-medium leading-none">Soggetti</legend>
          <DictationButton lang={dictLang} label="Soggetto" onText={dictateSubject} />
        </div>
        {subs.map((v, i) => (
          <div key={i} className="flex gap-2">
            <Input aria-label={`Soggetto ${i + 1}`} value={v} maxLength={LIMITS_ITEM} onChange={(e) => setSubs((l) => l.map((x, k) => (k === i ? e.target.value : x)))} />
            <Button type="button" variant="outline" size="icon" aria-label={`Rimuovi il soggetto ${i + 1}`} onClick={() => setSubs((l) => (l.length > 1 ? l.filter((_, k) => k !== i) : [""]))}><Trash2 aria-hidden /></Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={() => setSubs((l) => [...l, ""])}><Plus aria-hidden /> Aggiungi un soggetto</Button>
        <p className="text-sm text-muted-foreground">Testo libero: i soggetti non sono controllati su nessuna fonte d'autorità (thesaurus o elenco di intestazioni).</p>
      </fieldset>
      <details className="rounded-md border p-3 text-sm">
        <summary className="cursor-pointer font-medium">Che differenza c'è fra descrizione, soggetto, classificazione e collocazione?</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
          <li><strong>Descrizione bibliografica</strong>: com'è fatto il libro (titolo, autori, editore, anno, pagine…).</li>
          <li><strong>Soggetto</strong>: di che cosa tratta, espresso a parole.</li>
          <li><strong>Classificazione (Dewey)</strong>: a quale disciplina appartiene, espresso con una notazione numerica.</li>
          <li><strong>Collocazione</strong>: dove si trova fisicamente la copia in biblioteca (può derivare dalla classificazione, ma è un dato locale).</li>
        </ul>
      </details>
      <div className="grid gap-4 sm:grid-cols-2">
        {field("dewey", "Classificazione Dewey", (p) => <Input {...p} className="font-mono" value={f.dewey} onChange={(e) => set("dewey", e.target.value)} />, "Testo libero: la notazione non è verificata sulle tavole DDC.")}
        {field("deweySource", "Origine della proposta Dewey", (p) => (
          <select {...p} className={selectClass} value={f.deweySource} onChange={(e) => set("deweySource", e.target.value as DeweySource | "")}>
            <option value="">Non indicata</option>
            {DEWEY_SOURCES.map((k) => <option key={k} value={k}>{DEWEY_SOURCE_LABELS[k]}</option>)}
          </select>
        ), "Serve a ricordare da dove viene la notazione: non ne attesta la correttezza.")}
      </div>
      {field("deweyNotes", "Annotazioni sulla Dewey (edizione DDC usata, motivazione della scelta)", (p) => <textarea {...p} className={textareaClass} value={f.deweyNotes} onChange={(e) => set("deweyNotes", e.target.value)} />)}
      {field("shelfMark", "Collocazione", (p) => <Input {...p} value={f.shelfMark} onChange={(e) => set("shelfMark", e.target.value)} />, "Dato locale: indica dove si trova fisicamente il libro.")}
      {field("notes", "Note", (p) => <textarea {...p} className={textareaClass} value={f.notes} onChange={(e) => set("notes", e.target.value)} />, undefined, dictate("notes"))}
      {field("status", "Stato della scheda", (p) => (
        <select {...p} className={selectClass} value={f.status} onChange={(e) => set("status", e.target.value as BookStatus)}>
          {BOOK_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      ))}
      <MarcEditor leader={marc.leader} fields={marc.fields} book={current} onChange={(leader, fields) => setMarc({ leader, fields })} />
      {serverError && <ErrorBox message={serverError} />}
      {submitted && Object.keys(errors).length > 0 && <p role="alert" className="text-sm text-destructive">Correggi i campi evidenziati prima di salvare.</p>}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={busy}>{busy ? "Salvataggio…" : submitLabel}</Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>Annulla</Button>
      </div>
    </form>
    </>
  );
}
