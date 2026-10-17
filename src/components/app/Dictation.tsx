import { Mic, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSpeechRecognition } from "@/lib/speech";
import type { SpeechLang } from "@/lib/sources/spoken";

/**
 * Dettatura in un singolo campo di testo. Compare solo se il browser supporta il riconoscimento vocale;
 * l'ascolto parte solo quando si preme il pulsante.
 */
export function DictationButton({ lang, label, onText }: { lang: SpeechLang; label: string; onText: (text: string) => void }) {
  const s = useSpeechRecognition(lang, onText);
  if (!s.supported) return null;
  return (
    <span className="inline-flex items-center gap-2">
      <Button type="button" variant="outline" size="sm" aria-pressed={s.listening} aria-label={s.listening ? `Interrompi la dettatura: ${label}` : `Detta: ${label}`} onClick={s.listening ? s.stop : s.start}>
        {s.listening ? <Square aria-hidden /> : <Mic aria-hidden />}
        <span className="sr-only sm:not-sr-only">{s.listening ? "Interrompi" : "Detta"}</span>
      </Button>
      {s.listening && <span role="status" className="text-xs text-destructive">Ascolto attivo…</span>}
      {s.error && <span role="alert" className="text-xs text-destructive">{s.error}</span>}
    </span>
  );
}
