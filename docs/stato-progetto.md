# Stato del progetto — 15 ott 2026

Stati: proposta / implementata / testata / pubblicata. «Preview» = verificato dal proprietario su Deploy Preview PR #3.

| Funzione | Stato | Prova |
|---|---|---|
| Catalogo condiviso su Netlify Database (inserimento, elenco, scheda) | testata (automatica) + verificata in preview | 193 test; admin inserisce, viewer vede il libro (proprietario) |
| Ruoli admin/viewer verificati lato server | testata (automatica) | server/api.test.ts; viewer 403 su POST/PUT/DELETE/export |
| Identity (login, invito) | verificata in preview (login admin e viewer) | proprietario |
| Persistenza dopo logout/login | verificata in preview (libro visibile al viewer dopo cambio account) | proprietario |
| Ricerca bibliografica (Open Library, Google Books) | implementata e testata con risposte simulate | API reali non ancora verificate |
| Dettatura vocale | implementata e testata con riconoscimento simulato | browser reale non ancora provato |
| Errori database precisi | testata | api.test.ts |
| 403 via chiamate dirette alla preview | NON eseguita sulla preview | solo test automatici |
| Produzione | NON pubblicata | PR #3 non unita a main |

## Da sviluppare
Esportazione/importazione JSON-CSV con validazione e backup (proposta), mappatura e validazione MARC21 con fonti autorevoli, soggettazione e Dewey didattici, funzioni di apprendimento, test di ripristino, accessibilità/responsive da verificare, gestione inviti/ruoli documentata, pubblicazione in produzione dopo conferma.

## Verifiche sulla Deploy Preview PR #3 — eseguite manualmente dal proprietario (15 ott 2026)
Non sono test automatici né verifiche in produzione.
- Admin: inserimento di un libro; modifica e cancellazione di un record di prova esistente; POST 201; PUT/DELETE su UUID inesistente 404; export 200.
- Viewer: vede lo stesso catalogo dell'admin; POST/PUT/DELETE/export rifiutati con 403; il record resta intatto.
- Persistenza dopo le operazioni e dopo il cambio di account: confermata.

## Test automatici (eseguiti da Claude Code, Postgres reale in locale)
193 test (ruoli, 403, CRUD, errori database, fonti simulate, voce simulata), build e controllo dei tipi OK.

## Produzione
Nessuna verifica: nessuna pubblicazione effettuata.

## Avanzamento sviluppo (branch feature/sviluppo-funzioni-complete)
| Fase | Stato | Note |
|---|---|---|
| 1. Ricerca vocale e bibliografica | implementata, testata (simulazione) | Open Library, Google Books, LoC (SRU); scelta manuale/assistita; fonti reali da verificare su preview |
| 2. Editor MARC21 | implementata, testata (automatica) | vedi docs/marc21.md; regole verificate solo per 7 campi; da provare su preview |
| 3. Soggetti, Dewey, collocazione | implementata, testata (automatica) | nuova migrazione additiva 0002 (dewey_notes, dewey_source); elenco soggetti modificabile; spiegazione didattica; nessuna validazione DDC |
| 4. Backup, importazione, esportazioni | implementata, testata (automatica, anche su Postgres) | JSON/CSV/MARC testuale; ripristino con anteprima e conflitti; nessuna esportazione ISO 2709 |
