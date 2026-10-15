/** Traduce gli errori di Supabase Auth in messaggi italiani che aiutano a capire cosa fare. */
export function authErrorMessage(error: { message?: string | undefined; status?: number | undefined; code?: string | undefined } | null | undefined): string {
  if (!error) return "";
  const msg = (error.message ?? "").toLowerCase();
  const code = error.code ?? "";
  if (code === "invalid_credentials" || msg.includes("invalid login credentials")) return "Email o password non corretti. Controlla i dati e riprova.";
  if (code === "email_not_confirmed" || msg.includes("email not confirmed")) return "L'indirizzo email non risulta ancora confermato. Contatta il proprietario del catalogo.";
  if (error.status === 429 || code.includes("rate_limit") || msg.includes("rate limit") || msg.includes("too many")) return "Troppi tentativi o troppe email in poco tempo (il piano gratuito ha limiti stretti). Attendi qualche minuto e riprova.";
  if (code === "weak_password" || msg.includes("password should be") || msg.includes("weak")) return "La password è troppo debole. Usa almeno 12 caratteri, meglio se non banali.";
  if (code === "same_password" || msg.includes("different from the old")) return "La nuova password deve essere diversa da quella attuale.";
  if (msg.includes("failed to fetch") || msg.includes("network") || msg.includes("load failed")) return "Impossibile contattare il server. Controlla la connessione e riprova.";
  if (msg.includes("session") && (msg.includes("missing") || msg.includes("expired"))) return "Il link non è più valido o è scaduto. Richiedi un nuovo link di recupero.";
  return "Operazione non riuscita. Riprova tra poco; se il problema continua, contatta il proprietario del catalogo.";
}
