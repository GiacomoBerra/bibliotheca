/** Accetta solo percorsi interni (evita open redirect verso siti esterni). */
export function safeRedirect(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return undefined;
  if (value === "/" || value.startsWith("/reimposta-password") || value.startsWith("/recupera-password")) return undefined;
  return value;
}
