-- Bibliotheca — migrazione 0007: cancellazione DEFINITIVA, voluta dal proprietario, di una scheda con tutto il suo storico.
-- ADDITIVA: non modifica né cancella alcun dato esistente. Aggiunge la funzione purge_book() e fa in modo che la traccia
-- delle correzioni (immutabile) possa essere cancellata SOLO dall'interno di purge_book(). Qualsiasi altra UPDATE/DELETE
-- sulla traccia continua a essere rifiutata.
--
-- purge_book(id) è una sola funzione = una sola transazione: o sparisce tutto (correzioni, prestiti, copie, scheda) o nulla.

create or replace function loan_corrections_immutable()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and current_setting('bibliotheca.purge_book', true) = 'on' then
    return old;
  end if;
  raise exception 'La traccia delle correzioni dei prestiti non può essere modificata né cancellata.';
end;
$$;

create function purge_book(p_book uuid)
returns jsonb
language plpgsql
as $$
declare
  n_corr int := 0;
  n_loans int := 0;
  n_copies int := 0;
  n_books int := 0;
begin
  perform set_config('bibliotheca.purge_book', 'on', true); -- valido solo per questa transazione
  delete from loan_corrections where loan_id in (select id from loans where book_id = p_book);
  get diagnostics n_corr = row_count;
  delete from loans where book_id = p_book;
  get diagnostics n_loans = row_count;
  delete from book_copies where book_id = p_book;
  get diagnostics n_copies = row_count;
  delete from books where id = p_book;
  get diagnostics n_books = row_count;
  perform set_config('bibliotheca.purge_book', 'off', true);
  return jsonb_build_object('deleted', n_books, 'loans', n_loans, 'corrections', n_corr, 'copies', n_copies);
end;
$$;
