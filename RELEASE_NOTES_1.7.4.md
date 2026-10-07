# Tomorrow Now PDF Editor 1.7.4

Correzione della modifica di testo nelle scansioni.

- Lo sfondo OCR conserva il colore reale dei pixel: il bianco non diventa grigio chiaro.
- Il colore viene ricampionato durante la modifica, anche quando la selezione contiene una stima precedente.
- Correzione visiva conservativa di date e numeri nelle scansioni: fino a 16 cifre della stessa lunghezza riusano campioni compatibili della stessa pagina, senza riscrivere il resto della riga.
- Verifica OCR del risultato prima di rendere disponibile la copia; campioni mancanti, segmentazione ambigua, scansioni ruotate/sfondi colorati e costi di elaborazione eccessivi sono rifiutati.
- Limite importante: la correzione conservativa usa maschere visive. I pixel originali restano recuperabili sotto la modifica; non è uno strumento di redazione sicura o eliminazione di dati riservati.
- Il font delle scansioni è dichiarato non identificato. La riscrittura richiede una scelta esplicita, senza attribuire automaticamente Helvetica all'originale.
- Comic Sans MS, normale e grassetto, è selezionabile se già installato sul dispositivo; nessun font proprietario viene aggiunto alla distribuzione.
- Anteprima e salvataggio usano lo stesso file del font scelto. Il testo riscritto rimane modificabile dopo il salvataggio e la riapertura.
- Le righe OCR vengono adattate allo spazio disponibile. Testo troppo lungo per restare leggibile, ritorni a capo e font non utilizzabili sono rifiutati prima di cancellare l'originale.
- Regressioni sintetiche per bianco, sfondi colorati, font sconosciuti, glifi mancanti, modifiche atomiche e selezione nell'interfaccia Electron.

Limite esplicito: questa release non ricostruisce font completi da una scansione
come i motori dedicati dei prodotti professionali. La correzione delle cifre non
equivale alla riscrittura fedele di interi paragrafi. Per modifiche estese è
preferibile il documento sorgente, ad esempio Word. I documenti e i font dei
clienti usati nelle prove locali non sono inclusi nel repository.
