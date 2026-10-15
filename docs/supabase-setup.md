# Configurazione di Supabase (operazioni manuali, una tantum)

Stato: **proposta** — nessun progetto Supabase è stato creato da Claude. Costo previsto: CHF 0 (piano Free, nessuna carta richiesta).
Non comunicare mai password o chiavi segrete in chat, nel repository o nei log.

## 1. Creare il progetto (Supabase dashboard)
1. supabase.com → *New project*. Piano **Free**. Scegli una regione europea (es. Frankfurt). Scegli tu la password del database e conservala nel tuo password manager (non serve all'app né a Claude).
2. Non attivare add-on, *compute upgrade* o *spend cap off*: devono restare disattivati.

## 2. Eseguire la migrazione
SQL Editor → *New query* → incolla il contenuto di `supabase/migrations/20261015000001_books.sql` → *Run*.
Verifica: *Table Editor → books* mostra il badge "RLS enabled"; *Authentication → Policies* elenca 4 policy `books_*_own`.

## 3. Autenticazione (Authentication → Sign In / Providers)
1. **Email**: attivo. Password minima ≥ 12 caratteri se disponibile.
2. **Allow new users to sign up**: **DISATTIVARE** (registrazione chiusa). Con le iscrizioni disattivate l'unico modo per creare utenti è la dashboard.
3. Disattiva gli altri provider (Anonymous sign-ins incluso).
4. *Authentication → Users → Add user → Create new user*: inserisci la tua email e una password scelta da te, spunta *Auto Confirm User*. Quello è l'account proprietario.
5. *Authentication → URL Configuration*: **Site URL** = URL di produzione Netlify; **Redirect URLs** = `https://<sito>.netlify.app/reimposta-password`, `http://localhost:5173/reimposta-password`, e l'URL delle Deploy Preview (`https://deploy-preview-*--bibliotheca-sbt.netlify.app/reimposta-password`).
6. Recupero password: usa il servizio email integrato di Supabase, che nel piano Free ha un **limite molto basso di email l'ora** (pochi invii) e invia solo agli indirizzi dei membri del team se non configuri un SMTP proprio. Per l'account proprietario basta. Alternativa se non arriva: reimposta la password dalla dashboard (*Users → ⋯ → Send password recovery* o *Update user*).

## 4. Chiavi per il frontend
*Project Settings → API Keys* (o *API*): copia **Project URL** e la chiave **publishable** (`sb_publishable_…`; in progetti più vecchi "anon public").
**Non copiare** la chiave *secret* / *service_role*.
- In locale: file `.env.local` (vedi `.env.example`).
- Su Netlify: Project configuration → Environment variables → aggiungi `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` (ambiti: *Builds*; contesti: *Deploy Previews* e, solo a tua conferma, *Production*). Le variabili `VITE_*` finiscono nel bundle pubblico: per questo devono essere solo valori pubblicabili.
Dopo averle aggiunte, rilancia la Deploy Preview (*Trigger deploy*).

## 5. Verifica manuale dell'isolamento (consigliata)
Con un secondo utente di prova creato in dashboard, accedi e controlla che il catalogo sia vuoto e non mostri i libri del proprietario; poi cancella l'utente di prova. I test automatici (`npm test`) verificano le stesse regole su Postgres locale simulato, non sul tuo progetto reale.

## Limiti del piano Free da conoscere
- Il progetto viene **messo in pausa dopo ~1 settimana di inattività** (riattivabile dalla dashboard; i dati restano).
- **Nessun backup automatico incluso**: usa regolarmente l'esportazione JSON (Backup e impostazioni).
- 500 MB di database, 5 GB di traffico: ampiamente sufficienti per migliaia di schede. Verifica i valori aggiornati in *Settings → Billing/Usage*.
