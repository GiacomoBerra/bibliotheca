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

## Correzione prestiti e restituzioni (branch fix/prestiti-restituzioni-correzioni) — stato: implementata e testata in automatico; NON verificata sulla Deploy Preview né in produzione
**Problemi segnalati durante il collaudo**: (1) con un libro in prestito si vedeva soltanto «registra prestito»; (2) nessun modo di correggere un'operazione sbagliata.
**Causa individuata** (da lettura del codice; non ho potuto aprire la preview): il backend e le API di restituzione esistevano già e funzionavano (verificato dai test). La scheda libro mostrava il modulo di restituzione solo con un titolo generico («Prestito in corso»), senza un'azione chiaramente etichettata «Registra restituzione», senza riepilogo; la pagina elenco «Prestiti» non aveva alcuna azione e rimandava a un testo. Per l'errore 2 mancava del tutto il backend: non esisteva né l'annullamento di un prestito né di una restituzione, e il database non aveva dove conservare una traccia. Quindi: (1) era un difetto di interfaccia/chiarezza, (2) una funzione mancante in tutti i livelli.
**Migrazione additiva `20261016000004_loan_corrections.sql`**: colonne `voided_at/voided_by/void_reason` su `loans` (con vincolo di coerenza), tabella `loan_corrections` (azione, motivo, autore, data, stato prima e dopo; immutabile: trigger che rifiuta UPDATE e DELETE). Nessun dato esistente è toccato. Unico oggetto sostituito: l'indice univoco «un prestito attivo per copia» (e quello dei prestiti attivi), ricreati con la condizione in più `voided_at is null`.
**API (solo admin, verificate lato server)**: `POST /api/loans/:id/void` e `/undo-return` (corpo `{reason}`, 3–500 caratteri), `GET /api/loans/:id/corrections`. Ogni correzione è UN'unica istruzione SQL (aggiornamento + riga di traccia): se la traccia non si salva non cambia nulla. Il viewer riceve 403 su tutto, tranne la lettura dello storico di un libro, senza nome, recapito, note né motivo.
**Regole**: un prestito annullato non si cancella e non conta più come prestito (la copia torna disponibile); non si può restituire o modificare un prestito annullato; l'annullamento della restituzione è bloccato (409 con spiegazione) se esiste un prestito successivo non annullato sulla stessa copia, e come ultima difesa dall'indice univoco; il libro con prestiti annullati resta non cancellabile (storico protetto).
**Interfaccia**: scheda libro «Prestiti» — libro disponibile: «Registra prestito» con verifica dei dati prima del salvataggio (data prevista e durata si aggiornano a vicenda); libro in prestito: stato, destinatario, date, «Registra restituzione» (data preimpostata a oggi, modificabile, riepilogo prima di confermare) e «Annulla prestito registrato per errore»; nessun modulo per un secondo prestito. Storico con stato «annullato», azioni «Annulla registrazione della restituzione» (solo sull'ultimo prestito) e traccia delle correzioni. Pagina Prestiti: link «Registra restituzione/Gestisci» per riga e filtro «Annullati».
**Backup**: il backup v2 NON include i prestiti annullati (ne dichiara il numero in `voidedLoansNotIncluded`); la traccia delle correzioni resta solo nel database. Il backup quindi non è una copia completa della cronologia delle correzioni.
**Test eseguiti realmente** (automatici): `server/corrections.test.ts` (19, Postgres/PGlite: restituzione, doppio prestito simultaneo, annullamento, motivo obbligatorio, traccia e immutabilità, atomicità con guasto simulato, annullamento restituzione e blocchi, viewer 401/403/privacy, CSRF, backup) e `src/test/loans.test.tsx` (12: libro disponibile/in prestito, verifica prima del salvataggio, riepilogo restituzione, correzioni, errore del server). 
**Ancora da fare a mano** sulla Deploy Preview, con un libro creato apposta (es. «[TEST] Prestiti») e mai su libri reali: registrare e restituire; annullare un prestito errato; annullare una restituzione; provare il blocco con un prestito successivo; verificare da viewer che i pulsanti non compaiano e che le chiamate dirette diano 403; verificare le chiamate `void`/`undo-return` sul database Netlify reale (finora solo PGlite).
