-- Bibliotheca — migrazione 0002: note e fonte della classificazione Dewey (solo colonne NUOVE, nullable: non distruttiva).
-- `dewey_source` registra da dove viene la proposta; NON attesta che la notazione sia corretta.
alter table books
  add column dewey_notes text check (dewey_notes is null or char_length(dewey_notes) <= 2000),
  add column dewey_source text check (dewey_source is null or dewey_source in ('manuale', 'fonte-esterna', 'verificata-ddc'));
