-- Bibliotheca — migrazione 0005: provenienza dei dati ripristinati da un backup.
-- ADDITIVA: solo due colonne facoltative per tabella; nessun dato esistente è modificato o cancellato.
--
-- Quando un prestito (e la sua cronologia di correzioni) viene ripristinato da un backup, conserva autore e date
-- ORIGINALI nelle colonne di sempre; qui si registra soltanto CHI e QUANDO ha eseguito il ripristino, così la
-- cronologia ripristinata resta distinguibile da quella creata direttamente nell'app.

alter table loans
  add column restored_at timestamptz,
  add column restored_by text check (char_length(restored_by) <= 200),
  add constraint loans_restore_consistent check ((restored_at is null) = (restored_by is null));

alter table loan_corrections
  add column restored_at timestamptz,
  add column restored_by text check (char_length(restored_by) <= 200),
  add constraint loan_corrections_restore_consistent check ((restored_at is null) = (restored_by is null));
