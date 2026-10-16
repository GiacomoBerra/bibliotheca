# Stato del progetto — aggiornato il 16 ott 2026

Stati: proposta / implementata / testata / pubblicata. «Preview» = verificato dal proprietario su Deploy Preview PR #3.

| Funzione | Stato | Prova |
|---|---|---|
| Catalogo condiviso su Netlify Database (inserimento, elenco, scheda) | testata (automatica) + verificata in preview | test automatici (vedi «Risultati dei test»); admin inserisce, viewer vede il libro (proprietario) |
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
Vedi «Risultati dei test» in fondo (dato aggiornato al 16 ott 2026).

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
**Backup**: il backup v2 NON includeva i prestiti annullati. **Corretto con il backup v3** (vedi sotto): ora annullati e cronologia correzioni sono nel file.
**Test eseguiti realmente** (automatici): `server/corrections.test.ts` (19, Postgres/PGlite: restituzione, doppio prestito simultaneo, annullamento, motivo obbligatorio, traccia e immutabilità, atomicità con guasto simulato, annullamento restituzione e blocchi, viewer 401/403/privacy, CSRF, backup) e `src/test/loans.test.tsx` (12: libro disponibile/in prestito, verifica prima del salvataggio, riepilogo restituzione, correzioni, errore del server). 
**Ancora da fare a mano** sulla Deploy Preview, con un libro creato apposta (es. «[TEST] Prestiti») e mai su libri reali: registrare e restituire; annullare un prestito errato; annullare una restituzione; provare il blocco con un prestito successivo; verificare da viewer che i pulsanti non compaiano e che le chiamate dirette diano 403; verificare le chiamate `void`/`undo-return` sul database Netlify reale (finora solo PGlite).

---

# Colonna «Stato prestito» e audit completo (branch `feature/stato-prestito-audit`, PR #6 → `main` solo per ottenere la Deploy Preview)

Stato della colonna: **implementata e testata in automatico (PGlite = Postgres reale in-process + interfaccia)**. **Non verificata sulla Deploy Preview dal proprietario, non in produzione.**

## Colonna «Stato prestito»: regole
- **Stati**: Disponibile / In prestito / In ritardo / Disponibilità parziale («N di M copie disponibili» quando le copie sono più di una). Ogni stato ha icona **e** testo (non solo colore). Sul telefono è un'etichetta nella scheda del libro.
- **Fonte dei dati**: database, tramite `GET /api/books` (campo `availability` per ogni libro della pagina). Una sola query aggiuntiva per pagina (`availabilityFor`), mai una per libro.
- **Prestito che conta**: solo quelli non restituiti **e** non annullati (`returned_date is null and voided_at is null`). Storico e annullati non influenzano la disponibilità.
- **Copie**: totale = max(1, righe in `book_copies`, numero di copia più alto). Oggi la copia 1 nasce al primo prestito, quindi un libro mai prestato conta 1 copia disponibile.
- **Priorità quando le copie sono in stati diversi**: In ritardo > Disponibilità parziale > In prestito > Disponibile. (Un libro con 2 copie, una in ritardo e una libera, risulta «In ritardo»; il dettaglio «1 di 2 copie disponibili» resta visibile.)
- **Regola del ritardo**: un prestito è in ritardo **solo se oggi è successivo alla data prevista**; nel giorno di scadenza **non** è in ritardo. «Oggi» è la data nel fuso **Europa/Zurigo** (`todayIso`), calcolata dal server e passata alle query: così non si segnala un ritardo prima della scadenza effettiva né il browser dell'utente può falsarlo.
- **Filtro «Disponibilità»**: Tutti / Disponibili / In prestito / In ritardo / Disponibilità parziale, combinabile con ricerca, stato scheda e paginazione (filtro lato server, `?loan=`). «In prestito» = almeno una copia prestata e nessuna in ritardo o parziale; i filtri coincidono con gli stati mostrati.
- **Aggiornamento**: la colonna si ricarica dopo prestito, restituzione, annullamento, correzione e modifica della data prevista (i dati vengono riletti all'apertura del catalogo e quando la scheda torna visibile, `visibilitychange`).
- **Privacy**: admin e viewer ricevono lo stesso `availability` (solo stato e conteggi); nessun nome, recapito o nota arriva al viewer. Permessi invariati (viewer: solo GET su libri/statistiche; prestiti, export, lookup: solo admin).
- **File**: `src/lib/api/loans.ts` (`summarizeAvailability`, tipi), `server/booksRepo.ts` (`availabilityFor`, filtro), `server/router.ts`, `src/components/app/LoanBits.tsx` (`AvailabilityBadge`), `src/routes/_app.catalogo.index.tsx`.

### I 10 test richiesti
| # | Richiesta | Dove (automatico) |
|---|---|---|
| 1–4 | disponibile / in prestito / in ritardo / storico senza prestiti attivi; giorno di scadenza | `server/availability.test.ts` (regola pura, stati 1–4, confine del giorno di scadenza) |
| 5 | prestito annullato non influisce | `server/availability.test.ts`, `server/corrections.test.ts` |
| 6 | più copie fisiche | `server/availability.test.ts` (createLoan con numero di copia) |
| 7 | aggiornamento dopo prestito/restituzione/correzione | `server/availability.test.ts` (ciclo di vita); `src/test/availability.test.tsx` (interfaccia) |
| 8–9 | coerenza admin/viewer e assenza di dati personali | `server/availability.test.ts` (privacy), `server/corrections.test.ts` |
| 10 | filtri e ricerca, paginazione, numero di query costante | `server/availability.test.ts`; `src/test/availability.test.tsx` |

## Problema critico corretto durante l'audit: backup incompleto → **backup v3**
Il backup v2 **escludeva i prestiti annullati e non conteneva la cronologia delle correzioni**: un ripristino avrebbe perso storico e tracciabilità. Corretto senza riscrivere il sistema (migrazione: nessuna, solo codice):
- **Esportazione v3** (`src/lib/export.ts`): schede, copie, prestiti **compresi gli annullati** (`voided: {at, by, reason}`) e `corrections[]` (azione, motivo, autore, data, stato prima/dopo). Contatori `loanCount`, `voidedLoanCount`, `correctionCount`.
- **Verifica di rilettura** prima del salvataggio (Impostazioni): il file viene riletto e si confrontano schede, prestiti, annullati e correzioni; se non tornano il backup non viene consegnato.
- **Ripristino** (`src/lib/backup.ts`): v1, v2 e v3 leggibili. Un prestito annullato torna **annullato** (non attivo), con una riga di traccia che cita l'annullamento originale (data, autore, motivo). Riconoscimento dei duplicati: un secondo ripristino non crea doppioni. Il ripristino non cancella nulla.
- **Limiti noti del ripristino**: la cronologia delle correzioni *non annullative* (es. «annulla restituzione») resta nel file ma non viene riscritta riga per riga nel database (l'API non permette di inserire storico arbitrario: sarebbe un modo di falsificarlo); chi ripristina risulta autore della registrazione; id e date di creazione si rigenerano; solo copia n. 1.
- **Test**: `server/corrections.test.ts` (round trip su Postgres/PGlite: annullato → backup → ripristino → ancora annullato con traccia, copia libera, secondo ripristino senza duplicati; v2 ancora leggibile con avviso).

## Risultati dei test (16 ott 2026, eseguiti da Claude nel sandbox)
- `npx vitest run`: **348 test, 22 file, tutti passati**.
- `npx tsc --noEmit`: nessun errore. `npm run build`: OK.
- Cosa NON copre: Netlify Identity reale, funzioni su Netlify, database Netlify reale (qui PGlite e, per `pgdriver.test.ts`, driver `pg`), fonti bibliografiche reali, dettatura reale, contrasto colori, screen reader.
- Il sandbox non può raggiungere le Deploy Preview: **nessuna verifica su preview è stata eseguita da Claude in questa fase**.

## Verifiche manuali: stato
| Dove | Cosa | Stato |
|---|---|---|
| Preview PR #3 (proprietario, 15 ott) | login admin e viewer, inserimento/modifica/cancellazione, 403 viewer, persistenza | **eseguita** |
| Preview PR #4 | correzione prestiti/restituzioni | contenuto presente nella preview; verifica manuale **non documentata** |
| Preview PR #6 | colonna, filtro, backup v3 | **da eseguire** (checklist nel messaggio di consegna) |
| Produzione | tutto | **nulla pubblicato** |

## Matrice delle funzionalità
Legenda: **V** = Completata e verificata (automatica + verifica reale documentata) · **NV** = Implementata ma non verificata sufficientemente · **P** = Parzialmente implementata · **M** = Mancante · **B** = Bloccata da configurazione/decisione. «Auto» = test automatici; «Prev.» = verifica manuale su preview; «Prod.» = produzione (nessuna per nessuna voce).

| # | Area / funzione | Stato | Evidenze e file | Auto | Prev. | Lacune, rischi, priorità |
|---|---|---|---|---|---|---|
| 1 | Login Netlify Identity, ruoli admin/viewer, verifica server-side | **V** (login/ruoli) | `netlify/functions/api.mts`, `server/router.ts`, `server/auth` | `server/api.test.ts` (401/403, CSRF) | PR #3: login e 403 provati | Ruoli assegnabili solo dal pannello Netlify (nessuna UI utenti): documentato. Priorità media |
| 2 | Catalogo, dashboard, ricerca, filtri, ordinamento | **NV** | `src/routes/_app.catalogo.index.tsx`, `server/booksRepo.ts` | sì (api, UI) | PR #3: elenco e persistenza; filtri/ordinamento non documentati | verificare su preview con molti record (paginazione). Alta |
| 3 | Inserimento, modifica, cancellazione schede | **V** (CRUD base) / **P** (concorrenza) | `BookForm`, `booksRepo` | sì | PR #3: provati | Nessun controllo di modifiche concorrenti (due admin: vince l'ultimo). Media |
| 4 | Dettatura vocale e ricerca multi-fonte (Open Library, Google Books, LoC SRU) | **NV** | `server/sources/*`, `/api/lookup` | solo con risposte simulate | **mai** con fonti/microfono reali | Dipende da servizi esterni non verificati; limiti di frequenza e cache solo in memoria per istanza. **Alta** |
| 5 | Importazione ISBN / CSV / JSON | **NV** | `src/lib/backup.ts`, `ImportPanel`, `docs/importazione.md` | sì (anche Postgres) | non eseguita | Provare con file `[TEST]` su preview. **Alta** |
| 6 | Deduplicazione (ID, ISBN, titolo+autore, nel file) e fusione fonti | **P** | `planRestore`; lookup manuale/assistita | sì | no | Nessun avviso di duplicato alla creazione manuale; ISBN non unico nel DB. Media |
| 7 | Editor MARC21 (indicatori, sottocampi, ripetibili, validazione) | **NV** | `src/lib/marc/*`, `docs/marc21.md` | sì | no | Regole verificate solo per 9 campi; **non** un MARC interoperabile (nessun ISO 2709). Alta |
| 8 | Soggetti, Dewey, collocazione | **NV** | migrazione 0002, `BookForm` | sì | no | Nessuna validazione DDC/soggettari: solo indicazione didattica. Media |
| 9 | Backup, ripristino, esportazioni (JSON v3, CSV, MARC testuale) | **NV** (dopo correzione) | `src/lib/export.ts`, `backup.ts` | sì, round trip su Postgres | no | **Mai provato un ripristino reale su preview**; `/api/export` in una sola risposta (limite ~6 MB); cronologia correzioni non annullative non riscritta; nessun backup automatico/programmato. **Critica** |
| 10 | Copie fisiche e disponibilità | **P** | `book_copies`, `summarizeAvailability` | sì | no | Nessuna UI per aggiungere/rimuovere copie: la copia 1 nasce al primo prestito; backup ripristina solo copia 1. Alta |
| 11 | Prestiti, restituzioni, ritardi, annullamenti, correzioni tracciate | **NV** | migrazioni 0003/0004, `loansRepo`, `BookLoans` | sì (19+12+…) | PR #4 contiene il codice; verifica manuale non documentata | Provare su preview con libro `[TEST]` e DB Netlify reale (finora PGlite). Nessun promemoria. **Alta** |
| 12 | Colonna «Stato prestito» + filtro | **NV** | vedi sezione sopra | sì | da eseguire | Verifica su preview con dati reali. **Alta** |
| 13 | Modalità didattica | **NV** | `src/lib/didattica/*` | sì | no | Contenuti da far rivedere a un catalogatore; nessun progresso salvato. Media |
| 14 | Sicurezza API | **NV** | CSRF `x-bibliotheca`, ruoli, privacy viewer | sì | PR #3: 403 sul viewer | Nessun CSP; rate limit solo in memoria; test 403 con chiamate dirette alla preview non eseguito. Alta |
| 15 | Accessibilità, tastiera, contrasto, responsive | **P** | `src/test/a11y.test.tsx`, controllo visivo locale | axe (senza contrasto) | no | Contrasto non testato; nessun test con screen reader o dispositivi reali. Media |
| 16 | Errori, prestazioni, manutenzione, documentazione | **P** | messaggi in italiano, migrazioni additive | sì | no | Nessun E2E sull'app pubblicata; nessun monitoraggio; documenti storici da tenere allineati. Media |
| 17 | Netlify: config, migrazioni, variabili, preview vs produzione, costi | **P** / **B** | `netlify.toml`, `netlify/database/migrations/` | — | preview funzionante | Anteprime copiano i dati di produzione e sono pubbliche per link; i **crediti Free** (sospensione a esaurimento) e il costo reale di Netlify Database **non sono monitorati**: da controllare nel dashboard. La preview è costruita solo per PR verso `main`. **Alta** |

**Cosa NON è «completo» anche se esiste una schermata**: ricerca fonti reali, dettatura, import/ripristino reale, MARC21 interoperabile, copie multiple da interfaccia, tutte le verifiche di produzione.

## Lacune critiche (in ordine)
1. **Ripristino mai provato su un database reale** (dati persi se fallisce in un momento di bisogno). Fix: test manuale su preview + (roadmap) backup periodico.
2. ~~Backup senza annullati/cronologia~~ → **corretto (v3)**.
3. **Nessun backup automatico**: dipende dal fatto che l'admin scarichi il file. 
4. **Esportazione in un'unica risposta** (limite ~6 MB per funzione): con cataloghi molto grandi il backup potrebbe fallire. Oggi mitigato: l'export JSON è composto dal browser leggendo a pagine.
5. **Copie fisiche non gestibili dall'interfaccia** → il conteggio «M copie» resta 1 finché non si prestano più copie via API.
6. **Fonti bibliografiche e dettatura non verificate** con servizi reali (dipendenza esterna, limiti non provati).
7. **Costi/quote Netlify non verificati**: sospensione del sito a crediti esauriti.
8. Duplicati non prevenuti alla creazione manuale; nessuna concorrenza ottimistica sulle modifiche.
9. Nessun CSP; rate limit non condiviso tra istanze.

## Roadmap
**A. Indispensabile per la prima versione completa**
| Attività | Risultato / motivazione | Dipende da | Accettazione e test | Azione manuale | Costi/limiti |
|---|---|---|---|---|---|
| A1 Verifica manuale PR #6 su preview (colonna, filtro, prestiti, backup v3) | prova su DB Netlify reale | preview pronta | checklist consegnata: tutte le voci OK | tu | CHF 0 |
| A2 Prova di ripristino reale (backup → import su preview) | affidabilità del ripristino | A1 | zero duplicati al secondo import; annullati restano annullati | tu, con libri `[TEST]` | CHF 0 |
| A3 Verifica fonti reali + dettatura | smentire/confermare il lookup | — | 3 ISBN reali trovati; dettatura in Chrome | tu | API gratuite con limiti |
| A4 Gestione copie dall'interfaccia (aggiungi/rimuovi copia, ripristino multi-copia) | rende vera la «disponibilità parziale» | A1 | test su DB + UI; nessuna perdita di prestiti | — | CHF 0 |
| A5 Avviso duplicati alla creazione manuale + conflitto di modifica | evita doppioni e sovrascritture | — | test server + UI | — | CHF 0 |
| A6 Controllo quote/costi Netlify | evita sospensione | accesso al dashboard | quota documentata, nessun auto-recharge | tu | verificare |
| A7 Pubblicazione in produzione | solo dopo A1–A3, A6 e tua conferma esplicita | A1–A6 | verifiche di produzione registrate | tu | — |

**B. Importante dopo la prima versione:** esportazione a pagine/streaming; backup periodico (Netlify scheduled function → Blob, solo se i costi restano a zero); CSP e rate limit persistente; test contrasto; E2E sulla preview (Playwright, se la rete lo consente); UI gestione utenti/ruoli; revisione dei contenuti didattici da un catalogatore; riscrittura della cronologia di correzione nel ripristino con endpoint dedicato e firmato.
**C. Opzionale:** MARC21 ISO 2709, promemoria di scadenza, soggettari/Dewey con fonti ufficiali, statistiche sulle letture.

## Documenti tecnici da leggere insieme
`docs/importazione.md` (backup v3), `docs/database.md` (migrazioni), `docs/marc21.md`, `docs/netlify-attivazione.md`, `docs/ricerca-bibliografica.md`, `docs/decisioni-e-stato.md`.
