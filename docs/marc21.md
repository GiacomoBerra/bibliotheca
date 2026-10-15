# Editor MARC21 (fase 2)

**Stato:** implementato e testato (automatico). Non ancora verificato manualmente su Deploy Preview.

- Record = leader (24 caratteri) + elenco ordinato di campi. Campi di controllo (001–009: solo valore) e campi dati (010–999: 2 indicatori, sottocampi ordinati e ripetibili). Ordine, ripetizioni, indicatori e sottocampi sono salvati così come inseriti (`jsonb` ordinato).
- **Validità strutturale** (`src/lib/marc/structure.ts`): imposta anche dal server a ogni scrittura (HTTP 400 con messaggio). Non è correttezza catalografica.
- **Regole di formato verificate** (`src/lib/marc/rules.ts`) solo per 020, 100, 245, 264, 300, 653, 700 su https://www.loc.gov/marc/bibliographic/bdNNN.html, consultate il 15/10/2026: ripetibilità, indicatori, ripetibilità dei sottocampi. Violazioni = avviso, non blocco. Per ogni altro campo nessuna regola è inventata.
- **Collegamento ai dati generali** (`src/lib/marc/fromBook.ts`): esplicito, in un solo verso, con anteprima e conferma; genera solo i 7 tag sopra. Indicatori non deducibili (245 ind. 1/2, 100/700 ind. 1 senza «Cognome, Nome») sono impostati in modo provvisorio e segnalati. Nessuna punteggiatura ISBD, nessuna inversione dei nomi. Il confronto dati generali ↔ MARC segnala incoerenze senza correggerle.
- Il leader iniziale proposto è un modello da controllare.
- La vista testuale (`=245  10$a…`) non è ISO 2709 né MARCXML.
