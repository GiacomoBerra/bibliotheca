-- Bibliotheca — migrazione 0001 (Postgres / Netlify Database): tabella `books`.
-- Stato: implementata e testata su Postgres locale. NON applicata a nessun database Netlify.
-- Si trova in `db/migrations` (e non in `netlify/database/migrations`) di proposito: Netlify applica
-- e PROVVEDE il database da solo se trova quella cartella. Si sposta lì solo dopo approvazione dei costi
-- (vedi docs/netlify-attivazione.md).
--
-- Sicurezza: il browser non si collega mai al database. Solo le Netlify Functions lo interrogano e
-- ogni query è filtrata con `owner_id` = id utente verificato lato server (mai fornito dal browser).

create table books (
  id                   uuid primary key default gen_random_uuid(),
  owner_id             text not null check (char_length(owner_id) between 1 and 200),

  -- Solo `title` è obbligatorio: i record incompleti sono ammessi.
  title                text not null check (char_length(btrim(title)) between 1 and 500),
  authors              text[] not null default '{}',
  isbn                 text check (char_length(isbn) <= 32),
  publisher            text check (char_length(publisher) <= 300),
  publication_place    text check (char_length(publication_place) <= 300),
  publication_year     text check (char_length(publication_year) <= 20),
  language             text check (char_length(language) <= 50),
  physical_description text check (char_length(physical_description) <= 500),
  notes                text check (char_length(notes) <= 5000),
  subjects             text[] not null default '{}',
  dewey                text check (char_length(dewey) <= 50),
  shelf_mark           text check (char_length(shelf_mark) <= 100),
  status               text not null default 'bozza' check (status in ('bozza', 'da revisionare', 'catalogato')),

  -- Record MARC21 completo (opzionale): array JSON ordinato, vedi docs/database.md
  marc_leader          text check (char_length(marc_leader) <= 24),
  marc_fields          jsonb check (marc_fields is null or jsonb_typeof(marc_fields) = 'array'),

  search_text          text not null default '',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index books_owner_updated_idx on books (owner_id, updated_at desc);
create index books_owner_title_idx   on books (owner_id, lower(title));

create function books_before_write()
returns trigger
language plpgsql
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
  before insert or update on books
  for each row execute function books_before_write();
