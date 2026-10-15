import { useCallback, useEffect, useRef, useState } from "react";
import { SPEECH_LANGS, type SpeechLang } from "@/lib/sources/spoken";

/** Interfaccia minima di SpeechRecognition (API del browser; non è in tutti i browser). */
interface RecognitionLike {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
}
type Ctor = new () => RecognitionLike;

export const recognitionCtor = (): Ctor | null => {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

export const PRIVACY_NOTE =
  "Il riconoscimento vocale è fornito dal tuo browser. Alcuni browser (per esempio Chrome) inviano l'audio a un servizio remoto del loro produttore per trascriverlo. Bibliotheca non registra e non conserva alcun file audio, e il microfono si attiva solo quando premi il pulsante.";

export function speechErrorMessage(code: string): string | null {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed": return "Il permesso di usare il microfono è stato negato. Consentilo dalle impostazioni del sito nel browser, oppure scrivi la richiesta a mano.";
    case "no-speech": return "Non ho sentito nessuna voce. Riprova avvicinandoti al microfono, oppure scrivi la richiesta a mano.";
    case "audio-capture": return "Non trovo nessun microfono collegato. Scrivi la richiesta a mano.";
    case "network": return "Il servizio di riconoscimento vocale del browser non è raggiungibile. Riprova più tardi, oppure scrivi la richiesta a mano.";
    case "language-not-supported": return "Il browser non supporta la lingua scelta per la dettatura. Scegli un'altra lingua o scrivi a mano.";
    case "aborted": return null;
    default: return "Il riconoscimento vocale non è riuscito. Riprova oppure scrivi a mano.";
  }
}

export interface SpeechState {
  supported: boolean;
  listening: boolean;
  /** Testo provvisorio mentre si parla (non ancora definitivo). */
  interim: string;
  error: string | null;
  start(): void;
  stop(): void;
}

/**
 * Ascolto esplicito: parte solo da `start()` (pulsante premuto), si ferma con `stop()` o alla fine della frase,
 * non è continuo e non conserva nulla. `onFinal` riceve il testo definitivo.
 */
export function useSpeechRecognition(lang: SpeechLang, onFinal: (text: string) => void): SpeechState {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<RecognitionLike | null>(null);
  const finalCb = useRef(onFinal);
  finalCb.current = onFinal;
  const supported = recognitionCtor() !== null;

  const stop = useCallback(() => { rec.current?.stop(); }, []);
  const start = useCallback(() => {
    const C = recognitionCtor();
    if (!C) return;
    rec.current?.abort();
    setError(null);
    setInterim("");
    const r = new C();
    r.lang = SPEECH_LANGS.find((l) => l.code === lang)?.bcp47 ?? "it-IT";
    r.continuous = false;
    r.interimResults = true;
    r.maxAlternatives = 1;
    let finalText = "";
    r.onresult = (e) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]!;
        const text = res[0]?.transcript ?? "";
        if (res.isFinal) finalText += (finalText ? " " : "") + text.trim(); else live += text;
      }
      setInterim(live);
    };
    r.onerror = (e) => { const m = speechErrorMessage(e.error); if (m) setError(m); };
    r.onend = () => {
      setListening(false);
      setInterim("");
      if (rec.current === r) rec.current = null;
      if (finalText.trim()) finalCb.current(finalText.trim());
    };
    rec.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      rec.current = null;
      setError("Non riesco ad avviare il microfono. Riprova oppure scrivi a mano.");
    }
  }, [lang]);

  useEffect(() => () => { rec.current?.abort(); rec.current = null; }, []);
  return { supported, listening, interim, error, start, stop };
}
