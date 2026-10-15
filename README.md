# Bibliotheca

Applicazione web per catalogare libri e, in fasi successive, imparare la catalogazione con MARC21, soggettazione e Classificazione Decimale Dewey.

> **Stato: prima versione dell'interfaccia (0.1.0).** Usa solo **dati dimostrativi**. Non è un sistema bibliotecario, **non conserva dati reali**, non ha database né autenticazione. Non inserire dati personali o reali.

## Cosa funziona davvero
- Navigazione tra Accesso (segnaposto), Dashboard, Catalogo, Scheda libro, Modalità didattica, Backup e impostazioni.
- Dashboard con conteggi calcolati sui dati demo.
- Ricerca nel catalogo per titolo, autore e ISBN (ignora maiuscole e spazi superflui), con stati "nessun risultato".
- Scheda libro con vista bibliografica e un esempio **illustrativo e non validato** di vista MARC21.
- Layout responsive (desktop, tablet, smartphone) e navigazione da tastiera.

## Cosa è solo dimostrativo o non ancora disponibile
- Login, salvataggio, modifica, cancellazione, import/export JSON e CSV: pulsanti disattivati o avviso "Funzione non ancora disponibile".
- Notazioni Dewey, soggetti e campi MARC21 mostrati: esempi illustrativi non validati. Una vista testuale non è un file MARC interoperabile (ISO 2709 / MARCXML).
- Contenuti della modalità didattica: in preparazione.

## Avvio in locale
Richiede Node.js 22 o superiore.

```bash
npm install
npm run dev        # sviluppo, http://localhost:5173
npm test           # test automatici
npm run build      # build di produzione (cartella dist/) + controllo dei tipi
npm run preview    # serve la build di produzione
```

## Architettura
- **Sito statico (SPA)**: React 19, TanStack Router (routing basato sui file in `src/routes`), Tailwind CSS v4, Vite. Nessun rendering lato server: per un catalogo privato dietro login non serve e consumerebbe crediti Netlify.
- **Livello dati**: i componenti usano solo l'interfaccia `BooksApi` (`src/lib/api/types.ts`). Oggi l'implementazione è demo (`src/lib/api/booksApi.ts`, dati in `src/data/demoBooks.ts`); in seguito sarà sostituita da chiamate a Netlify Functions, senza toccare i componenti.
- **Pubblicazione**: Netlify, build `npm run build`, cartella `dist`, regola di fallback SPA in `netlify.toml`.
- `.npmrc` imposta `legacy-peer-deps=true`: con npm 10 il calcolo dei peer di vitest va in errore ("edgesOut"). Rimuovere quando non più necessario.

## Prossime fasi (non ancora iniziate)
1. Persistenza online (Netlify Database o, se non sostenibile a costo zero, Supabase Free) con accesso solo da Netlify Functions.
2. Autenticazione (Netlify Identity, registrazione su invito) e autorizzazione verificata in ogni funzione.
3. Catalogo CRUD, backup JSON con ripristino validato, esportazione CSV.
4. Campi MARC21, indicatori e sottocampi, con fonti ufficiali.
5. Modalità didattica con contenuti verificati.

Budget: CHF 0 al mese. Nessun servizio a pagamento, ricarica automatica o piano superiore senza approvazione esplicita. Vedi `CLAUDE.md` per le regole di sviluppo.
