# CLAUDE.md — regole di sviluppo per Bibliotheca

## Contesto
Bibliotheca viene costruita da zero. Non esiste codice sorgente iniziale da preservare o migrare. Il brief definisce requisiti desiderati, non funzionalità già implementate.

## Prima di intervenire
- Leggi questo file e il README, poi verifica la struttura e la configurazione reali del repository.
- Se il repository è vuoto, proponi una struttura minima coerente con lo stack scelto e documenta la decisione.
- Persistenza e autenticazione: **Supabase Free** (PostgreSQL + Supabase Auth), scelta confermata dal proprietario; il sito resta su Netlify. L'autorizzazione è nelle policy RLS del database (`supabase/migrations`), non nell'interfaccia.
- Non attivare piani a pagamento, auto-recharge o servizi con costi senza approvazione esplicita. Il piano Free Netlify ha un limite rigido di crediti e un'app può essere sospesa se la quota si esaurisce.
- Non modificare o cancellare file fuori dall'ambito concordato.

## Regole di implementazione
- Procedi per incrementi piccoli e funzionanti; evita riscritture massive generate in un solo passaggio.
- Mantieni codice leggibile, componenti riutilizzabili, accessibilità e layout responsive.
- Non aggiungere segreti, chiavi API o credenziali nel codice o nei log.
- Non trasferire dati bibliografici a servizi esterni senza scelta esplicita.
- Non dichiarare regole MARC21, Dewey o soggettazione come validate senza fonti e controlli pertinenti.
- Distingui una vista testuale MARC da un formato standardizzato d'interscambio.

## Prima di concludere
- Riassumi file e funzioni create o modificate.
- Esegui test e build pertinenti e riporta i risultati reali.
- Controlla diff, file rimossi e possibili segreti accidentali.
- Per persistenza e import/export, prova salvataggio, backup, ripristino e gestione degli errori.
- Non eseguire deployment in produzione senza esplicita approvazione.

## Stile
Rispondi in italiano, con istruzioni pratiche. Distingui sempre proposto, implementato, testato e pubblicato. Se non puoi eseguire un controllo, dichiaralo.

## Note tecniche del repository
- Stack: Vite + React 19 + TanStack Router (SPA), Tailwind v4, `@supabase/supabase-js`. Nessun SSR.
- Tutti i dati passano dall'interfaccia `BooksApi` (`src/lib/api`); l'unica implementazione è `supabaseBooksApi.ts`. Nei test si usa `src/test/memoryApi.ts`.
- Nel browser solo `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`. Mai chiave secret/service_role. `.env*` è ignorato da git (vedi `.env.example`).
- Il client non invia mai `user_id`: lo imposta il database (`default auth.uid()`); la RLS lo verifica.
- Ogni modifica allo schema = nuova migrazione in `supabase/migrations` + aggiornamento di `docs/database.md` + test in `src/test/rls.test.ts`.
- `src/routeTree.gen.ts` è generato da `vite build`/`vite dev`: non modificarlo a mano.
- Prima di ogni commit: `npm run build` e `npm test`.
- Documentazione: `docs/` (setup Supabase, schema, decisioni e test).
