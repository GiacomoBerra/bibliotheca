-- Bibliotheca — migrazione 0004: annullamento di prestiti registrati per errore e traccia delle correzioni.
-- ADDITIVA: nessun dato esistente viene modificato o cancellato. L'unico oggetto sostituito è l'indice univoco
-- «un prestito attivo per copia», che ora ignora i prestiti annullati (stesso vincolo, una condizione in più).
--
--  * Un prestito annullato NON si cancella: resta in `loans` con data, autore e motivazione dell'annullamento.
--  * Ogni correzione (annullamento di un prestito, annullamento di una restituzione) aggiunge una riga NON modificabile
--    in `loan_corrections`, con i valori prima e dopo.

alter table loans
  add column voided_at   timestamptz,
  add column voided_by   text check (char_length(voided_by) <= 200),
  add column void_reason text check (char_length(void_reason) between 3 and 500);

alter table loans
  add constraint loans_void_consistent check ((voided_at is null) = (voided_by is null) and (voided_at is null) = (void_reason is null));

-- Un solo prestito attivo per copia: i prestiti annullati non contano.
drop index loans_one_active_per_copy;
create unique index loans_one_active_per_copy on loans (copy_id) where returned_date is null and voided_at is null;
drop index loans_active_idx;
create index loans_active_idx on loans (due_date) where returned_date is null and voided_at is null;

create table loan_corrections (
  id           uuid primary key default gen_random_uuid(),
  seq          bigint generated always as identity, -- ordine certo anche con timestamp uguali
  loan_id      uuid not null references loans(id) on delete restrict,
  action       text not null check (action in ('annulla_prestito', 'annulla_restituzione')),
  reason       text not null check (char_length(btrim(reason)) between 3 and 500),
  corrected_by text not null check (char_length(corrected_by) between 1 and 200),
  corrected_at timestamptz not null default now(),
  before_state jsonb not null,
  after_state  jsonb not null
);
create index loan_corrections_loan_idx on loan_corrections (loan_id, seq desc);

-- La traccia è immutabile: nessuna modifica né cancellazione, nemmeno per errore.
create function loan_corrections_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'La traccia delle correzioni dei prestiti non può essere modificata né cancellata.';
end;
$$;
create trigger loan_corrections_no_update before update or delete on loan_corrections for each row execute function loan_corrections_immutable();
