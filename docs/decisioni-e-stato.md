# Decisioni tecniche, variabili d'ambiente, test e stato

## Decisioni
| # | Decisione | Motivo |
|---|---|---|
| D1 | Frontend SPA statica (Vite + React + TanStack Router) su Netlify | Nessun SSR: niente consumo di crediti Netlify per funzioni; catalogo dietro login |
| D2 | **Supabase Free** per PostgreSQL + Auth (sostituisce Netlify Database/Identity previsti nella prima impostazione) | Scelta del proprietario; costo CHF 0 senza metodo di pagamento; Auth e RLS integrati |
| D3 | Autorizzazione con RLS nel database; il browser usa solo la chiave pubblicabile | Una funzione serverless propria non serve e non dà più garanzie; l'UI non è una barriera |
| D4 | Registrazione pubblica disattivata; account creato dal proprietario | Requisito: catalogo privato |
| D5 | `user_id` impostato dal database (`default auth.uid()`) e verificato dalle policy | Il client non può scrivere a nome di altri |
| D6 | Tabella unica `books` con colonne semplici + `marc_fields` (jsonb ordinato) | Schede semplici e record MARC completi nello stesso modello senza perdere ordine/ripetizioni (vedi `database.md`) |
| D7 | Solo il titolo è obbligatorio | Supporto ai record incompleti per chi impara |
| D8 | Nessuna mappatura automatica campi semplici ↔ MARC | Non inventare regole MARC21: va verificata sulla documentazione ufficiale |
| D9 | Esportazione JSON/CSV prima dell'importazione | Supabase Free non ha backup; l'importazione richiede anteprima e test di ripristino (non ancora fatti) |
| D10 | Il client ha una sola implementazione di `BooksApi` (Supabase); test con implementazione in memoria | Componenti indipendenti dal backend |

## Variabili d'ambiente
| Nome | Dove | Contenuto | Segreta? |
|---|---|---|---|
| `VITE_SUPABASE_URL` | `.env.local`, Netlify (Builds) | URL del progetto Supabase | No (pubblica) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `.env.local`, Netlify (Builds) | Chiave pubblicabile (`sb_publishable_…` o anon) | No (pubblica, protetta da RLS) |
| chiave *secret* / `service_role` | **mai** nell'app, nel repo o su Netlify | — | **Sì** |
Le variabili `VITE_*` finiscono nel bundle: non metterci altro. `.env`, `.env.*` sono in `.gitignore` (eccetto `.env.example`).

## Test automatici (`npm test`)
| Area | File | Cosa verifica |
|---|---|---|
| RLS su Postgres reale (PGlite, ruoli simulati) | `src/test/rls.test.ts` | `anon` senza accesso; utente B non legge/modifica/cancella le righe di A; B non inserisce a nome di A; A non cede righe; record incompleto; MARC (ordine, ripetizioni, indicatori); RLS forzata. I test falliscono se una policy viene indebolita (verificato) |
| Autenticazione | `src/test/auth.test.tsx` | pagine private → login; nessuna registrazione; credenziali errate; login con ritorno alla pagina richiesta; logout; sessione scaduta; errore di rete; recupero password; link di recupero non valido |
| Catalogo (UI) | `src/test/catalog.test.tsx` | elenco, caricamento, vuoto, errore; ricerca; filtro; ordinamento; inserimento (validazione, incompleto, autori/soggetti); modifica (conserva MARC); cancellazione con conferma e fallimento; dashboard; vista MARC |
| Livello dati | `src/lib/api/*.test.ts` | mapping righe↔schede, ISBN, validazione, query Supabase (ilike escapato, niente `user_id`, 0 righe ≠ successo), errori in italiano, export JSON/CSV (protezione formule) |
| E2E opzionale | `e2e/e2e_mock_backend.py` | Browser reale (Chromium) sulla build di produzione con backend Supabase **simulato**: login, sessione dopo reload, CRUD, ricerca, filtri, logout, overflow su desktop/tablet/mobile |

### Limiti dei test (da non confondere con una verifica su Supabase reale)
- Supabase (GoTrue/PostgREST) è simulato: l'integrazione reale, le email di recupero e la configurazione dashboard (sign-up disattivato, URL di redirect) vanno verificate dopo aver creato il progetto.
- La RLS è testata su Postgres reale con la migrazione vera ma con `auth.uid()` simulato.

## Stato delle funzionalità
Legenda: **proposta / implementata / testata / pubblicata** (testata = test automatici passati; "su Supabase reale" è indicato a parte).
| Funzionalità | Stato | Note |
|---|---|---|
| Schema `books` + RLS (migrazione) | implementata, testata (PGlite) | non ancora eseguita su Supabase reale |
| Login, sessione, logout, rotte protette | implementata, testata (client finto + browser con backend simulato) | da verificare su Supabase reale |
| Nessuna registrazione pubblica | implementata (UI) | l'impostazione vera è nella dashboard Supabase: da fare a mano |
| Recupero password | implementata, testata (client finto) | email reali limitate nel piano Free |
| CRUD catalogo, ricerca, filtri, ordinamento, paginazione | implementata, testata | su backend simulato |
| Dashboard con conteggi reali | implementata, testata | idem |
| Esportazione JSON/CSV | implementata, testata | |
| Importazione JSON/CSV, ripristino | proposta | |
| Editor MARC21 / mappature / validazione | proposta | richiede fonti ufficiali |
| Pubblicazione su Netlify (Deploy Preview) | non verificata | serve collegare il repo e impostare le variabili |
| Produzione | non pubblicata | richiede conferma esplicita |

## Limiti noti
- Supabase Free: progetto in pausa dopo ~1 settimana di inattività; nessun backup automatico; poche email/ora.
- Ricerca: sottostringa su `search_text` (senza ignorare gli accenti).
- Ordinamento per autore usa l'array `authors` (primo autore, poi gli altri).
- Nessuna Content-Security-Policy impostata (da valutare dopo aver fissato l'URL Supabase).
