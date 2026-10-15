import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Download } from "lucide-react";
import { RestorePanel } from "@/components/app/RestorePanel";
import { ErrorBox, PageHeader } from "@/components/app/common";
import { Button } from "@/components/ui/button";
import { useBooksApi } from "@/lib/api/BooksApiContext";
import { useAuth } from "@/lib/auth/AuthProvider";
import { booksToCsv, booksToJson, booksToMarcText, downloadText } from "@/lib/export";

export const Route = createFileRoute("/_app/impostazioni")({
  head: () => ({
    meta: [
      { title: "Backup e impostazioni — Bibliotheca" },
      { name: "description", content: "Esportazione del catalogo in JSON e CSV." },
    ],
  }),
  component: Impostazioni,
});

function Impostazioni() {
  const api = useBooksApi();
  const { user, isAdmin, role } = useAuth();
  const [busy, setBusy] = useState<"json" | "csv" | "marc" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function run(kind: "json" | "csv" | "marc") {
    setBusy(kind);
    setError(null);
    setDone(null);
    try {
      const books = await api.listAllBooks();
      const stamp = new Date().toISOString().slice(0, 10);
      if (kind === "marc") {
        const m = booksToMarcText(books);
        if (m.count === 0) { setDone("Nessuna scheda ha un record MARC21 da esportare."); return; }
        downloadText(`bibliotheca-marc21-testo-${stamp}.txt`, m.text, "text/plain");
        setDone(`Esportati ${m.count} record MARC21 in forma testuale.`);
        return;
      }
      if (kind === "json") downloadText(`bibliotheca-backup-${stamp}.json`, booksToJson(books), "application/json");
      else downloadText(`bibliotheca-catalogo-${stamp}.csv`, booksToCsv(books), "text/csv");
      setDone(`Esportate ${books.length} ${books.length === 1 ? "scheda" : "schede"}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Esportazione non riuscita.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader title="Backup e impostazioni" description="Non c'è un backup automatico incluso: esporta il catalogo con regolarità e conserva il file altrove." />
      {isAdmin ? (
        <>
      <h2 className="mb-4 text-xl font-semibold">Esportazione</h2>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="flex flex-col rounded-lg border bg-card p-5">
          <h3 className="text-lg font-semibold">Esporta in JSON</h3>
          <p className="mt-2 flex-1 text-sm text-muted-foreground">Copia completa e fedele di tutte le schede, compresi gli eventuali dati MARC21 salvati. È il formato di backup. Non è un file MARC interoperabile.</p>
          <Button className="mt-4 self-start" variant="outline" disabled={busy !== null} onClick={() => void run("json")}>
            <Download aria-hidden /> {busy === "json" ? "Esportazione…" : "Scarica il backup JSON"}
          </Button>
        </div>
        <div className="flex flex-col rounded-lg border bg-card p-5">
          <h3 className="text-lg font-semibold">Esporta in CSV</h3>
          <p className="mt-2 flex-1 text-sm text-muted-foreground">Tabella apribile con un foglio di calcolo, per consultazione. Non contiene i dati MARC21 completi.</p>
          <Button className="mt-4 self-start" variant="outline" disabled={busy !== null} onClick={() => void run("csv")}>
            <Download aria-hidden /> {busy === "csv" ? "Esportazione…" : "Scarica il CSV"}
          </Button>
        </div>
        <div className="flex flex-col rounded-lg border bg-card p-5">
          <h3 className="text-lg font-semibold">Esporta MARC21 (testo)</h3>
          <p className="mt-2 flex-1 text-sm text-muted-foreground">Elenco leggibile dei record MARC21 salvati (una riga per campo). <strong>Non è un file ISO 2709 né MARCXML</strong> e non si importa in altri sistemi come file MARC.</p>
          <Button className="mt-4 self-start" variant="outline" disabled={busy !== null} onClick={() => void run("marc")}>
            <Download aria-hidden /> {busy === "marc" ? "Esportazione…" : "Scarica il testo MARC21"}
          </Button>
        </div>
      </div>
      <div className="mt-4 space-y-3" aria-live="polite">
        {done && <p role="status" className="text-sm">{done}</p>}
        {error && <ErrorBox message={error} />}
      </div>

      <h2 className="mb-3 mt-10 text-xl font-semibold">Importazione</h2>
      <RestorePanel onDownloadBackup={() => void run("json")} />

        </>
      ) : (
        <p className="rounded-lg border bg-card p-5 text-sm text-muted-foreground">Esportazione e importazione sono riservate agli amministratori.</p>
      )}

      <h2 className="mb-3 mt-10 text-xl font-semibold">Account</h2>
      <p className="text-sm text-muted-foreground">Accesso come <strong className="text-foreground">{user?.email}</strong> ({role === "admin" ? "amministratore" : "visualizzatore"}). La registrazione è chiusa: gli account si creano per invito dalla dashboard di Netlify (Identity).</p>
    </>
  );
}
