# Ricerca bibliografica e catalogazione vocale

Stato: **implementata, testata con risposte simulate**. **Non** provata con i servizi reali né su Netlify (la sandbox di sviluppo non raggiunge le API esterne): vedi «Verifiche da fare».

## Fonti
| Fonte | Stato | Accesso | Note |
|---|---|---|---|
| Open Library | integrata | API ufficiali senza chiave: `/api/books` (con ISBN → una edizione) e `/search.json` (titolo/autore → livello opera) | 1 richiesta/s anonime, 3/s se identificati: l'app invia un User-Agent con contatto (variabile `LOOKUP_CONTACT`) e distanzia le richieste (≥ 400 ms). Niente download massivi né scraping |
| Google Books | integrata | `volumes` | La documentazione ufficiale dice che servono chiave o token. Il connettore prova senza chiave; se Google rifiuta, la fonte risulta «non disponibile». Eventuale chiave gratuita in `GOOGLE_BOOKS_API_KEY` (solo server) |
| Library of Congress | **non integrata** | — | L'endpoint JSON `loc.gov/books/` «non fornisce tutte le informazioni di catalogo» e non documenta la ricerca per ISBN; il catalogo completo si interroga via SRU/Z39.50, di cui non ho potuto verificare indirizzo, formato e condizioni d'uso. Si aggiunge scrivendo un nuovo connettore in `server/sources/` |

Ogni fonte è un connettore indipendente (`server/sources/*.ts`, interfaccia `Source`); un errore o un timeout di una non blocca le altre.

## Flusso e sicurezza
`/api/lookup` (solo `admin`, GET): valida i parametri → limita la frequenza per utente (10/min, 150/giorno per istanza) → interroga le fonti in parallelo (timeout 6 s) → cache in memoria 24 h per fonte e richiesta (gli errori non si salvano; «Ripeti la ricerca» la salta) → raggruppa e classifica. **Non scrive nulla nel catalogo**: i dati entrano nella scheda solo con «Usa questi dati» e diventano record solo con «Salva». Cache e limiti sono per istanza della Function (best effort, non globali). Le chiavi non arrivano mai al browser (test sul codice client e sul bundle).

## Corrispondenze (nessuna percentuale)
- **esatta**: la richiesta ha un ISBN e il gruppo ha lo stesso ISBN-13 (ISBN-10 convertiti);
- **probabile**: titolo uguale (maiuscole, accenti, punteggiatura e articolo iniziale ignorati) e coincidono tutti gli altri criteri forniti (autore, anno, editore);
- **simile**: titolo uguale o parziale, ma qualche criterio non coincide;
- **dati incompleti** (segnalazione a parte): mancano almeno due tra autori, editore, anno, ISBN.
Raggruppamento: stesso ISBN-13, oppure stesso titolo + primo autore + anno + editore (se presente in entrambi) senza ISBN in conflitto. Edizioni, traduzioni e record a livello di opera non si fondono mai.

## Importazione («Usa questi dati»)
Campi compilabili: titolo (anche «titolo: sottotitolo»), autori, ISBN, editore, luogo, anno (estratto dalla data), lingua (come scritta dalla fonte, non convertita), descrizione fisica («N pagine»), soggetti (suggeriti, non selezionati di default), note (descrizione della fonte, non selezionata di default). Mai toccati: Dewey, collocazione, stato, record MARC21 (`marcLeader`, `marcFields`). Gli autori restano nella forma della fonte (non invertiti secondo le regole catalografiche). Un campo già compilato si sostituisce solo spuntando la riga; i valori discordanti si scelgono a mano; l'importazione si annulla. I risultati a livello di opera propongono solo titolo, autori e soggetti.

## MARC21
**Nessuna mappatura verso MARC21 è implementata**: il modello non ha ancora un editor MARC e non esiste una regola verificata su documentazione ufficiale. Quando si implementerà, ogni mappatura andrà documentata qui (origine, campo, indicatori/sottocampi, limiti).

## Voce
Riconoscimento vocale nativo del browser (`SpeechRecognition`), solo al clic, non continuo, nessun audio conservato; lingue it/de/fr/en; trascrizione modificabile; interpretazione locale della frase (modelli di frase, nessuna IA) in campi modificabili; la ricerca parte solo con «Cerca» (o con l'opzione «Cerca subito»). Dettatura anche in titolo, autori, editore, luogo, descrizione fisica, soggetti e note. Senza supporto del browser o senza permesso c'è un messaggio e si continua a mano. Alcuni browser inviano l'audio a un servizio remoto: è scritto nella schermata.

## Verifiche da fare (non eseguite)
1. Sulla Deploy Preview: ricerca reale per ISBN e per titolo su Open Library e Google Books, per controllare i formati delle risposte (i parser sono scritti sulla documentazione e testati con risposte simulate).
2. Controllare se Google Books risponde senza chiave; altrimenti decidere se creare una chiave gratuita.
3. Dettatura reale nei browser usati (Chrome, Safari, Firefox: il supporto varia).
4. Il caso d'uso completo: dettare, trovare, scegliere, importare, salvare — richiede anche il database.
