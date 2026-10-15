# Bibliotheca

Biblioteca personale **privata** per catalogare libri e, in fasi successive, imparare la catalogazione con MARC21, soggettazione e Dewey. Interamente su Netlify: Hosting, Identity (login su invito), Functions (API), Database (PostgreSQL).

> Stato: **implementata e testata in locale. Non ancora provata su Netlify**: nessun database Netlify è stato creato (costo dello storage non verificabile), Identity non è stato provato su una Deploy Preview, niente è pubblicato in produzione. Vedi `docs/decisioni-e-stato.md`.

## Cosa fa
- Accesso con email e password (Netlify Identity), invito del proprietario, recupero password, sessione persistente, uscita. **Nessuna registrazione pubblica.**
- Catalogo: inserimento (solo il titolo è obbligatorio), modifica, cancellazione con conferma, dettaglio, ricerca, filtro per stato, ordinamento, paginazione, dashboard con conteggi reali, esportazione JSON/CSV.
- Modello dati pronto per record MARC21 completi (campi ripetibili, indicatori, sottocampi, ordine). La vista MARC è **illustrativa e non validata**, non è un file MARC interoperabile.
- Ogni operazione sui dati passa da API protette (Netlify Functions): identità verificata lato server, query sempre limitate ai dati dell'utente. Il browser non ha credenziali del database.

## Non ancora disponibile
Importazione JSON/CSV, editor MARC21 e validazione su fonti ufficiali, soggetti/Dewey con fonti d'autorità, contenuti didattici.

## Sviluppo in locale
Node 22+.
```bash
npm install
npm test         # test automatici (API e database su Postgres locale, autenticazione, interfaccia)
npm run build    # build + controllo dei tipi (compila anche le Functions per il controllo dei tipi)
npm run dev      # solo interfaccia: login e API NON funzionano in locale (Identity richiede un deploy)
```

## Attivazione su Netlify
Operazioni manuali e ordine: `docs/netlify-attivazione.md`.

## Documentazione
`docs/netlify-attivazione.md` · `docs/database.md` · `docs/decisioni-e-stato.md`. Regole di sviluppo: `CLAUDE.md`. Budget: CHF/EUR 0, nessun servizio a pagamento senza approvazione esplicita.
