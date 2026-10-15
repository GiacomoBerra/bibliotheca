# Stato del progetto — 15 ott 2026

Stati: proposta / implementata / testata / pubblicata. «Preview» = verificato dal proprietario su Deploy Preview PR #3.

| Funzione | Stato | Prova |
|---|---|---|
| Catalogo condiviso su Netlify Database (inserimento, elenco, scheda) | testata (automatica) + verificata in preview | 193 test; admin inserisce, viewer vede il libro (proprietario) |
| Ruoli admin/viewer verificati lato server | testata (automatica) | server/api.test.ts; viewer 403 su POST/PUT/DELETE/export |
| Identity (login, invito) | verificata in preview (login admin e viewer) | proprietario |
| Persistenza dopo logout/login | verificata in preview (libro visibile al viewer dopo cambio account) | proprietario |
| Ricerca bibliografica (Open Library, Google Books) | implementata e testata con risposte simulate | API reali non ancora verificate |
| Dettatura vocale | implementata e testata con riconoscimento simulato | browser reale non ancora provato |
| Errori database precisi | testata | api.test.ts |
| 403 via chiamate dirette alla preview | NON eseguita sulla preview | solo test automatici |
| Produzione | NON pubblicata | PR #3 non unita a main |

## Da sviluppare
Esportazione/importazione JSON-CSV con validazione e backup (proposta), mappatura e validazione MARC21 con fonti autorevoli, soggettazione e Dewey didattici, funzioni di apprendimento, test di ripristino, accessibilità/responsive da verificare, gestione inviti/ruoli documentata, pubblicazione in produzione dopo conferma.
