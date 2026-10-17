-- Bibliotheca — migrazione 0003: copie fisiche e prestiti. SOLO additiva (nessuna modifica a `books`).
--
-- Modello:
--  * `book_copies`: una riga per copia fisica di un'opera. Oggi ogni libro ha al più la copia n. 1 (creata
--    al primo prestito); il modello consente già più copie dello stesso libro.
--  * `loans`: UN record per ogni prestito, conservato dopo la restituzione (che valorizza `returned_date`).
--    Lo stato (in prestito / in ritardo / restituito) NON è memorizzato: si ricava da date e data odierna.
--  * Un solo prestito attivo per copia: indice univoco parziale, applicato dal database anche con richieste simultanee.
--  * Lo storico non si perde: cancellare un libro (o una copia) con prestiti è rifiutato (ON DELETE RESTRICT).

create table book_copies (
  id         uuid primary key default gen_random_uuid(),
  book_id    uuid not null references books(id) on delete cascade,
  copy_no    integer not null check (copy_no between 1 and 999),
  created_at timestamptz not null default now(),
  unique (book_id, copy_no),
  unique (id, book_id)
);

create table loans (
  id            uuid primary key default gen_random_uuid(),
  book_id       uuid not null,
  copy_id       uuid not null,
  borrower_name text not null check (char_length(btrim(borrower_name)) between 1 and 200),
  contact       text check (char_length(contact) <= 200),
  loan_date     date not null,
  planned_days  integer not null check (planned_days between 1 and 365),
  due_date      date not null,
  returned_date date,
  notes         text check (char_length(notes) <= 1000),
  created_by    text not null check (char_length(created_by) between 1 and 200),
  returned_by   text check (char_length(returned_by) <= 200),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- la copia deve appartenere al libro indicato
  foreign key (copy_id, book_id) references book_copies (id, book_id) on delete restrict,
  foreign key (book_id) references books (id) on delete restrict,

  -- coerenza delle date
  constraint loans_due_matches_duration check (due_date = loan_date + planned_days),
  constraint loans_return_not_before_loan check (returned_date is null or returned_date >= loan_date),
  constraint loans_returned_by_consistent check ((returned_date is null) = (returned_by is null))
);

-- Impedisce due prestiti contemporanei sulla stessa copia fisica.
create unique index loans_one_active_per_copy on loans (copy_id) where returned_date is null;
create index loans_book_idx     on loans (book_id, loan_date desc);
create index loans_active_idx   on loans (due_date) where returned_date is null;
create index loans_borrower_idx on loans (lower(borrower_name));

create function loans_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger loans_before_update before update on loans for each row execute function loans_touch();
