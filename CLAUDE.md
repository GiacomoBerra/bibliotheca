# CLAUDE.md — regole di sviluppo per Bibliotheca

## Contesto
Bibliotheca viene costruita da zero. Non esiste codice sorgente iniziale da preservare o migrare. Il brief definisce requisiti desiderati, non funzionalità già implementate.

## Prima di intervenire
- Leggi questo file e il README, poi verifica la struttura e la configurazione reali del repository.
- Se il repository è vuoto, proponi una struttura minima coerente con lo stack scelto e documenta la decisione.
- La persistenza online è un requisito già deciso. Prima scelta: Netlify Database (PostgreSQL) con Netlify Functions; prima della creazione, verifica costi e limiti aggiornati. Se non può restare a CHF/EUR 0, proponi Supabase Free come database/auth mantenendo Netlify per il sito.
- Autenticazione e autorizzazioni server-side sono obbligatorie perché il catalogo è privato. Valuta Netlify Identity, incluso nei piani credit-based, e verifica sempre l'identità/ruolo nelle funzioni.
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
- Stack: Vite + React 19 + TanStack Router (SPA), Tailwind v4. Nessun SSR.
- Tutti i dati passano dall'interfaccia `BooksApi` in `src/lib/api`; i componenti non importano mai `src/data`.
- Le azioni non implementate sono disattivate o aprono l'avviso "Funzione non ancora disponibile": mai simulare un successo.
- `src/routeTree.gen.ts` è generato da `vite build`/`vite dev`: non modificarlo a mano.
- Prima di ogni commit: `npm run build` e `npm test`.
