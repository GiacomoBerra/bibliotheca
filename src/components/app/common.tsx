import { useAuth } from "@/lib/auth/AuthProvider";
import type { ReactNode } from "react";
import { AlertTriangle, Info, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BookStatus } from "@/lib/api/types";

export function IllustrativeNote({ children = "Esempio illustrativo, non validato" }: { children?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-dashed border-warning-foreground/40 px-1.5 py-0.5 text-[11px] font-medium text-warning-foreground">
      <Info className="h-3 w-3" aria-hidden />
      {children}
    </span>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="break-words text-3xl font-semibold text-foreground">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function StatusPill({ status }: { status: BookStatus }) {
  const cls = status === "catalogato" ? "bg-primary/10 text-primary" : status === "bozza" ? "bg-muted text-muted-foreground" : "bg-warning text-warning-foreground";
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{status}</span>;
}

export function Loading({ label = "Caricamento…" }: { label?: string }) {
  return (
    <p role="status" className="flex items-center gap-2 py-10 text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {label}
    </p>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-5 text-destructive sm:flex-row sm:items-center sm:justify-between">
      <p className="flex items-start gap-2 text-sm"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {message}</p>
      {onRetry && <Button variant="outline" size="sm" onClick={onRetry}>Riprova</Button>}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, text, action }: { icon: typeof Info; title: string; text: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed bg-card px-6 py-14 text-center">
      <Icon className="h-10 w-10 text-muted-foreground" aria-hidden />
      <h2 className="mt-3 text-xl font-semibold">{title}</h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{text}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Mostra i figli solo agli amministratori. Aiuto per l'interfaccia: la barriera vera è nel server (403). */
export function AdminOnly({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth();
  if (isAdmin) return <>{children}</>;
  return (
    <div role="alert" className="rounded-lg border bg-card p-5">
      <h2 className="text-lg font-semibold">Funzione riservata agli amministratori</h2>
      <p className="mt-1 text-sm text-muted-foreground">Il tuo ruolo (visualizzatore) consente di consultare il catalogo, non di modificarlo.</p>
    </div>
  );
}
