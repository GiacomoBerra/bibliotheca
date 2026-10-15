import { checkKnownRules } from "@/lib/marc/rules";
import { GLOSSARY } from "@/lib/marc/glossary";
import type { MarcField } from "@/lib/api/types";

export interface Source { label: string; url: string }
export const LOC_SOURCE = (tag: string): Source => ({ label: `Library of Congress, MARC 21 Bibliographic, campo ${tag} (consultata il 15/10/2026)`, url: `https://www.loc.gov/marc/bibliographic/bd${tag}.html` });

export type Topic = "struttura" | "indicatori" | "sottocampi" | "soggetti" | "dewey" | "errori" | "formale";
export const TOPIC_LABELS: Record<Topic, string> = {
  struttura: "Struttura del record", indicatori: "Indicatori", sottocampi: "Sottocampi e ripetizioni", soggetti: "Soggettazione",
  dewey: "Classificazione Dewey", errori: "Errori frequenti", formale: "Validità formale e correttezza catalografica",
};

export interface Choice { id: string; text: string }
export interface ChoiceExercise {
  kind: "choice"; id: string; topic: Topic; prompt: string; options: Choice[]; correct: string; explain: string;
  /** Fonte della regola; assente per principi generali che non dipendono da una norma specifica. */
  source?: Source;
  /** Quando la risposta dipende da regole locali o da un contesto catalografico, lo si dichiara. */
  caveat?: string;
}
/** Il numero corretto di avvisi NON è scritto a mano: lo calcola lo stesso controllo usato dall'editor MARC. */
export interface DiagnoseExercise { kind: "diagnose"; id: string; topic: Topic; prompt: string; fields: MarcField[]; hint: string }
export type Exercise = ChoiceExercise | DiagnoseExercise;

const df = (tag: string, ind1: string, ind2: string, ...subs: [string, string][]): MarcField => ({ tag, ind1, ind2, subfields: subs.map(([code, value]) => ({ code, value })) });
const opts = (...t: string[]): Choice[] => t.map((text, i) => ({ id: String.fromCharCode(97 + i), text }));

export const EXERCISES: Exercise[] = [
  { kind: "choice", id: "s1", topic: "struttura", prompt: "Che cosa contiene un campo dati MARC 21 (per esempio il 245)?",
    options: opts("Solo un testo libero", "Un tag di tre cifre, due indicatori e uno o più sottocampi", "Soltanto il tag e il valore", "Un solo sottocampo e nessun indicatore"), correct: "b",
    explain: "I campi dati (da 010 in poi) hanno tag, due indicatori (anche «non definiti», cioè uno spazio) e sottocampi con un codice. I campi di controllo (001–009) hanno invece solo il tag e un valore." },
  { kind: "choice", id: "s2", topic: "struttura", prompt: "Quale di questi campi NON è ripetibile in un record?",
    options: opts("700 – accesso aggiuntivo per nome di persona", "650 – accesso per soggetto, termine tematico", "245 – titolo", "300 – descrizione fisica"), correct: "c",
    explain: "Secondo la documentazione MARC 21 il 245 è non ripetibile (un record ha un solo campo titolo); 700, 650 e 300 sono ripetibili.", source: LOC_SOURCE("245") },
  { kind: "choice", id: "s3", topic: "struttura", prompt: "Il campo 100 (intestazione principale – nome di persona) è ripetibile?",
    options: opts("Sì, quanti autori si vuole", "No: gli altri autori si registrano in campi 700"), correct: "b",
    explain: "Il 100 è non ripetibile. Gli ulteriori nomi di persona si registrano come accessi aggiuntivi nel campo 700, che è ripetibile. Quale persona vada nel 100 dipende dalle regole di catalogazione adottate.", source: LOC_SOURCE("100"), caveat: "La scelta dell'intestazione principale dipende dalle norme di catalogazione in uso: l'app non la decide." },
  { kind: "choice", id: "i1", topic: "indicatori", prompt: "Nel campo 245 il secondo indicatore vale 4. Che cosa significa?",
    options: opts("Il titolo ha 4 parole", "Le prime 4 posizioni del titolo (articolo e spazio compresi) non contano per l'ordinamento", "Il titolo è il quarto della serie", "Il campo è stato modificato 4 volte"), correct: "b",
    explain: "Il secondo indicatore del 245 indica quante posizioni iniziali ignorare nell'ordinamento. Lo spazio dopo l'articolo è incluso nel conteggio: nell'esempio ufficiale «The Year book of medicine» il valore è 4 («The» + spazio).", source: LOC_SOURCE("245") },
  { kind: "choice", id: "i2", topic: "indicatori", prompt: "Applicando la regola dei caratteri non filing, per il titolo «Il nome della rosa» quale valore avrebbe il secondo indicatore del 245, se «Il» è considerato articolo iniziale da ignorare?",
    options: opts("0", "2", "3", "4"), correct: "c",
    explain: "«Il» sono 2 caratteri più lo spazio che segue: 3 posizioni. La regola di conteggio è quella del MARC 21 (articolo + spazio).",
    source: LOC_SOURCE("245"), caveat: "Quali parole siano articoli da ignorare dipende dalla lingua del titolo e dalle regole locali: la regola di conteggio è ufficiale, la scelta se ignorare l'articolo no." },
  { kind: "choice", id: "i3", topic: "indicatori", prompt: "Nel campo 245, quale valore del primo indicatore si usa quando nel record NON c'è alcun campo 1XX (intestazione principale)?",
    options: opts("0", "1", "Uno spazio", "Qualsiasi valore"), correct: "a",
    explain: "La documentazione indica che il primo indicatore è sempre 0 quando manca un campo 1XX (nessun accesso per titolo aggiuntivo).", source: LOC_SOURCE("245") },
  { kind: "choice", id: "i4", topic: "indicatori", prompt: "Nel campo 264, quale valore del secondo indicatore indica che l'informazione riguarda la PUBBLICAZIONE?",
    options: opts("0", "1", "2", "4"), correct: "b",
    explain: "264 secondo indicatore: 0 produzione, 1 pubblicazione, 2 distribuzione, 3 fabbricazione, 4 data del copyright.", source: LOC_SOURCE("264") },
  { kind: "choice", id: "sc1", topic: "sottocampi", prompt: "Nel campo 245, quale sottocampo contiene l'indicazione di responsabilità (la parte «/ Umberto Eco»)?",
    options: opts("$a", "$b", "$c", "$p"), correct: "c",
    explain: "245 $a titolo, $b complemento del titolo, $c indicazione di responsabilità. I sottocampi $a, $b e $c del 245 non sono ripetibili.", source: LOC_SOURCE("245") },
  { kind: "choice", id: "sc2", topic: "sottocampi", prompt: "Un libro ha due luoghi di pubblicazione. Nel campo 264, come si registrano?",
    options: opts("Non si può: $a non è ripetibile", "Ripetendo il sottocampo $a nello stesso campo 264", "Solo nelle note"), correct: "b",
    explain: "Nel 264 i sottocampi $a, $b e $c sono ripetibili.", source: LOC_SOURCE("264") },
  { kind: "choice", id: "so1", topic: "soggetti", prompt: "Che differenza c'è tra il campo 650 e il campo 653?",
    options: opts("Nessuna: sono sinonimi", "Il 650 è un accesso per soggetto con termine tematico (di norma da un thesaurus o una lista indicata dal secondo indicatore); il 653 è un termine d'indice NON controllato", "Il 653 si usa solo per i nomi di persona", "Il 650 si usa solo per la Dewey"), correct: "b",
    explain: "Nel 650 il secondo indicatore dichiara la fonte (0 = LCSH, 4 = fonte non specificata, 7 = fonte indicata in $2…); il 653 contiene termini liberi, senza controllo di autorità. Un termine libero non diventa «controllato» solo perché lo si scrive in un 650.", source: LOC_SOURCE("650") },
  { kind: "choice", id: "so2", topic: "soggetti", prompt: "Nel campo 650 il secondo indicatore vale 4. Che cosa dichiara?",
    options: opts("Che il termine proviene da LCSH", "Che la fonte del termine non è specificata", "Che il termine è in lingua inglese", "Che il soggetto è secondario"), correct: "b",
    explain: "650 secondo indicatore: 0 LCSH, 1 LC Children's, 2 MeSH, 3 NAL, 4 fonte non specificata, 5 Canadian Subject Headings, 6 Répertoire de vedettes-matière, 7 fonte indicata in $2. L'importanza del soggetto (primario/secondario) è il PRIMO indicatore.", source: LOC_SOURCE("650") },
  { kind: "choice", id: "so3", topic: "soggetti", prompt: "Che cosa fa Bibliotheca quando inserisci un soggetto?",
    options: opts("Lo confronta con un thesaurus ufficiale e lo corregge", "Lo conserva così com'è: non lo verifica su nessun thesaurus o archivio d'autorità"), correct: "b",
    explain: "L'app non contiene liste di soggetti né thesauri: scegliere il termine giusto, in una lista autorizzata, resta compito di chi cataloga." },
  { kind: "choice", id: "d1", topic: "dewey", prompt: "Nel campo 082 (Dewey), che cosa indica il primo indicatore 0?",
    options: opts("Edizione integrale", "Edizione abbreviata", "Nessuna informazione", "Numero assegnato dalla LC"), correct: "a",
    explain: "082 primo indicatore: 0 edizione integrale, 1 abbreviata, 7 altra edizione indicata in $2. Il secondo indicatore dice chi ha assegnato il numero (0 LC, 4 altra agenzia).", source: LOC_SOURCE("082") },
  { kind: "choice", id: "d2", topic: "dewey", prompt: "Un numero Dewey è scritto con cifre e punto nel formato corretto. Che cosa possiamo concludere?",
    options: opts("Che è il numero giusto per quel libro", "Solo che la forma è plausibile: la correttezza dipende dalle tavole DDC e dall'edizione usata, che l'app non contiene"), correct: "b",
    explain: "Bibliotheca registra notazione, edizione/note e origine della proposta, ma non ha le tavole DDC: non può dire se un numero sia corretto. «Verificata sulle tavole DDC» è solo una dichiarazione di chi cataloga.", caveat: "Per verificare un numero serve l'edizione autorizzata della Dewey (per esempio tramite WebDewey) o un archivio bibliografico autorevole." },
  { kind: "choice", id: "d3", topic: "dewey", prompt: "Qual è la differenza tra classificazione e collocazione?",
    options: opts("Sono la stessa cosa", "La classificazione assegna l'opera a una disciplina (es. con la Dewey); la collocazione indica dove il volume sta fisicamente sullo scaffale", "La collocazione è il soggetto", "La classificazione è il numero di inventario"), correct: "b",
    explain: "Descrizione bibliografica = com'è l'opera; soggettazione = di che cosa tratta; classificazione = in quale disciplina la si colloca; collocazione = dove si trova la copia. Possono usare dati collegati ma rispondono a domande diverse." },

  { kind: "diagnose", id: "e1", topic: "errori", prompt: "Il titolo ha un primo indicatore fuori dai valori ammessi. Quanti avvisi strutturali produce questo record?",
    fields: [df("245", "5", "0", ["a", "Il nome della rosa"])], hint: "Guarda i valori ammessi per il primo indicatore del 245." },
  { kind: "diagnose", id: "e2", topic: "errori", prompt: "Due titoli nello stesso record. Quanti avvisi strutturali produce?",
    fields: [df("245", "1", "0", ["a", "Titolo uno"]), df("245", "1", "0", ["a", "Titolo due"])], hint: "Il 245 è ripetibile?" },
  { kind: "diagnose", id: "e3", topic: "errori", prompt: "Un sottocampo ripetuto dove non è ammesso. Quanti avvisi strutturali?",
    fields: [df("100", "1", " ", ["a", "Eco, Umberto"], ["a", "Altro, Nome"])], hint: "Nel 100 il sottocampo $a è ripetibile?" },
  { kind: "diagnose", id: "e4", topic: "errori", prompt: "Descrizione fisica con un sottocampo ripetuto in modo non ammesso. Quanti avvisi?",
    fields: [df("300", " ", " ", ["a", "503 pagine"], ["b", "ill."], ["b", "tavole"])], hint: "Nel 300 $b (altri dettagli fisici) è ripetibile?" },
  { kind: "diagnose", id: "f1", topic: "formale", prompt: "Titolo 245 con il titolo sbagliato (diverso da quello del frontespizio) ma struttura perfetta. Quanti avvisi strutturali produce?",
    fields: [df("245", "1", "0", ["a", "Un titolo qualsiasi, non quello del libro"])], hint: "I controlli guardano la forma del record o il confronto con il libro?" },
  { kind: "diagnose", id: "f2", topic: "formale", prompt: "Soggetto in 650 con fonte «non specificata» ma scritto come parola libera, e una Dewey con indicatori coerenti. Quanti avvisi?",
    fields: [df("650", " ", "4", ["a", "cose varie"]), df("082", "0", "4", ["a", "[numero da verificare sulle tavole]"])], hint: "I controlli verificano il contenuto di un soggetto o di un numero Dewey?" },
];

export function diagnose(ex: DiagnoseExercise) {
  const issues = checkKnownRules(ex.fields);
  return { count: issues.length, messages: issues.map((i) => i.message) };
}

export interface Lesson { id: string; title: string; paragraphs: string[]; source?: Source }
export const LESSONS: Lesson[] = [
  { id: "quattro", title: "Quattro domande diverse", paragraphs: [
    "Descrizione bibliografica: com'è questo libro? (titolo, responsabilità, pubblicazione, descrizione fisica.)",
    "Soggettazione: di che cosa parla? Si esprime con termini, meglio se presi da una lista o un thesaurus controllato.",
    "Classificazione: in quale disciplina lo collochiamo? Con la Dewey si assegna una notazione numerica.",
    "Collocazione: dove sta la copia sullo scaffale? È un dato locale, legato alla singola biblioteca.",
  ] },
  { id: "campo", title: "Come è fatto un campo MARC 21", paragraphs: [
    "Ogni campo ha un tag di tre cifre. I campi 001–009 sono di controllo (solo un valore); gli altri sono campi dati con due indicatori e uno o più sottocampi.",
    "Gli indicatori sono due caratteri che qualificano il campo (per esempio quanti caratteri iniziali ignorare nell'ordinamento). Uno spazio significa «non definito» o «nessuna informazione».",
    "I sottocampi hanno un codice (per esempio $a, $b, $c). Ciascun sottocampo e ciascun campo ha una propria regola di ripetibilità, indicata dalla documentazione ufficiale.",
  ], source: { label: "Library of Congress, MARC 21 Format for Bibliographic Data", url: "https://www.loc.gov/marc/bibliographic/" } },
  { id: "formale", title: "Validità formale e correttezza catalografica", paragraphs: [
    "Un record è formalmente valido se rispetta la struttura: tag, indicatori ammessi, sottocampi, ripetizioni. Bibliotheca verifica la struttura e, per nove campi (020, 082, 100, 245, 264, 300, 650, 653, 700), anche indicatori e ripetibilità previsti dal MARC 21.",
    "Un record è catalograficamente corretto se descrive davvero il libro secondo le norme adottate: titolo trascritto come sul frontespizio, forma dei nomi, soggetti da una lista autorizzata, numero Dewey adatto all'opera. Questo l'app non lo può stabilire.",
    "Perciò «nessun avviso» non significa «record corretto»: significa solo che i controlli strutturali disponibili non hanno trovato problemi.",
  ] },
  { id: "frequenti", title: "Errori frequenti", paragraphs: [
    "Ripetere campi o sottocampi non ripetibili (due 245, due $a nel 100).",
    "Usare indicatori non previsti (245 con primo indicatore diverso da 0 o 1).",
    "Dimenticare il conteggio dei caratteri non filing nel 245 (articolo + spazio).",
    "Scrivere in un 650 una parola libera come se fosse un termine controllato.",
    "Copiare un numero Dewey da una fonte senza indicare edizione e provenienza.",
    "Fidarsi di un risultato trovato in una fonte esterna senza confrontarlo con il libro in mano.",
  ] },
];

export function glossaryFor(tag: string) { return GLOSSARY[tag]; }
