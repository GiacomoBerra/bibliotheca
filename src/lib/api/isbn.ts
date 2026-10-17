/** Validazione tecnica ISBN (formato e cifra di controllo). Non verifica che il libro esista. */
export type IsbnCheck = "vuoto" | "formato" | "controllo" | "ok";

export function checkIsbn(raw: string): IsbnCheck {
  const s = raw.replace(/[\s-]/g, "").toUpperCase();
  if (!s) return "vuoto";
  if (/^\d{9}[\dX]$/.test(s)) {
    const sum = [...s].reduce((acc, ch, i) => acc + (ch === "X" ? 10 : Number(ch)) * (10 - i), 0);
    return sum % 11 === 0 ? "ok" : "controllo";
  }
  if (/^\d{13}$/.test(s)) {
    const sum = [...s].reduce((acc, ch, i) => acc + Number(ch) * (i % 2 === 0 ? 1 : 3), 0);
    return sum % 10 === 0 ? "ok" : "controllo";
  }
  return "formato";
}
