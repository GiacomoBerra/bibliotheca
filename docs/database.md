# Schema del database

Stato: **implementata** e **testata** su Postgres locale (PGlite e motore locale di Netlify via driver `pg`). **Non applicata a nessun database Netlify.**
Fonte: `netlify/database/migrations/20261016000001_books.sql` (fuori da `netlify/database/migrations` finché i costi non sono approvati).

## Tabella `books`
| Colonna | Tipo | Note |
|---|---|---|
| id | uuid PK | generato |
| created_by, updated_by | text | id utente di Netlify Identity di chi ha creato / modificato per ultimo, **impostati dal server** dalla sessione verificata; mai dal browser. Non limitano la lettura: il catalogo è condiviso |
| title | text, obbligatorio | unico campo obbligatorio (1–500 caratteri non vuoti) |
| authors | text[] | uno per elemento, ordine conservato |
| isbn, publisher, publication_place, language, physical_description, notes, dewey, shelf_mark | text | tutti facoltativi |
| publication_year | text | testo per ammettere "c1998", "[1998?]" |
| subjects | text[] | soggetti come testo libero: **non validati** su fonti d'autorità |
| status | text | `bozza` (default) / `da revisionare` / `catalogato` |
| marc_leader | text | facoltativo |
| marc_fields | jsonb array | record MARC21 completo, facoltativo (sotto) |
| search_text | text | mantenuto dal trigger, solo per la ricerca |
| created_at, updated_at | timestamptz | `updated_at` aggiornato dal trigger |

## Forma di `marc_fields`
Array JSON **ordinato**: l'ordine dei campi e dei sottocampi è quello dell'array; i campi e i sottocampi ripetuti sono semplici elementi ripetuti.
```json
[
  {"tag": "001", "value": "ID-0001"},
  {"tag": "245", "ind1": "1", "ind2": "0", "subfields": [{"code": "a", "value": "Titolo /"}, {"code": "c", "value": "Autore."}]},
  {"tag": "650", "ind1": " ", "ind2": "7", "subfields": [{"code": "a", "value": "…"}, {"code": "2", "value": "…"}]},
  {"tag": "650", "ind1": " ", "ind2": "7", "subfields": [{"code": "a", "value": "campo ripetuto"}]}
]
```
Il database garantisce solo che sia un array. La **validità MARC21** (tag ammessi, ripetibilità, indicatori) NON è controllata dal database né dall'app in questa fase: va verificata sulla documentazione ufficiale (Library of Congress) prima di dichiararla.

## Sincronizzazione tra campi semplici e MARC (regola attuale)
- I campi bibliografici semplici (titolo, autori, …) sono la **fonte di verità** per l'interfaccia, la ricerca e la dashboard.
- `marc_fields` è un contenitore **indipendente**: oggi non viene riempito né sovrascritto automaticamente e **nessun campo semplice è derivato da MARC**. Così non si perdono dati né si inventano mappature non verificate.
- Mappature automatiche (es. 245$a ↔ titolo) saranno aggiunte solo dopo verifica sulla documentazione ufficiale, con anteprima e conferma prima di modificare qualsiasi dato.
- La vista MARC della scheda resta **illustrativa e non validata**.

## Sicurezza
Non c'è RLS: il database è raggiunto solo dalla Function `api` con la stringa di connessione di Netlify (`NETLIFY_DB_URL`), che non lascia mai il server. L'autorizzazione è nel codice del server, verificata dai test:
- il catalogo è unico e condiviso; chi può fare cosa lo decide `server/router.ts` con il ruolo verificato (`admin` / `viewer`) prima di ogni query;
- il corpo della richiesta non può impostare `created_by` / `updated_by` né alcun ruolo (campi sconosciuti ignorati);
- SQL sempre parametrizzato; ORDER BY da whitelist; `%` e `_` della ricerca sono letterali;
- limiti di lunghezza anche nel database (CHECK).

## Backup e ripristino (fase 4)
Il JSON esportato (`format: bibliotheca-backup`, `version: 2`; la v1 resta leggibile) contiene tutte le schede, copie e prestiti; per le schede con tutti i campi, compresi MARC21 (ordine, ripetizioni, indicatori, sottocampi), soggetti e dati Dewey. Il ripristino (`src/lib/backup.ts`) valida ogni scheda con la stessa funzione del server, mostra anteprima e conflitti (stesso id, stesso ISBN, stesso titolo+primo autore, duplicati nel file), richiede conferma esplicita e **non cancella mai**: crea schede nuove o, per scelta dell'admin, aggiorna quelle esistenti. Scrive con le API normali (admin lato server). Le esportazioni CSV e MARC testuale non sono formati di interscambio MARC (non ISO 2709). Un ripristino non reimposta id né date originali delle schede create.

## Correzioni dei prestiti (migrazione 0004)
`loans.voided_at/voided_by/void_reason`: prestito annullato perché registrato per errore (resta nello storico). `loan_corrections`: traccia immutabile (azione `annulla_prestito` | `annulla_restituzione`, motivo, autore, data, `before_state`/`after_state` in JSON, `seq` per l'ordine). Gli indici univoci sui prestiti attivi ignorano i prestiti annullati. Ogni correzione aggiorna `loans` e scrive la traccia in una sola istruzione SQL (atomica).
