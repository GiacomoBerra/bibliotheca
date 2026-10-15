# Decisioni tecniche, variabili d'ambiente, test e stato

Architettura definitiva (decisione del proprietario): **solo Netlify** — Hosting, Identity, Functions, Database. GitHub solo per il codice. Nessun Supabase.

## Decisioni
| # | Decisione | Motivo |
|---|---|---|
| D1 | Frontend SPA statica (Vite + React + TanStack Router) su Netlify | Catalogo dietro login, nessun SSR |
| D2 | Netlify Identity per login e sessioni; registrazione **solo su invito** (impostazione in dashboard) | Catalogo privato, niente autenticazione fai-da-te |
| D3 | Un'unica Netlify Function `api` per tutte le operazioni sui dati | Il browser non vede mai il database né credenziali privilegiate |
| D4 | Identità derivata dalla sessione verificata lato server (`getUser()`); ogni query filtra per `owner_id` | Mai fidarsi di un id utente inviato dal browser |
| D5 | Difese CSRF: header `x-bibliotheca`, content-type JSON, controllo Origin/Sec-Fetch-Site | Le sessioni usano cookie |
| D6 | Tabella `books` con colonne semplici + `marc_fields` (jsonb ordinato) | Schede incomplete e MARC ordinato/ripetibile |
| D7 | Solo il titolo è obbligatorio | Supporto ai record incompleti |
| D8 | Nessuna mappatura automatica campi semplici ↔ MARC | Non inventare regole MARC21 |
| D9 | **Database di produzione NON creato**: migrazioni in `db/migrations`, `@netlify/database` non installato | Costo dello storage non verificabile (non pubblicato dopo il 1 luglio 2026); evita provisioning automatico al deploy |
| D10 | Test del DB con Postgres reale (PGlite e `@netlify/database-dev` con il driver `pg` di produzione) | Niente backend simulato come unica prova |

## Variabili d'ambiente
| Nome | Dove | Contenuto | Segreta? |
|---|---|---|---|
| `NETLIFY_DB_URL` | Impostata da Netlify solo dopo l'attivazione del database | Stringa di connessione Postgres (solo Functions) | **Sì** — mai nel repo, nei log o nel browser |
Nessuna variabile `VITE_*` è necessaria.

## Costi e limiti verificati (documentazione Netlify, ottobre 2026)
- Piano Free credit-based: 300 crediti/mese; il limite è rigido (esaurimento = progetti sospesi). Identity: incluso senza costo aggiuntivo.
- Database Free: ogni ora di compute attivo consuma crediti (≈10/ora), il database va in pausa dopo ~5 minuti di inattività; un deploy di produzione ≈15 crediti. Il tetto di compute del piano Free supera i crediti mensili, quindi il budget effettivo è quello dei crediti.
- **Prezzo dello storage dopo il 1 luglio 2026: non pubblicato** → non verificabile → database non creato.
- Backup/ripristino: snapshot via API/dashboard documentati; il loro costo e la loro disponibilità nel Free non sono confermati. Fino ad allora vale l'esportazione JSON/CSV periodica.
- Le Deploy Preview del database copiano i dati di produzione (PII) e i link sono pubblici.

## Test automatici (`npm test`: 103 test, passati)
| Area | File | Cosa verifica |
|---|---|---|
| API su Postgres reale | `server/api.test.ts` (29) | 401 senza sessione su ogni rotta; identità non falsificabile (parametri/body/header); isolamento tra utenti (lista, lettura, ricerca, export, statistiche, modifica, cancellazione, cambio owner); validazione; MARC ordinato/ripetuto; tentativi di SQL injection; ISBN con/senza trattini; paginazione/ordinamento/filtro; CSRF; 503 senza DB; errori 500 generici; persistenza dopo nuova sessione; sessione scaduta con refresh; errore di rete |
| Driver di produzione | `server/pgdriver.test.ts` (4) | Stesse garanzie con `@netlify/database-dev` e `createPgDb` (`pg`) |
| Autenticazione (UI) | `src/test/auth.test.tsx` | rotte private → login; credenziali errate; ritorno alla pagina richiesta; logout; sessione scaduta; recupero password; link di invito/recupero; link non valido; Identity non configurato |
| Catalogo (UI) | `src/test/catalog.test.tsx` | elenco, ricerca, filtri, ordinamento, inserimento, modifica (conserva MARC), cancellazione, dashboard, vista MARC |
| Livello dati | `src/lib/api/units.test.ts` | mapping, ISBN, validazione, errori in italiano, export JSON/CSV |
Build e controllo di tipi: `npm run build`.

### Limiti dei test
- **Netlify Identity reale non è stato provato** (non funziona in locale): invito, email di recupero, cookie di sessione vanno verificati su una Deploy Preview. L'UI è testata con un'Identity finta.
- **Netlify Database reale non è stato provato**: i test usano Postgres reale in locale, non il servizio Netlify.
- Precedenza Function / redirect SPA e disponibilità di `NETLIFY_DB_URL` da confermare su una Deploy Preview.

## Stato delle funzionalità
| Funzionalità | Stato | Note |
|---|---|---|
| API Functions (CRUD, ricerca, statistiche, export) | implementata, testata (Postgres locale) | non su Netlify reale |
| Schema `books` (migrazione) | implementata, testata (locale) | non applicata a un database Netlify |
| Login, sessione, invito, recupero password | implementata, testata (Identity finta) | da verificare con Identity reale |
| Registrazione pubblica disattivata | proposta | impostazione in dashboard: da fare a mano |
| Catalogo, dashboard, esportazione JSON/CSV | implementata, testata | |
| Importazione JSON/CSV, ripristino | proposta | |
| Editor MARC21 / mappature / validazione | proposta | richiede fonti ufficiali |
| Deploy Preview | non verificata | repo da collegare a Netlify |
| Database di produzione | non creato | attende approvazione costi |
| Produzione | non pubblicata | richiede conferma esplicita |

## Limiti noti
- Ricerca: sottostringa su `search_text` (accenti non ignorati).
- Ordinamento per autore usa l'array `authors`.
- Nessuna Content-Security-Policy ancora impostata.
