# Bibliotheca

Applicazione web **privata** per catalogare libri e, in fasi successive, imparare la catalogazione con MARC21, soggettazione e Classificazione Decimale Dewey.

> Stato: **implementata e testata in locale/CI simulata; non ancora collegata a un progetto Supabase reale né pubblicata in produzione.** Vedi `docs/decisioni-e-stato.md` per la tabella degli stati.

## Cosa fa
- Accesso con email e password (Supabase Auth), sessione persistente, uscita, recupero password. **Nessuna registrazione pubblica**: l'account lo crea il proprietario dalla dashboard di Supabase.
- Catalogo reale: inserimento (solo il titolo è obbligatorio), modifica, cancellazione con conferma, dettaglio, ricerca (titolo, autori, ISBN con/senza trattini, editore, soggetti, Dewey, collocazione…), filtro per stato, ordinamento, paginazione, dashboard con conteggi reali.
- Esportazione JSON (backup fedele) e CSV.
- Modello dati predisposto per record MARC21 completi (campi ripetibili, indicatori, sottocampi, ordine). La vista MARC è **illustrativa e non validata**: non è un file MARC interoperabile (ISO 2709 / MARCXML).

## Cosa NON c'è ancora
Importazione JSON/CSV, editor MARC21 e validazione su fonti ufficiali, soggetti e Dewey con fonti d'autorità, contenuti della modalità didattica.

## Avvio in locale
Richiede Node.js 22+ e (per usare i dati reali) un progetto Supabase configurato come in `docs/supabase-setup.md`.
```bash
cp .env.example .env.local   # poi compila URL e chiave pubblicabile (mai la chiave secret)
npm install
npm run dev        # http://localhost:5173
npm test           # test automatici (include la RLS su Postgres/PGlite)
npm run build      # build di produzione (dist/) + controllo dei tipi
```
Senza le variabili d'ambiente l'app mostra "Servizio non configurato" e non espone alcun dato.

## Architettura (sintesi)
SPA React 19 + TanStack Router + Tailwind v4 su Netlify (build statica, nessun costo di funzioni); Supabase Free per PostgreSQL e Auth. Il browser usa solo la chiave pubblicabile: la sicurezza sta nelle policy **Row Level Security** della tabella `books` (ogni utente vede e modifica solo le proprie righe). Dettagli in `docs/`.

## Documentazione
- `docs/supabase-setup.md` — passi manuali nella dashboard Supabase e Netlify
- `docs/database.md` — schema, forma del record MARC, sincronizzazione dei campi, RLS
- `docs/decisioni-e-stato.md` — decisioni tecniche, variabili d'ambiente, test, stati e limiti

Budget: CHF/EUR 0. Nessun servizio a pagamento o ricarica automatica senza approvazione esplicita. Vedi `CLAUDE.md` per le regole di sviluppo.
