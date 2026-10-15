/** Traduce gli errori di Netlify Identity in messaggi italiani che aiutano a capire cosa fare. */
export function authErrorMessage(error: { message?: string | undefined; status?: number | undefined; name?: string | undefined } | null | undefined): string {
  if (!error) return "";
  const msg = (error.message ?? "").toLowerCase();
  if (error.name === "MissingIdentityError") return "Il servizio di accesso non è disponibile in questo ambiente (Netlify Identity non è attivo).";
  if (msg.includes("failed to fetch") || msg.includes("network") || msg.includes("load failed")) return "Impossibile contattare il server. Controlla la connessione e riprova.";
  if (error.status === 429 || msg.includes("rate limit") || msg.includes("too many")) return "Troppi tentativi in poco tempo. Attendi qualche minuto e riprova.";
  if (msg.includes("password") && (msg.includes("short") || msg.includes("weak") || msg.includes("at least") || msg.includes("characters"))) return "La password è troppo debole o troppo corta. Usa almeno 12 caratteri.";
  if (msg.includes("token") && (msg.includes("invalid") || msg.includes("expired") || msg.includes("not found"))) return "Il link non è più valido o è scaduto. Richiedine uno nuovo.";
  if (msg.includes("not confirmed") || msg.includes("confirm")) return "L'indirizzo email non risulta ancora confermato. Controlla la posta o contatta il proprietario del catalogo.";
  if (error.status === 400 || error.status === 401 || error.status === 422 || msg.includes("invalid") || msg.includes("no user found") || msg.includes("credentials")) return "Email o password non corretti. Controlla i dati e riprova.";
  return "Operazione non riuscita. Riprova tra poco; se il problema continua, contatta il proprietario del catalogo.";
}
