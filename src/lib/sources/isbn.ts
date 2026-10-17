import { checkIsbn } from "@/lib/api/isbn";

/** Toglie spazi e trattini e porta la X finale in maiuscolo. Non valida. */
export const bareIsbn = (raw: string): string => raw.replace(/[\s-]/g, "").toUpperCase();

/** ISBN-13 equivalente a un ISBN-10 o ISBN-13 valido (stessa cifra di controllo); null se non valido. */
export function toIsbn13(raw: string): string | null {
  const s = bareIsbn(raw);
  if (checkIsbn(s) !== "ok") return null;
  if (s.length === 13) return s;
  const core = "978" + s.slice(0, 9);
  const sum = [...core].reduce((a, c, i) => a + Number(c) * (i % 2 === 0 ? 1 : 3), 0);
  return core + String((10 - (sum % 10)) % 10);
}

/** ISBN-10 equivalente a un ISBN-13 con prefisso 978; null altrimenti. */
export function toIsbn10(raw: string): string | null {
  const s = toIsbn13(raw);
  if (!s || !s.startsWith("978")) return null;
  const core = s.slice(3, 12);
  const sum = [...core].reduce((a, c, i) => a + Number(c) * (10 - i), 0);
  const check = (11 - (sum % 11)) % 11;
  return core + (check === 10 ? "X" : String(check));
}
