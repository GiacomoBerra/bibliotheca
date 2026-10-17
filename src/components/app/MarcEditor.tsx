import { useState } from "react";
import { ArrowDown, ArrowUp, Copy, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { IllustrativeNote } from "@/components/app/common";
import { checkStructure, isControlTag, isDataField, toReadableText, LEADER_LENGTH } from "@/lib/marc/structure";
import { checkKnownRules, RULES } from "@/lib/marc/rules";
import { GLOSSARY } from "@/lib/marc/glossary";
import { compareWithGeneral, generateFromGeneral, mergeGenerated } from "@/lib/marc/fromBook";
import type { BookInput, MarcField } from "@/lib/api/types";

/** Intestazione iniziale: schema di 24 caratteri comune ai record di monografie a stampa; i valori vanno verificati dal catalogatore. */
export const LEADER_TEMPLATE = "00000nam a2200000   4500";

interface Props {
  leader: string | null;
  fields: MarcField[] | null;
  book: BookInput;
  onChange(leader: string | null, fields: MarcField[] | null): void;
}

const move = <T,>(arr: T[], i: number, d: number): T[] => {
  const j = i + d;
  if (j < 0 || j >= arr.length) return arr;
  const c = arr.slice();
  [c[i], c[j]] = [c[j]!, c[i]!];
  return c;
};

export function MarcEditor({ leader, fields, book, onChange }: Props) {
  const [preview, setPreview] = useState<ReturnType<typeof generateFromGeneral> | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  if (fields === null && leader === null) {
    return (
      <section aria-labelledby="marc-h" className="space-y-3 rounded-lg border p-4">
        <h2 id="marc-h" className="text-xl font-semibold">Record MARC21</h2>
        <p className="text-sm text-muted-foreground">Questa scheda non ha ancora un record MARC21. Puoi crearne uno vuoto e compilarlo campo per campo.</p>
        <Button type="button" variant="outline" onClick={() => onChange(LEADER_TEMPLATE, [])}><Plus aria-hidden /> Crea un record MARC21</Button>
      </section>
    );
  }
  const list = fields ?? [];
  const set = (next: MarcField[]) => onChange(leader, next);
  const upd = (i: number, f: MarcField) => set(list.map((x, k) => (k === i ? f : x)));
  const issues = [...checkStructure(leader, list), ...checkKnownRules(list)];
  const mismatches = compareWithGeneral(book, list);
  const unknownTags = [...new Set(list.map((f) => f.tag).filter((t) => !RULES[t] && !isControlTag(t)))];

  return (
    <section aria-labelledby="marc-h" className="space-y-4 rounded-lg border p-4">
      <h2 id="marc-h" className="text-xl font-semibold">Record MARC21</h2>
      <p className="text-sm text-muted-foreground">
        <IllustrativeNote>Validità strutturale ≠ correttezza catalografica</IllustrativeNote> I controlli verificano la forma del record (tag, indicatori, sottocampi). Le regole di ripetibilità, indicatori e sottocampi sono incluse solo per i campi {Object.keys(RULES).join(", ")} (fonte: pagine MARC 21 della Library of Congress, consultate il 15/10/2026). Per gli altri campi l'app non conosce le regole e non le controlla.
      </p>

      <div className="space-y-1.5">
        <Label htmlFor="marc-leader">Intestazione (leader, {LEADER_LENGTH} caratteri)</Label>
        <Input id="marc-leader" className="font-mono" value={leader ?? ""} maxLength={LEADER_LENGTH + 10} onChange={(e) => onChange(e.target.value, fields)} aria-describedby="marc-leader-d" />
        <p id="marc-leader-d" className="text-xs text-muted-foreground">{(leader ?? "").length}/{LEADER_LENGTH} caratteri. Il modello iniziale è solo un punto di partenza: controlla ogni posizione.</p>
      </div>

      <ol className="space-y-3" aria-label="Campi del record">
        {list.map((f, i) => (
          <li key={i} className="space-y-2 rounded-md border p-3" aria-label={`Campo ${i + 1}`}>
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-20">
                <Label htmlFor={`m${i}-tag`}>Tag</Label>
                <Input id={`m${i}-tag`} className="font-mono" value={f.tag} maxLength={3} onChange={(e) => upd(i, { ...f, tag: e.target.value })} />
              </div>
              {isDataField(f) && (
                <>
                  <div className="w-16">
                    <Label htmlFor={`m${i}-i1`}>Ind. 1</Label>
                    <Input id={`m${i}-i1`} className="font-mono" value={f.ind1 === " " ? "" : f.ind1} maxLength={1} placeholder="␣" onChange={(e) => upd(i, { ...f, ind1: e.target.value || " " })} />
                  </div>
                  <div className="w-16">
                    <Label htmlFor={`m${i}-i2`}>Ind. 2</Label>
                    <Input id={`m${i}-i2`} className="font-mono" value={f.ind2 === " " ? "" : f.ind2} maxLength={1} placeholder="␣" onChange={(e) => upd(i, { ...f, ind2: e.target.value || " " })} />
                  </div>
                </>
              )}
              {!isDataField(f) && (
                <div className="min-w-48 flex-1">
                  <Label htmlFor={`m${i}-v`}>Valore (campo di controllo)</Label>
                  <Input id={`m${i}-v`} className="font-mono" value={f.value} onChange={(e) => upd(i, { ...f, value: e.target.value })} />
                </div>
              )}
              <div className="ml-auto flex flex-wrap gap-1">
                <Button type="button" size="icon" variant="outline" aria-label={`Sposta su il campo ${i + 1}`} disabled={i === 0} onClick={() => set(move(list, i, -1))}><ArrowUp aria-hidden /></Button>
                <Button type="button" size="icon" variant="outline" aria-label={`Sposta giù il campo ${i + 1}`} disabled={i === list.length - 1} onClick={() => set(move(list, i, 1))}><ArrowDown aria-hidden /></Button>
                <Button type="button" size="icon" variant="outline" aria-label={`Duplica il campo ${i + 1}`} onClick={() => set([...list.slice(0, i + 1), JSON.parse(JSON.stringify(f)) as MarcField, ...list.slice(i + 1)])}><Copy aria-hidden /></Button>
                <Button type="button" size="icon" variant="outline" aria-label={`Elimina il campo ${i + 1}`} onClick={() => set(list.filter((_, k) => k !== i))}><Trash2 aria-hidden /></Button>
              </div>
            </div>
            {isDataField(f) && (
              <div className="space-y-2">
                {f.subfields.map((s, j) => (
                  <div key={j} className="flex flex-wrap items-end gap-2">
                    <div className="w-16">
                      <Label htmlFor={`m${i}-s${j}-c`}>$ codice</Label>
                      <Input id={`m${i}-s${j}-c`} className="font-mono" value={s.code} maxLength={1} onChange={(e) => upd(i, { ...f, subfields: f.subfields.map((x, k) => (k === j ? { ...x, code: e.target.value } : x)) })} />
                    </div>
                    <div className="min-w-48 flex-1">
                      <Label htmlFor={`m${i}-s${j}-v`}>Valore del sottocampo {j + 1}</Label>
                      <Input id={`m${i}-s${j}-v`} value={s.value} onChange={(e) => upd(i, { ...f, subfields: f.subfields.map((x, k) => (k === j ? { ...x, value: e.target.value } : x)) })} />
                    </div>
                    <Button type="button" size="icon" variant="outline" aria-label={`Sposta su il sottocampo ${j + 1} del campo ${i + 1}`} disabled={j === 0} onClick={() => upd(i, { ...f, subfields: move(f.subfields, j, -1) })}><ArrowUp aria-hidden /></Button>
                    <Button type="button" size="icon" variant="outline" aria-label={`Sposta giù il sottocampo ${j + 1} del campo ${i + 1}`} disabled={j === f.subfields.length - 1} onClick={() => upd(i, { ...f, subfields: move(f.subfields, j, 1) })}><ArrowDown aria-hidden /></Button>
                    <Button type="button" size="icon" variant="outline" aria-label={`Elimina il sottocampo ${j + 1} del campo ${i + 1}`} onClick={() => upd(i, { ...f, subfields: f.subfields.filter((_, k) => k !== j) })}><Trash2 aria-hidden /></Button>
                  </div>
                ))}
                <Button type="button" size="sm" variant="outline" onClick={() => upd(i, { ...f, subfields: [...f.subfields, { code: "a", value: "" }] })}><Plus aria-hidden /> Aggiungi sottocampo al campo {i + 1}</Button>
              </div>
            )}
            <FieldHelpBox field={f} index={i} />
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => set([...list, { tag: "", ind1: " ", ind2: " ", subfields: [{ code: "a", value: "" }] }])}><Plus aria-hidden /> Aggiungi campo dati</Button>
        <Button type="button" variant="outline" onClick={() => set([...list, { tag: "", value: "" }])}><Plus aria-hidden /> Aggiungi campo di controllo</Button>
        <Button type="button" variant="outline" onClick={() => setPreview(generateFromGeneral(book))}>Genera campi dai dati generali…</Button>
        {!confirmRemove && <Button type="button" variant="outline" onClick={() => setConfirmRemove(true)}>Rimuovi il record MARC21…</Button>}
      </div>

      {confirmRemove && (
        <div role="alertdialog" aria-label="Conferma rimozione del record MARC21" className="space-y-2 rounded-md border border-destructive p-3 text-sm">
          <p>Vuoi eliminare tutto il record MARC21 di questa scheda? Il record viene rimosso solo quando salvi la scheda.</p>
          <div className="flex gap-2">
            <Button type="button" variant="destructive" size="sm" onClick={() => { onChange(null, null); setConfirmRemove(false); }}>Sì, rimuovi il record</Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setConfirmRemove(false)}>Annulla</Button>
          </div>
        </div>
      )}

      {preview && (
        <div role="region" aria-label="Anteprima dei campi generati" className="space-y-2 rounded-md border p-3 text-sm">
          <p className="font-medium">Verranno sostituiti i campi 020, 100, 245, 264, 300, 653 e 700 con questi (gli altri restano invariati):</p>
          <pre className="overflow-x-auto rounded bg-muted p-2 font-mono text-xs">{toReadableText(null, preview.fields) || "(nessun campo: i dati generali sono vuoti; i campi elencati sopra verranno rimossi)"}</pre>
          {preview.notes.length > 0 && <ul className="list-disc pl-5 text-muted-foreground">{preview.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={() => { set(mergeGenerated(list, preview.fields)); setPreview(null); }}>Applica al record</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setPreview(null)}>Annulla</Button>
          </div>
        </div>
      )}

      {mismatches.length > 0 && (
        <div role="status" className="rounded-md border border-warning p-3 text-sm">
          <p className="font-medium">Dati generali e MARC non coincidono:</p>
          <ul className="list-disc pl-5">{mismatches.map((m) => <li key={m}>{m}</li>)}</ul>
          <p className="text-muted-foreground">Nessuno dei due è modificato automaticamente: correggi quello sbagliato oppure usa «Genera campi dai dati generali».</p>
        </div>
      )}

      {issues.length > 0 && (
        <div aria-label="Controlli sul record" className="space-y-1 text-sm">
          <p className="font-medium">Controlli ({issues.filter((i) => i.level === "errore").length} errori, {issues.filter((i) => i.level === "avviso").length} avvisi)</p>
          <ul className="list-disc pl-5">
            {issues.map((i, k) => <li key={k} className={i.level === "errore" ? "text-destructive" : "text-muted-foreground"}><strong>{i.level === "errore" ? "Errore" : "Avviso"}:</strong> {i.message}</li>)}
          </ul>
        </div>
      )}
      {unknownTags.length > 0 && <p className="text-xs text-muted-foreground">Campi senza regole nell'app (solo controllo strutturale): {unknownTags.join(", ")}.</p>}

      <details>
        <summary className="cursor-pointer text-sm font-medium">Visualizzazione leggibile del record</summary>
        <pre aria-label="Record in forma testuale" className="mt-2 overflow-x-auto rounded bg-muted p-2 font-mono text-xs">{toReadableText(leader, list)}</pre>
        <p className="text-xs text-muted-foreground">Rappresentazione testuale a scopo di lettura: non è un file ISO 2709 né MARCXML.</p>
      </details>
    </section>
  );
}

/** Spiegazione contestuale del campo (solo per i campi documentati nel glossario, dalle pagine MARC 21 della LC). */
function FieldHelpBox({ field, index }: { field: MarcField; index: number }) {
  const g = GLOSSARY[field.tag];
  if (!g) return null;
  const d = isDataField(field) ? field : null;
  const meaning = (x: { values: Record<string, string> }, v: string) => (x.values[v] ?? (v >= "1" && v <= "9" ? x.values["1–9"] : undefined));
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-primary">Che cos'è il campo {g.tag}? (spiegazione didattica)</summary>
      <div className="mt-2 space-y-1 rounded bg-muted/50 p-3" aria-label={`Spiegazione del campo ${index + 1}`}>
        <p><strong>{g.tag} {g.name}</strong>: {g.repeatable ? "ripetibile" : "non ripetibile"}.</p>
        {d && (
          <>
            <p>Indicatore 1 ({g.ind1.meaning}): {meaning(g.ind1, d.ind1) ?? <em>valore non previsto dalla documentazione consultata</em>}.</p>
            <p>Indicatore 2 ({g.ind2.meaning}): {meaning(g.ind2, d.ind2) ?? <em>valore non previsto dalla documentazione consultata</em>}.</p>
            <ul className="list-inside list-disc">
              {d.subfields.map((s, j) => {
                const sf = g.subfields.find((x) => x.code === s.code);
                return <li key={j}><code className="font-mono">${s.code}</code>: {sf ? `${sf.name} (${sf.repeatable ? "ripetibile" : "non ripetibile"})` : "non descritto qui: consulta la documentazione"}</li>;
              })}
            </ul>
          </>
        )}
        {g.note && <p className="text-muted-foreground">Nota didattica: {g.note}</p>}
        <a href={g.url} target="_blank" rel="noreferrer" className="text-primary underline">Fonte ufficiale (LC, consultata il 15/10/2026)</a>
      </div>
    </details>
  );
}
