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
309 test (ruoli, 403, CRUD, errori database, fonti simulate, voce simulata, MARC, ripristino, importazione CSV/ISBN, prestiti, didattica), build e controllo dei tipi OK.

## Produzione
Nessuna verifica: nessuna pubblicazione effettuata.

## Avanzamento sviluppo (branch feature/sviluppo-funzioni-complete)
| Fase | Stato | Note |
|---|---|---|
| 1. Ricerca vocale e bibliografica | implementata, testata (simulazione) | Open Library, Google Books, LoC (SRU); scelta manuale/assistita; fonti reali da verificare su preview |
| 2. Editor MARC21 | implementata, testata (automatica) | vedi docs/marc21.md; regole verificate solo per 9 campi (020, 082, 100, 245, 264, 300, 650, 653, 700); da provare su preview |
| 3. Soggetti, Dewey, collocazione | implementata, testata (automatica) | nuova migrazione additiva 0002 (dewey_notes, dewey_source); elenco soggetti modificabile; spiegazione didattica; nessuna validazione DDC |
| 4. Backup, importazione, esportazioni | implementata, testata (automatica, anche su Postgres) | JSON v2 (schede, copie, prestiti)/CSV/MARC testuale; importazione da CSV, elenco ISBN e backup con anteprima, conflitti e backup verificato obbligatorio (vedi docs/importazione.md; verifica manuale su preview da fare); nessuna esportazione ISO 2709 |
| 5. Prestiti | implementata, testata (automatica, PGlite e Postgres locale con driver pg) | nuova migrazione additiva 0003 (`book_copies`, `loans`); vedi sotto; da verificare su Deploy Preview |

## Fase 5 — Prestiti (stato: implementata e testata in automatico; NON verificata su preview né in produzione)
**Modello** (`netlify/database/migrations/20261016000003_loans.sql`, solo additiva): `book_copies` (copia fisica, oggi solo la n. 1 creata al primo prestito, ma il modello ammette più copie) e `loans` (un record per prestito, mai cancellato: destinatario, recapito facoltativo, data prestito, durata prevista, data prevista, data effettiva, note, chi ha registrato). Lo stato (in prestito / in ritardo / restituito) e la disponibilità sono **derivati** dalle date, non memorizzati.
**Regole imposte dal database**: un solo prestito attivo per copia (indice univoco parziale, regge richieste simultanee), scadenza = inizio + durata, restituzione non anteriore all'inizio, la copia appartiene al libro, cancellazione di libri/copie con prestiti rifiutata (`ON DELETE RESTRICT`) → l'API risponde 409 `has_loans`.
**API** (verifica ruolo lato server): admin = `POST /api/books/:id/loans`, `POST /api/loans/:id/return`, `PUT /api/loans/:id`, `GET /api/loans` (filtri destinatario/stato/date/libro); nessuna DELETE (405). Viewer = solo `GET /api/books/:id/loans`, **senza** nome, recapito e note (privacy); tutto il resto 403.
**Interfaccia**: sezione «Prestiti» nella scheda del libro (registra, restituisci, storico con durata effettiva e ritardo), pagina «Prestiti» (solo admin, con filtri), voce di menu solo per admin.
**Limiti noti**: data odierna calcolata nel fuso Europa/Zurigo; nessuna annullamento di una restituzione registrata per errore (da gestire con nuova migrazione/decisione); nessuna interfaccia per aggiungere altre copie; il backup JSON v2 include copie e prestiti (il CSV no); nell'import i prestiti ripristinati attribuiscono l'operazione a chi importa; nessun invio di promemoria.
**Test automatici**: `server/loans.test.ts` (doppio prestito, richieste simultanee, date incoerenti, vincoli DB saltando l'API, restituzioni non valide, storico conservato, ruoli, privacy, client HTTP), caso con driver `pg` reale in `server/pgdriver.test.ts`, `src/test/loans.test.tsx` (interfaccia). Totale 267 test, `npm run build` OK.
| 6. Modalità didattica | implementata, testata (automatica); contenuti da far rivedere a un catalogatore | lezioni, esplora-campi, 20 esercizi con feedback motivato, spiegazione contestuale nell'editor MARC |

## Fase 6 — Modalità didattica (stato: implementata e testata in automatico; NON verificata su preview)
**Contenuti** (`src/lib/didattica/content.ts`, `src/lib/marc/glossary.ts`): 4 lezioni (quattro domande: descrizione/soggetto/classificazione/collocazione; struttura del campo; validità formale vs correttezza catalografica; errori frequenti), esplora-campi per 9 campi MARC 21, 14 esercizi a scelta e 6 diagnostici. Ogni esercizio che usa una regola MARC cita la pagina LC (consultata il 15/10/2026); le risposte diagnostiche sono **calcolate** dal controllo reale dell'editor, non scritte a mano.
**Onestà sui limiti**: dove la risposta dipende da regole locali o fonti assenti (forma del nome, articoli da ignorare, numero Dewey corretto, soggetti da thesauri) l'esercizio lo dichiara («Attenzione») e non fornisce risposte inventate; nessun numero Dewey né termine di soggetto ufficiale è presente nei contenuti. Il punteggio non è salvato.
**Da fare/decidere**: far rivedere i testi didattici a un catalogatore (le regole MARC sono verificate sulla fonte LC, ma la scelta degli esempi è didattica); eventuali lezioni su ISBD/RDA/REICAT e sul thesaurus italiano (es. Nuovo soggettario) richiedono fonti che l'app non ha.
**Test**: `src/test/didattica.test.tsx` (11 test: coerenza glossario↔regole, struttura degli esercizi, feedback, filtro, editor).
| 7. Accessibilità e rifinitura | parzialmente verificata (automatica + controllo visivo locale) | vedi sotto |

## Fase 7 — Accessibilità e responsive
**Automatico** (`src/test/a11y.test.tsx`, axe-core in jsdom): 9 schermate (admin e viewer) senza violazioni su nomi accessibili, etichette, ruoli ARIA, tabelle, struttura. Non copre contrasto dei colori, ordine visivo né screen reader reali.
**Controllo visivo locale** (Chromium headless su una pagina di prova temporanea con dati finti, NON sulla Deploy Preview e non con Netlify Identity reale; pagina rimossa): dashboard, catalogo, scheda (admin e viewer), prestiti, didattica, nuova scheda a 375, 768 e 1280 px. Trovato e corretto un overflow orizzontale nella pagina didattica (menu a tendina con voci lunghe); poi nessun overflow orizzontale della pagina; le tabelle larghe scorrono nel proprio contenitore.
**Da verificare a mano** su Deploy Preview: contrasto colori, uso da tastiera, dispositivi reali, dettatura vocale, fonti bibliografiche reali, prestiti con database Netlify.
