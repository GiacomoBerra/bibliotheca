/**
 * Interpretazione LOCALE (nessun servizio esterno, nessuna IA) di una richiesta dettata o scritta, in italiano,
 * inglese, tedesco o francese. È un'euristica a modelli di frase: i risultati sono proposte che l'utente
 * vede e può correggere prima di avviare qualsiasi ricerca.
 */
export type SpeechLang = "it" | "de" | "fr" | "en";
export const SPEECH_LANGS: { code: SpeechLang; label: string; bcp47: string }[] = [
  { code: "it", label: "Italiano", bcp47: "it-IT" },
  { code: "de", label: "Deutsch", bcp47: "de-DE" },
  { code: "fr", label: "Français", bcp47: "fr-FR" },
  { code: "en", label: "English", bcp47: "en-GB" },
];

export interface SpokenRequest { title: string; author: string; publisher: string; year: string; isbn: string }

const P: Record<SpeechLang, { lead: RegExp; book: RegExp; year: RegExp; publisher: RegExp; by: string }> = {
  it: {
    lead: /^\s*(?:(?:voglio|vorrei|devo|dovrei)\s+(?:catalogare|aggiungere|inserire|cercare|schedare)|(?:cataloga|aggiungi|inserisci|cerca|trova|scheda))(?:\s+|$)/i,
    book: /^(?:il\s+libro|il\s+volume|il\s+testo)\s+/i,
    year: /\b(?:nel(?:l'anno)?|anno|del)\s+(1[4-9]\d\d|20\d\d)\b/i,
    publisher: /\b(?:pubblicato\s+da|pubblicata\s+da|edito\s+da|edita\s+da|per\s+i\s+tipi\s+di|casa\s+editrice|editore)\s+/i,
    by: "di",
  },
  en: {
    lead: /^\s*(?:(?:i\s+want\s+to|i'd\s+like\s+to|i\s+need\s+to|let's)\s+(?:catalogue|catalog|add|search\s+for|look\s+up|find)|(?:catalogue|catalog|add|search\s+for|look\s+up|find))(?:\s+|$)/i,
    book: /^(?:the\s+book)\s+/i,
    year: /\b(?:in|year|from)\s+(1[4-9]\d\d|20\d\d)\b/i,
    publisher: /\b(?:published\s+by|publisher|from\s+the\s+publisher)\s+/i,
    by: "by",
  },
  de: {
    lead: /^\s*(?:(?:ich\s+m(?:ö|oe)chte|ich\s+will|ich\s+muss)(?:\s+(?:das\s+buch\s+)?(?:katalogisieren|hinzuf(?:ü|ue)gen|suchen|erfassen))?|(?:katalogisiere|f(?:ü|ue)ge\s+hinzu|suche|finde))(?:\s+|$)/i,
    book: /^(?:das\s+buch)\s+/i,
    year: /\b(?:im\s+jahr|im|in|jahr)\s+(1[4-9]\d\d|20\d\d)\b/i,
    publisher: /\b(?:ver(?:ö|oe)ffentlicht\s+von|verlegt\s+von|erschienen\s+bei|verlag)\s+/i,
    by: "von",
  },
  fr: {
    lead: /^\s*(?:(?:je\s+veux|je\s+voudrais|je\s+dois)\s+(?:cataloguer|ajouter|chercher|trouver|r(?:é|e)f(?:é|e)rencer)|(?:catalogue|ajoute|cherche|trouve))(?:\s+|$)/i,
    book: /^(?:le\s+livre)\s+/i,
    year: /\b(?:en|ann(?:é|e)e|dans\s+l'ann(?:é|e)e)\s+(1[4-9]\d\d|20\d\d)\b/i,
    publisher: /\b(?:publi(?:é|e)\s+par|(?:é|e)dit(?:é|e)\s+par|chez|(?:é|e)diteur)\s+/i,
    by: "(?:de|par)",
  },
};

const clean = (s: string) => s.replace(/^[\s,;:.«»"'“”‘’]+|[\s,;:.«»"'“”‘’]+$/g, "").replace(/\s+/g, " ").trim();

export function parseSpokenRequest(text: string, lang: SpeechLang): SpokenRequest {
  const p = P[lang];
  let t = text.replace(/\s+/g, " ").trim();
  const out: SpokenRequest = { title: "", author: "", publisher: "", year: "", isbn: "" };

  // ISBN: dopo la parola «isbn», oppure una sequenza di almeno 10 cifre (con spazi o trattini).
  const withWord = /\bisbn\b[:\s-]*((?:97[89][\s-]?)?(?:\d[\s-]?){8,9}[\dxX])\b/i.exec(t);
  const bare = /\b((?:97[89][\s-]?)?(?:\d[\s-]?){9}[\dxX])\b/.exec(t);
  const isbn = withWord ?? bare;
  if (isbn) {
    out.isbn = isbn[1]!.replace(/[\s-]/g, "").toUpperCase();
    t = t.replace(isbn[0], " ").replace(/\bisbn\b[:\s]*/i, " ");
  }

  const y = p.year.exec(t);
  if (y) { out.year = y[1]!; t = t.replace(y[0], " "); }
  else {
    const tail = /(?:\s|,)(1[4-9]\d\d|20\d\d)\s*[.!?]?\s*$/.exec(t);
    if (tail) { out.year = tail[1]!; t = t.slice(0, tail.index); }
  }

  const pub = p.publisher.exec(t);
  if (pub) {
    const rest = t.slice(pub.index + pub[0].length);
    const end = rest.search(/[,;.]|$/);
    out.publisher = clean(rest.slice(0, end));
    t = t.slice(0, pub.index) + " " + rest.slice(end);
  }

  t = clean(t).replace(p.lead, "");
  if (lang === "de") t = clean(t).replace(/\s+(?:katalogisieren|hinzuf(?:ü|ue)gen|suchen|erfassen)$/i, "");
  t = clean(t).replace(p.book, "");
  t = clean(t);
  const re = new RegExp(`\\s${p.by}\\s+(?!.*\\s${p.by}\\s)(.+)$`, "i");
  const m = re.exec(t);
  if (m && m[1] && m[1].split(" ").length <= 5) {
    out.author = clean(m[1]);
    t = t.slice(0, m.index);
  }
  out.title = clean(t);
  return out;
}
