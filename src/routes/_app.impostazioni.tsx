import { createFileRoute } from "@tanstack/react-router";
import { Download, Upload } from "lucide-react";
import { PageHeader } from "@/components/app/common";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_app/impostazioni")({
  head: () => ({
    meta: [
      { title: "Backup e impostazioni — Bibliotheca" },
      { name: "description", content: "Import ed export del catalogo in JSON e CSV (in arrivo)." },
    ],
  }),
  component: Impostazioni,
});

const items = [
  { icon: Download, title: "Esporta in JSON", text: "Scaricherà una copia completa del catalogo, utile come backup fedele da reimportare." },
  { icon: Download, title: "Esporta in CSV", text: "Scaricherà una tabella apribile con un foglio di calcolo, per consultazione e condivisione." },
  { icon: Upload, title: "Importa da JSON", text: "Ripristinerà un backup, con anteprima e conferma prima di modificare i dati." },
  { icon: Upload, title: "Importa da CSV", text: "Caricherà libri da una tabella, con controllo delle colonne e segnalazione degli errori riga per riga." },
];

function Impostazioni() {
  return (
    <>
      <PageHeader title="Backup e impostazioni" description="Sezione progettuale: le funzioni sono descritte ma non ancora attive." />
      <h2 className="mb-4 text-xl font-semibold">Import ed export</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {items.map((it) => (
          <div key={it.title} className="flex flex-col rounded-lg border bg-card p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">{it.title}</h3>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">In arrivo</span>
            </div>
            <p className="mt-2 flex-1 text-sm text-muted-foreground">{it.text}</p>
            <Button className="mt-4 h-auto min-h-9 max-w-full self-start whitespace-normal text-left" variant="outline" disabled>
              <it.icon aria-hidden /> {it.title} (non disponibile)
            </Button>
          </div>
        ))}
      </div>
      <h2 className="mb-3 mt-10 text-xl font-semibold">Account</h2>
      <p className="text-sm text-muted-foreground">L'account privato con accesso su invito e la conservazione online dei dati saranno collegati in una fase successiva.</p>
    </>
  );
}
