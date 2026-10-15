# CLAUDE.md — regole di sviluppo per Bibliotheca

## Contesto
Biblioteca personale privata per catalogare libri e imparare MARC21, soggettazione e Dewey. Costruita da zero. Il brief definisce requisiti desiderati, non funzionalità già implementate.

## Architettura decisa (solo Netlify, budget CHF/EUR 0)
- Hosting: Netlify (SPA statica Vite + React 19 + TanStack Router + Tailwind v4, nessun SSR).
- Login e sessioni: **Netlify Identity** (`@netlify/identity`), registrazione pubblica disabilitata (solo invito), account proprietario creato dalla dashboard.
- API: **Netlify Functions** (`netlify/functions/api.mts` → `server/`). Tutte le operazioni sui dati (lettura, scrittura, cancellazione, esportazione) passano da qui.
- Database: **Netlify Database** (PostgreSQL). Il browser non vi si collega mai e non contiene credenziali.
- GitHub: solo repository e versionamento.
- Supabase NON si usa più (decisione definitiva del proprietario).

## Regole non negoziabili
- Catalogo UNICO e condiviso con due ruoli di Netlify Identity (`app_metadata.roles`): `admin` (consulta, inserisce, modifica, cancella, esporta, usa la ricerca su fonti esterne) e `viewer` (solo consulta: elenco, ricerca, schede complete con MARC21, statistiche). Nessun ruolo = nessun accesso (403).
- Ogni Function che tocca i dati: 1) controllo CSRF, 2) identità E ruoli da `getUser()` (sessione verificata lato server), 3) autorizzazione per ruolo in `server/router.ts` PRIMA di qualsiasi query. Mai accettare dal browser un id utente o un ruolo (parametri, corpo, intestazioni). Nascondere un pulsante nell'interfaccia non è una protezione.
- La ricerca su fonti esterne (`/api/lookup`) è solo admin, non scrive mai nel catalogo e tiene eventuali chiavi API solo nelle variabili d'ambiente del server.
- Non attivare piani a pagamento, crediti extra o ricariche automatiche. Il database Netlify NON va provisionato finché il proprietario non approva i costi (vedi `docs/netlify-attivazione.md`): per questo le migrazioni stanno in `db/migrations` e NON in `netlify/database/migrations`, e `@netlify/database` non è installato. Non spostare né installare senza approvazione: un deploy farebbe creare il database.
- Mai `drizzle-kit push/migrate` né DDL manuale su un database Netlify: lo schema arriva solo da file di migrazione applicati dal deploy. Non modificare migrazioni già applicate: scrivine una nuova.
- Segreti: mai nel codice, nei log o nei file pubblici. `.env*` ignorato da git.
- Non dichiarare regole MARC21, Dewey o soggetti come validati senza fonti. Una vista testuale MARC non è un file interoperabile.
- Stati: proposta / implementata / testata / pubblicata. Non dichiarare testato ciò che non è stato eseguito. Netlify Identity non funziona con `netlify dev`: si prova solo su un deploy (anche Deploy Preview).
- Nessuna pubblicazione in produzione senza conferma esplicita.

## Note tecniche
- Dati: interfaccia `BooksApi` (`src/lib/api`); implementazione `httpBooksApi.ts` (chiama `/api/*`). Nei test i componenti usano `src/test/memoryApi.ts`.
- Server: `server/router.ts` (instradamento, CSRF, auth, validazione), `server/booksRepo.ts` (SQL parametrizzato, ORDER BY in whitelist), `server/db.ts` (driver `pg`, `NETLIFY_DB_URL`). Validazione condivisa con il client in `src/lib/api/parse.ts` e `validation.ts`.
- Test del server: `server/*.test.ts` su Postgres reale (PGlite e `@netlify/database-dev` con il driver `pg`).
- `src/routeTree.gen.ts` è generato da `vite build`/`vite dev`: non modificarlo a mano.
- Prima di ogni commit: `npm run build` e `npm test`.
- Documentazione: `docs/`.

## Stile
Rispondi in italiano, con istruzioni pratiche. Se non puoi eseguire un controllo, dichiaralo.
