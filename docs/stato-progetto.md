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

## Verifiche sulla Deploy Preview PR #3 (eseguite dal proprietario)
| Verifica | Esito | Eseguita da |
|---|---|---|
| Admin inserisce un libro; viewer lo vede dopo il cambio account | superata | proprietario |
| Viewer: POST/PUT/DELETE/export su preview → 403 (4 risposte) | superata | proprietario |
| Admin: POST 201; PUT e DELETE su UUID inesistente 404; export 200 | superata | proprietario |
| Admin: PUT e DELETE su record di prova esistente, poi sparizione dal catalogo | DA ESEGUIRE (script sotto) | — |
| Viewer: 403 su PUT/DELETE del record di prova esistente | DA ESEGUIRE | — |

Script (console del browser, sulla preview). Passo 1 – admin: crea e modifica il record di prova, stampa l'id.
```js
const H={"content-type":"application/json","x-bibliotheca":"1"},f=(m,u,b)=>fetch(u,{method:m,credentials:"same-origin",headers:H,body:b?JSON.stringify(b):undefined});
const c=await f("POST","/api/books",{title:"TEST-CANCELLABILE "+Date.now()});const id=(await c.json()).id;
console.log("POST",c.status,"id",id);
console.log("PUT",(await f("PUT","/api/books/"+id,{title:"TEST-CANCELLABILE modificato"})).status);
console.log("GET",(await f("GET","/api/books/"+id)).status);
```
Passo 2 – viewer (sostituisci ID): GET atteso 200; PUT, DELETE → 403.
```js
const id="ID";const H={"content-type":"application/json","x-bibliotheca":"1"},f=(m,u,b)=>fetch(u,{method:m,credentials:"same-origin",headers:H,body:b?JSON.stringify(b):undefined});
console.log("GET",(await f("GET","/api/books/"+id)).status);
console.log("PUT",(await f("PUT","/api/books/"+id,{title:"x"})).status);
console.log("DELETE",(await f("DELETE","/api/books/"+id)).status);
```
Passo 3 – admin (stesso ID): DELETE atteso 200, poi GET 404 e ricerca senza risultati.
```js
const id="ID";const H={"content-type":"application/json","x-bibliotheca":"1"},f=(m,u,b)=>fetch(u,{method:m,credentials:"same-origin",headers:H,body:b?JSON.stringify(b):undefined});
console.log("DELETE",(await f("DELETE","/api/books/"+id)).status);
console.log("GET",(await f("GET","/api/books/"+id)).status);
console.log("cerca",(await (await f("GET","/api/books?query=TEST-CANCELLABILE")).json()).total);
```
