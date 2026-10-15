# Schema del database

Stato: **implementata** e **testata** (PGlite, ruoli simulati). Non ancora eseguita su Supabase reale.
Fonte: `supabase/migrations/20261015000001_books.sql`.

## Tabella `public.books`
| Colonna | Tipo | Note |
|---|---|---|
| id | uuid PK | generato |
| user_id | uuid FK auth.users | default `auth.uid()`; la RLS impedisce di impostarne un altro |
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

## Sicurezza (RLS)
RLS attiva **e forzata** su `books`; `anon` senza alcun privilegio; `authenticated` può SELECT/INSERT/UPDATE/DELETE solo righe con `user_id = auth.uid()` (4 policy). L'app usa solo la chiave pubblicabile: l'autorizzazione è nel database, non nell'interfaccia.
