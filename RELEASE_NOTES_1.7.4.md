# Tomorrow Now PDF Editor 1.7.4

Correzione della modifica di testo nelle scansioni.

- Lo sfondo OCR conserva il colore reale dei pixel: il bianco non diventa grigio chiaro.
- Il colore viene ricampionato durante la modifica, anche quando la selezione contiene una stima precedente.
- Il font delle scansioni è dichiarato non identificato. La riscrittura richiede una scelta esplicita, senza attribuire automaticamente Helvetica all'originale.
- Comic Sans MS, normale e grassetto, è selezionabile se già installato sul dispositivo; nessun font proprietario viene aggiunto alla distribuzione.
- Anteprima e salvataggio usano lo stesso file del font scelto. Il testo riscritto rimane modificabile dopo il salvataggio e la riapertura.
- Le righe OCR vengono adattate allo spazio disponibile. Testo troppo lungo per restare leggibile, ritorni a capo e font non utilizzabili sono rifiutati prima di cancellare l'originale.
- Regressioni sintetiche per bianco, sfondi colorati, font sconosciuti, glifi mancanti, modifiche atomiche e selezione nell'interfaccia Electron.

Limite esplicito: su una scansione non è possibile garantire la ricostruzione identica
del font e della dimensione originali. Per fedeltà esatta serve il documento sorgente,
ad esempio il file Word. I documenti usati nelle prove locali non sono inclusi nel repository.
