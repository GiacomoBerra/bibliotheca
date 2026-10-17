-- Bibliotheca — migrazione 0006: identificazione delle copie fisiche. ADDITIVA (solo colonne facoltative e un indice).
--
-- Una copia può avere un codice di inventario (o etichetta) e una nota (es. «scaffale B, dorso rovinato»).
-- Il codice, se presente, è univoco in tutta la biblioteca (senza distinguere maiuscole/minuscole).
-- Le copie non si cancellano: i prestiti collegati devono restare nello storico.

alter table book_copies
  add column inventory_code text check (inventory_code is null or char_length(btrim(inventory_code)) between 1 and 50),
  add column notes text check (notes is null or char_length(notes) <= 500);

create unique index book_copies_inventory_code_uidx on book_copies (lower(btrim(inventory_code))) where inventory_code is not null;

-- Ogni libro ha sempre la copia n. 1 (prima nasceva al primo prestito): così codice e note si possono impostare subito.
-- Solo inserimenti; nessuna riga esistente è modificata. I conteggi di disponibilità non cambiano (il totale era già almeno 1).
insert into book_copies (book_id, copy_no) select id, 1 from books on conflict (book_id, copy_no) do nothing;
