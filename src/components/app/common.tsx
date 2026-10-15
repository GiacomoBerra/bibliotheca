import { createContext, useContext, useState, type ReactNode } from "react";
import { FlaskConical, Info } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export function DemoBadge({ label = "Dati dimostrativi" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-warning-foreground/30 bg-warning px-2.5 py-0.5 text-xs font-semibold text-warning-foreground">
      <FlaskConical className="h-3.5 w-3.5" aria-hidden />
      {label}
    </span>
  );
}

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
      <div>
        <h1 className="text-3xl font-semibold text-foreground">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

const UnavailableCtx = createContext<(feature: string) => void>(() => {});
export const useUnavailable = () => useContext(UnavailableCtx);

export function UnavailableProvider({ children }: { children: ReactNode }) {
  const [feature, setFeature] = useState<string | null>(null);
  return (
    <UnavailableCtx.Provider value={setFeature}>
      {children}
      <Dialog open={feature !== null} onOpenChange={(o) => !o && setFeature(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Funzione non ancora disponibile</DialogTitle>
            <DialogDescription>
              «{feature}» verrà realizzata in una fase successiva. Nessuna operazione è stata eseguita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setFeature(null)}>Ho capito</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </UnavailableCtx.Provider>
  );
}
