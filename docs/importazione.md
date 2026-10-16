# Importazione del catalogo e backup

Stato: **implementata**; testata in automatico (Vitest, anche su Postgres). **Non ancora verificata a mano sulla Deploy Preview** e mai provata con le fonti reali dal sandbox di sviluppo.

Tutto passa dalle API normali (solo admin, verificato lato server). Nessuna scrittura diretta nel database. Nessuna importazione cancella schede.

## Procedura (Impostazioni → Importazione)
1. Scegli la modalità: **elenco di ISBN**, **file CSV** o **backup JSON**.
2. Anteprima: schede nuove, errori per riga, duplicati (stesso id / ISBN / titolo+primo autore / ripetuti nel file). Per ogni duplicato: salta (predefinito), aggiorna o crea comunque.
3. **Backup verificato obbligatorio**: il pulsante di importazione resta disabilitato finché non scarichi un backup (v3), che l'app rilegge e confronta (schede, copie, prestiti, annullati, correzioni) prima di consegnartelo.
4. Conferma esplicita → scrittura → risultato (create / saltate / non riuscite, con motivo).

## Modalità
- **Elenco di ISBN**: uno per riga (anche con trattini, ISBN-10). Max 150 per volta (limite ricerche: 10/min, 150/giorno per utente), pausa automatica tra le ricerche. Si importano solo corrispondenze **esatte** per ISBN; titolo, autori, editore, anno, lingua e pagine vengono dalle fonti, stato «da revisionare», con nota di provenienza. Non importati: soggetti, descrizioni, Dewey. Gli ISBN senza corrispondenza esatta sono elencati, non inventati.
- **CSV** (modello scaricabile): colonne `titolo` (obbligatoria), autori, isbn, editore, luogo, anno, lingua, descrizione_fisica, soggetti, dewey, dewey_fonte, dewey_note, collocazione, note, stato. Separatore `,` o `;`, UTF-8, max 5000 righe e 20 MB. Più autori/soggetti separati da `;` nella cella. La riga `[ESEMPIO]` del modello è rifiutata. Il CSV non porta MARC21 né prestiti.
- **Backup JSON** v1 (solo schede), v2 (schede + MARC21 + copie + prestiti con storico, senza annullati) e v3 (come v2, più prestiti annullati con motivo/autore e cronologia delle correzioni). I prestiti già presenti non vengono duplicati; un prestito annullato torna annullato, con una riga di traccia.

## Il backup è completo?
- v3: sì per schede, MARC21, copia fisica, prestiti attivi, storico restituzioni, prestiti annullati e cronologia delle correzioni (nel file; in fase di ripristino gli annullamenti sono ricostruiti con traccia, le altre correzioni restano nel file).
- Limiti: solo la copia n. 1 (non esiste UI per copie extra); nei prestiti ripristinati l'autore dell'operazione diventa chi importa; id e date di creazione delle schede non si conservano; v1 avvisa che non contiene prestiti.

## File di prova `[TEST]`
Scaricabili da Impostazioni, **mai inseriti in automatico**: 6 schede fittizie (campi incompleti, due edizioni, MARC21 completo) e 4 prestiti (storico, in corso, in ritardo). Titoli con `[TEST]`, nota «RECORD DI PROVA», stato «bozza». Si eliminano dalla scheda (quelle con prestiti prima non sono eliminabili: 409).

## Da verificare a mano sulla Deploy Preview
Login reale, ricerca fonti reale con 2–3 ISBN tuoi, importazione dei file `[TEST]`, secondo import dello stesso file (zero duplicati), ripristino del backup scaricato. Non su produzione.
