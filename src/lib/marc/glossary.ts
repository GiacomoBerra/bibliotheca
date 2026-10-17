/**
 * Spiegazioni dei campi MARC 21 per la modalità didattica. Ogni voce deriva dalle pagine ufficiali della Library of Congress
 * (https://www.loc.gov/marc/bibliographic/bdNNN.html) consultate il 15 ottobre 2026; i testi sono riassunti in italiano.
 * Per i campi non elencati l'app NON offre spiegazioni (non le inventa).
 */
export interface FieldHelp {
  tag: string;
  name: string;
  url: string;
  repeatable: boolean;
  ind1: { meaning: string; values: Record<string, string> };
  ind2: { meaning: string; values: Record<string, string> };
  subfields: { code: string; name: string; repeatable: boolean }[];
  /** Nota didattica, non normativa. */
  note?: string;
}
const U = (n: string) => `https://www.loc.gov/marc/bibliographic/bd${n}.html`;
const UNUSED = { meaning: "Non definito", values: { " ": "non definito (si lascia uno spazio)" } };

export const GLOSSARY: Record<string, FieldHelp> = {
  "020": {
    tag: "020", name: "Numero internazionale normalizzato del libro (ISBN)", url: U("020"), repeatable: true, ind1: UNUSED, ind2: UNUSED,
    subfields: [{ code: "a", name: "ISBN", repeatable: false }, { code: "c", name: "Condizioni di disponibilità", repeatable: false }, { code: "q", name: "Informazioni qualificative", repeatable: true }, { code: "z", name: "ISBN annullato o non valido", repeatable: true }],
    note: "Un controllo formale sulla cifra di controllo dell'ISBN non dice se il numero appartenga davvero a quel libro.",
  },
  "082": {
    tag: "082", name: "Numero di classificazione Decimale Dewey", url: U("082"), repeatable: true,
    ind1: { meaning: "Tipo di edizione", values: { "0": "edizione integrale", "1": "edizione abbreviata", "7": "altra edizione, indicata nel sottocampo $2" } },
    ind2: { meaning: "Fonte del numero di classificazione", values: { " ": "nessuna informazione", "0": "assegnato dalla Library of Congress", "4": "assegnato da un'agenzia diversa dalla LC" } },
    subfields: [{ code: "a", name: "Numero di classificazione", repeatable: true }, { code: "2", name: "Informazioni sull'edizione", repeatable: false }, { code: "b", name: "Numero d'item", repeatable: false }, { code: "q", name: "Agenzia che ha assegnato il numero", repeatable: false }],
    note: "Bibliotheca non contiene le tavole Dewey: non può dire se il numero scelto sia quello giusto per il libro.",
  },
  "100": {
    tag: "100", name: "Intestazione principale – nome di persona", url: U("100"), repeatable: false,
    ind1: { meaning: "Tipo di elemento d'entrata del nome", values: { "0": "nome proprio (prenome)", "1": "cognome", "3": "nome di famiglia" } }, ind2: UNUSED,
    subfields: [{ code: "a", name: "Nome di persona", repeatable: false }],
    note: "La forma del nome (per esempio «Cognome, Nome») dipende dalle norme di catalogazione e dagli archivi d'autorità adottati: l'app non la verifica.",
  },
  "245": {
    tag: "245", name: "Titolo", url: U("245"), repeatable: false,
    ind1: { meaning: "Accesso per titolo", values: { "0": "nessun accesso per titolo (valore sempre 0 quando non c'è un campo 1XX)", "1": "accesso per titolo, uguale al titolo del 245" } },
    ind2: { meaning: "Caratteri da non considerare nell'ordinamento", values: { "0": "nessun articolo iniziale ignorato", "1–9": "numero di posizioni iniziali ignorate; comprende l'articolo e lo spazio che lo segue (es. «The » = 4)" } },
    subfields: [{ code: "a", name: "Titolo", repeatable: false }, { code: "b", name: "Complemento del titolo", repeatable: false }, { code: "c", name: "Indicazione di responsabilità", repeatable: false }, { code: "n", name: "Numero di parte o sezione", repeatable: true }, { code: "p", name: "Nome di parte o sezione", repeatable: true }],
    note: "Quali parole siano «articolo iniziale» da ignorare dipende dalla lingua del titolo e dalle regole di catalogazione usate.",
  },
  "264": {
    tag: "264", name: "Produzione, pubblicazione, distribuzione, fabbricazione", url: U("264"), repeatable: true,
    ind1: { meaning: "Sequenza delle indicazioni (valori verificati: spazio, 2, 3)", values: { " ": "non applicabile / nessuna informazione / prima indicazione", "2": "indicazione intermedia (cambiano luogo o nome dell'ente)", "3": "indicazione corrente o più recente" } },
    ind2: { meaning: "Funzione dell'ente", values: { "0": "produzione", "1": "pubblicazione", "2": "distribuzione", "3": "fabbricazione", "4": "data del copyright" } },
    subfields: [{ code: "a", name: "Luogo", repeatable: true }, { code: "b", name: "Nome dell'editore, produttore, distributore", repeatable: true }, { code: "c", name: "Data", repeatable: true }],
  },
  "300": {
    tag: "300", name: "Descrizione fisica", url: U("300"), repeatable: true, ind1: UNUSED, ind2: UNUSED,
    subfields: [{ code: "a", name: "Consistenza (es. numero di pagine)", repeatable: true }, { code: "b", name: "Altri dettagli fisici (es. illustrazioni)", repeatable: false }, { code: "c", name: "Dimensioni", repeatable: true }, { code: "e", name: "Materiale allegato", repeatable: false }],
  },
  "650": {
    tag: "650", name: "Accesso per soggetto – termine tematico", url: U("650"), repeatable: true,
    ind1: { meaning: "Livello del soggetto", values: { " ": "nessuna informazione", "0": "livello non specificato", "1": "primario", "2": "secondario" } },
    ind2: { meaning: "Thesaurus / lista di provenienza", values: { "0": "Library of Congress Subject Headings (LCSH)", "1": "LC Children's and Young Adults' Subject Headings", "2": "MeSH", "3": "National Agricultural Library", "4": "fonte non specificata", "5": "Canadian Subject Headings", "6": "Répertoire de vedettes-matière", "7": "fonte indicata nel sottocampo $2" } },
    subfields: [{ code: "a", name: "Termine tematico o nome geografico", repeatable: false }, { code: "2", name: "Fonte dell'intestazione (solo con ind. 2 = 7)", repeatable: false }, { code: "x", name: "Suddivisione generale", repeatable: true }, { code: "y", name: "Suddivisione cronologica", repeatable: true }, { code: "z", name: "Suddivisione geografica", repeatable: true }],
    note: "Un termine scritto liberamente non è una intestazione di soggetto controllata: per un soggetto controllato serve un thesaurus o una lista (indicata dal secondo indicatore).",
  },
  "653": {
    tag: "653", name: "Termine d'indice non controllato", url: U("653"), repeatable: true,
    ind1: { meaning: "Livello del termine d'indice", values: { " ": "nessuna informazione", "0": "livello non specificato", "1": "primario", "2": "secondario" } },
    ind2: { meaning: "Tipo di termine / nome", values: { " ": "nessuna informazione", "0": "argomento", "1": "nome di persona", "2": "nome di ente", "3": "nome di convegno", "4": "termine cronologico", "5": "nome geografico", "6": "genere/forma" } },
    subfields: [{ code: "a", name: "Termine non controllato", repeatable: true }],
  },
  "700": {
    tag: "700", name: "Accesso aggiuntivo – nome di persona", url: U("700"), repeatable: true,
    ind1: { meaning: "Tipo di elemento d'entrata del nome", values: { "0": "nome proprio (prenome)", "1": "cognome", "3": "nome di famiglia" } },
    ind2: { meaning: "Tipo di accesso aggiuntivo", values: { " ": "nessuna informazione", "2": "accesso analitico" } },
    subfields: [{ code: "a", name: "Nome di persona", repeatable: false }],
  },
};
