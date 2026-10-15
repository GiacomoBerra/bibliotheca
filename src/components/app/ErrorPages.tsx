import { Link, useRouter, type ErrorComponentProps } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";

export function NotFoundPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <p className="font-serif text-7xl font-semibold text-primary" aria-hidden>404</p>
        <h1 className="mt-4 text-2xl font-semibold text-foreground">Pagina non trovata</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          L'indirizzo che hai aperto non esiste o è stato spostato. Controlla che sia scritto correttamente oppure torna alla pagina iniziale.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button asChild>
            <Link to="/">Vai alla pagina iniziale</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/catalogo">Apri il catalogo</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ErrorPage({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  console.error(error);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div role="alert" className="max-w-md text-center">
        <h1 className="text-2xl font-semibold text-foreground">Questa pagina non si è caricata</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Si è verificato un problema imprevisto. Puoi riprovare oppure tornare alla pagina iniziale. Se stavi salvando una scheda, controlla nel catalogo che la modifica sia presente prima di ripeterla.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button
            onClick={() => {
              void router.invalidate();
              reset();
            }}
          >
            Riprova
          </Button>
          <Button asChild variant="outline">
            <a href="/">Vai alla pagina iniziale</a>
          </Button>
        </div>
      </div>
    </div>
  );
}
