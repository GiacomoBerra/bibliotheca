import type { Availability, Loan, LoanState } from "@/lib/api/loans";

const cls: Record<string, string> = {
  disponibile: "bg-primary/10 text-primary",
  "in prestito": "bg-warning text-warning-foreground",
  "restituzione in ritardo": "bg-destructive/15 text-destructive",
  "in ritardo": "bg-destructive/15 text-destructive",
  restituito: "bg-muted text-muted-foreground",
};

/** Il testo dello stato è sempre scritto (non affidato solo al colore). */
export function LoanPill({ value }: { value: Availability | LoanState }) {
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${cls[value]}`}>{value}</span>;
}

export const fmtDate = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—");

export function durationText(l: Loan): string {
  if (l.effectiveDays !== null) {
    const d = `${l.effectiveDays} ${l.effectiveDays === 1 ? "giorno" : "giorni"}`;
    return l.daysLate > 0 ? `${d} (${l.daysLate} di ritardo)` : d;
  }
  return l.daysLate > 0 ? `in corso, ${l.daysLate} ${l.daysLate === 1 ? "giorno" : "giorni"} di ritardo` : "in corso";
}
