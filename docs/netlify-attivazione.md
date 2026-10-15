# Attivazione su Netlify — passaggi manuali

Stato: nulla di questo è ancora stato eseguito. Ogni passaggio è a cura del proprietario (dashboard Netlify).

## 1. Sito e Deploy Preview
Il sito Netlify `bibliotheca-sbt` esiste già (https://app.netlify.com/projects/bibliotheca-sbt). Se non sai se è collegato a GitHub: apri **Deploys**; se vedi deploy con il nome di un branch o «Deploy Preview #N» lo è. Altrimenti cerca **Project configuration** (menu a sinistra del sito) e la voce di collegamento al repository `GiacomoBerra/bibliotheca`; le etichette possono cambiare con l'interfaccia di Netlify.
Una Deploy Preview nasce aprendo una pull request su GitHub (non unirla a `main`). Le anteprime sono protette dal login Netlify del tuo team. Non pubblicare in produzione senza conferma esplicita.

## 2. Netlify Identity
1. **Project configuration > Identity > Enable Identity**.
2. **Registration preferences: Invite only** (registrazione pubblica disabilitata).
3. **Identity > Users > Invite users**: invita la tua email (account proprietario). Apri il link ricevuto sulla Deploy Preview o sul sito: l'app mostra la pagina "Accetta invito" per scegliere la password (min. 12 caratteri).
Identity non funziona con `netlify dev`: va provato su una Deploy Preview.

## 2b. Ruoli (obbligatori: senza ruolo non si accede ai dati)
In **Identity > Users**, apri l'utente → **Edit settings** (o «Edit user») → campo **Roles** → scrivi `admin` (o `viewer`) e salva. I nomi sono minuscoli e senza spazi. L'invito non assegna da solo un ruolo. Il ruolo vale dal login successivo (esci e rientra). Gli utenti `viewer` vedono e cercano lo stesso catalogo ma non possono modificare, cancellare, importare o esportare.

## 2c. Variabili per la ricerca bibliografica (facoltative)
**Project configuration > Environment variables**: `LOOKUP_CONTACT` (la tua email, usata solo nello User-Agent verso Open Library) e, solo se Google Books rifiuta le richieste senza chiave, `GOOGLE_BOOKS_API_KEY` (chiave gratuita, scope **Functions**, segreta). Dopo averle create serve un nuovo deploy.

## 3. Database — SOLO dopo aver approvato i costi
Prima: controlla in **Team settings > Billing** il prezzo dello storage e i crediti residui; non attivare ricariche automatiche. Poi, in un branch:
```bash
npm i @netlify/database
git mv db/migrations netlify/database/migrations
```
Pubblica prima una **Deploy Preview**: Netlify crea un branch del database con una copia dei dati di produzione (PII) e link pubblici. Verifica: invito → login → crea/modifica/cancella scheda → logout → nuovo login → la scheda c'è. Solo dopo, valuta la produzione.

## 4. Verifiche da fare sulla Deploy Preview
- `/api/books` risponde (Function prima del redirect SPA) e senza login dà 401.
- `NETLIFY_DB_URL` disponibile alla Function.
- Email di invito e di recupero password ricevute.
- Esporta JSON dopo l'inserimento (backup).

## 5. Backup
Esporta il catalogo (Impostazioni) con regolarità. Snapshot Netlify Database: verifica disponibilità e costi nel dashboard prima di contarci.
