-- Bibliotheca — migrazione 0001: tabella `books` con Row Level Security.
-- Da eseguire nel SQL Editor di Supabase (vedi docs/supabase-setup.md).
-- Stato: implementata e testata su Postgres (PGlite) con ruoli simulati; NON ancora eseguita su un progetto Supabase reale.

create table public.books (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null default auth.uid() references auth.users (id) on delete cascade,

  -- Descrizione bibliografica semplificata. Solo `title` è obbligatorio:
  -- i record incompleti sono ammessi (bozze di chi sta imparando).
  title                text not null check (char_length(btrim(title)) between 1 and 500),
  authors              text[] not null default '{}',
  isbn                 text check (char_length(isbn) <= 32),
  publisher            text check (char_length(publisher) <= 300),
  publication_place    text check (char_length(publication_place) <= 300),
  publication_year     text check (char_length(publication_year) <= 20),   -- testo: ammette "c1998", "[1998?]"
  language             text check (char_length(language) <= 50),
  physical_description text check (char_length(physical_description) <= 500),
  notes                text check (char_length(notes) <= 5000),
  subjects             text[] not null default '{}',
  dewey                text check (char_length(dewey) <= 50),
  shelf_mark           text check (char_length(shelf_mark) <= 100),
  status               text not null default 'bozza' check (status in ('bozza', 'da revisionare', 'catalogato')),

  -- Record MARC21 completo (opzionale). Vedi docs/database.md per la forma.
  -- Array JSON ordinato: conserva ordine, campi ripetuti, indicatori e sottocampi.
  marc_leader          text check (char_length(marc_leader) <= 24),
  marc_fields          jsonb check (marc_fields is null or jsonb_typeof(marc_fields) = 'array'),

  search_text          text not null default '',   -- mantenuto dal trigger, solo per la ricerca
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index books_user_updated_idx on public.books (user_id, updated_at desc);
create index books_user_title_idx   on public.books (user_id, lower(title));

-- Trigger: aggiorna updated_at e search_text (minuscolo; ISBN anche senza trattini/spazi).
create function public.books_before_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.search_text := lower(concat_ws(' ',
    new.title,
    array_to_string(new.authors, ' '),
    new.isbn,
    regexp_replace(coalesce(new.isbn, ''), '[-[:space:]]', '', 'g'),
    new.publisher,
    new.publication_place,
    new.publication_year,
    new.language,
    new.physical_description,
    new.notes,
    array_to_string(new.subjects, ' '),
    new.dewey,
    new.shelf_mark
  ));
  return new;
end;
$$;

create trigger books_before_write
  before insert or update on public.books
  for each row execute function public.books_before_write();

-- Sicurezza: RLS attiva e forzata; nessun accesso anonimo.
alter table public.books enable row level security;
alter table public.books force row level security;

revoke all on public.books from anon;
revoke all on public.books from public;
grant select, insert, update, delete on public.books to authenticated;

create policy books_select_own on public.books
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy books_insert_own on public.books
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy books_update_own on public.books
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy books_delete_own on public.books
  for delete to authenticated
  using (user_id = (select auth.uid()));
