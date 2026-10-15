import { checkIsbn } from "./isbn";
import type { BookInput } from "./types";

export type FieldErrors = Partial<Record<keyof BookInput, string>>;

/** Limiti identici ai CHECK della migrazione SQL. */
export const LIMITS = {
  title: 500, isbn: 32, publisher: 300, publicationPlace: 300, publicationYear: 20, language: 50,
  physicalDescription: 500, notes: 5000, dewey: 50, shelfMark: 100,
} as const;

const LABELS: Record<keyof typeof LIMITS, string> = {
  title: "Titolo", isbn: "ISBN", publisher: "Editore", publicationPlace: "Luogo di pubblicazione", publicationYear: "Anno",
  language: "Lingua", physicalDescription: "Descrizione fisica", notes: "Note", dewey: "Dewey", shelfMark: "Collocazione",
};

/** Errori bloccanti (validazione tecnica). Avvisi non bloccanti: vedi `warnings`. */
export function validateBook(b: BookInput): FieldErrors {
  const e: FieldErrors = {};
  if (!b.title.trim()) e.title = "Il titolo è obbligatorio: è l'unico dato necessario per salvare una scheda.";
  for (const k of Object.keys(LIMITS) as (keyof typeof LIMITS)[]) {
    if (b[k].length > LIMITS[k] && !e[k]) e[k] = `${LABELS[k]}: massimo ${LIMITS[k]} caratteri (ora ${b[k].length}).`;
  }
  if (!e.isbn && checkIsbn(b.isbn) === "formato") e.isbn = "L'ISBN deve avere 10 o 13 cifre (l'ultima del formato a 10 può essere X); trattini e spazi sono ammessi.";
  return e;
}

export function warnings(b: BookInput): Partial<Record<keyof BookInput, string>> {
  const w: Partial<Record<keyof BookInput, string>> = {};
  if (checkIsbn(b.isbn) === "controllo") w.isbn = "La cifra di controllo non torna: controlla di aver copiato bene l'ISBN. Puoi comunque salvare.";
  return w;
}
