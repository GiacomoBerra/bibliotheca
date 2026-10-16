import { CircleCheck, CircleDot, HandHelping, TriangleAlert } from "lucide-react";
import type { Availability, BookAvailability, CatalogLoanState, Loan, LoanState } from "@/lib/api/loans";

const cls: Record<string, string> = {
  disponibile: "bg-primary/10 text-primary",
  "in prestito": "bg-warning text-warning-foreground",
  "restituzione in ritardo": "bg-destructive/15 text-destructive",
  "in ritardo": "bg-destructive/15 text-destructive",
  restituito: "bg-muted text-muted-foreground",
  annullato: "border border-dashed text-muted-foreground line-through",
};

/** Il testo dello stato è sempre scritto (non affidato solo al colore). */
export function LoanPill({ value }: { value: Availability | LoanState }) {
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${cls[value]}`}>{value}</span>;
}

export const fmtDate = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—");

export function durationText(l: Loan): string {
  if (l.state === "annullato") return "—";
  if (l.effectiveDays !== null) {
    const d = `${l.effectiveDays} ${l.effectiveDays === 1 ? "giorno" : "giorni"}`;
    return l.daysLate > 0 ? `${d} (${l.daysLate} di ritardo)` : d;
  }
  return l.daysLate > 0 ? `in corso, ${l.daysLate} ${l.daysLate === 1 ? "giorno" : "giorni"} di ritardo` : "in corso";
}

const catalogStyle: Record<CatalogLoanState, { cls: string; label: string; Icon: typeof CircleCheck }> = {
  disponibile: { cls: "bg-primary/10 text-primary", label: "Disponibile", Icon: CircleCheck },
  "in prestito": { cls: "bg-warning text-warning-foreground", label: "In prestito", Icon: HandHelping },
  "in ritardo": { cls: "bg-destructive/15 text-destructive", label: "In ritardo", Icon: TriangleAlert },
  "disponibilità parziale": { cls: "bg-accent text-accent-foreground", label: "Disponibilità parziale", Icon: CircleDot },
};

/**
 * Stato prestito nel catalogo. Non si affida al colore: ogni stato ha un'icona diversa e un testo scritto;
 * con più copie fisiche mostra anche «copie disponibili / copie totali».
 */
export function AvailabilityBadge({ value }: { value: BookAvailability }) {
  const { cls, label, Icon } = catalogStyle[value.state];
  const multi = value.totalCopies > 1;
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}><Icon className="h-3.5 w-3.5" aria-hidden />{label}</span>
      {multi && <span className="text-xs text-muted-foreground">{value.availableCopies} di {value.totalCopies} copie disponibili</span>}
    </span>
  );
}
