# Tomorrow Now PDF Editor 1.7.5

- La modifica di una sola parola può riutilizzare il font CFF CID incorporato
  quando i caratteri necessari sono già presenti e verificabili nel documento.
- Le altre parole, le righe vicine e la ricerca del testo vengono verificate
  prima di salvare. Nessuna riscrittura dell'intero paragrafo.
- La cancellazione del testo nativo usa un'area verificata: le metriche alte dei
  font non devono cancellare accidentalmente le righe adiacenti.
- Il backend confezionato Mac/Windows deve superare anche il test sintetico CID.

Non è una ricostruzione universale dei font o dei paragrafi come Acrobat. Font,
caratteri o trasformazioni non supportati richiedono un'alternativa esplicita
oppure l'annullamento; nessuna sostituzione silenziosa. Conservare l'originale e
controllare il PDF esportato. L'anteprima HTML dei font fuori catalogo può differire
dal PDF salvato. Non è una funzione di redazione sicura.

Mac: build ARM64, macOS 13+, da firmare e notarizzare prima della distribuzione.
Windows x64: candidata non firmata, da collaudare su un PC utente; la CI non
sostituisce il collaudo fisico. Aggiornamento Windows manuale.
