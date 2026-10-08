# Tomorrow Now PDF Editor 1.7.4

Correzione della modifica di testo nelle scansioni.

- Lo sfondo OCR conserva il colore reale dei pixel: il bianco non diventa grigio chiaro.
- Il colore viene ricampionato durante la modifica, anche quando la selezione contiene una stima precedente.
- Le modifiche native che richiedono un altro font mostrano il nome originale e quello proposto: conferma obbligatoria anche per le sostituzioni multiple. Annullamento ed Esc non salvano modifiche.
- Corretti gli abbinamenti tra font normali e grassetti; il nome riportato corrisponde alla risorsa realmente usata.
- I livelli OCR invisibili restano ricercabili ma non vengono trattati come testo nativo visibile: si evita la riscrittura sopra i pixel originali.
- La modalità cifre viene rifiutata se il bersaglio ha un livello OCR nascosto, per non lasciare il vecchio valore nella ricerca e nel copia/incolla. La riscrittura con un font esplicito resta disponibile.
- I nomi lunghi dei font troncati da MuPDF vengono ricondotti al nome completo solo quando la rappresentazione è esatta e univoca, conservando normale, grassetto e corsivo senza abbinamenti generici per prefisso.
- Correzione visiva conservativa di date e numeri nelle scansioni: fino a 16 cifre della stessa lunghezza riusano campioni compatibili della stessa pagina, senza riscrivere il resto della riga.
- Verifica OCR del risultato prima di rendere disponibile la copia; campioni mancanti, segmentazione ambigua, scansioni ruotate/sfondi colorati e costi di elaborazione eccessivi sono rifiutati.
- I riquadri OCR che tagliano l'inchiostro delle cifre sono rifiutati prima di applicare maschere o acquisire campioni, con un margine di controllo bounded.
- Limite importante: la correzione conservativa usa maschere visive. I pixel originali restano recuperabili sotto la modifica; non è uno strumento di redazione sicura o eliminazione di dati riservati.
- Il font delle scansioni è dichiarato non identificato. La riscrittura richiede una scelta esplicita, senza attribuire automaticamente Helvetica all'originale.
- Comic Sans MS, normale e grassetto, è selezionabile se già installato sul dispositivo; nessun font proprietario viene aggiunto alla distribuzione.
- Anteprima e salvataggio usano lo stesso file del font scelto. Il testo riscritto rimane modificabile dopo il salvataggio e la riapertura.
- Le righe OCR vengono adattate allo spazio disponibile. Testo troppo lungo per restare leggibile, ritorni a capo e font non utilizzabili sono rifiutati prima di cancellare l'originale.
- Regressioni sintetiche per bianco, sfondi colorati, font sconosciuti, glifi mancanti, modifiche atomiche e selezione nell'interfaccia Electron.
- Banner Tomorrow Now più leggibile su Mac e Windows: marchio più grande, motto inglese sempre visibile, contrasto verificato e collegamento al sito.
- Il processo OCR non eredita più il canale di comunicazione aperto dell'app. La build Mac allinea il requisito del motore OCR a macOS 13 e lo verifica nel pacchetto.
- Il focus del riquadro di testo non viene più spostato in un frame successivo mentre l'utente sta digitando nel pannello laterale. Un test con frame ritardato impedisce la regressione.
- La verifica delle sostituzioni multiple cerca il vecchio testo anche dentro righe più lunghe e segnala le ricerche troncate, evitando una conferma positiva basata solo su corrispondenze integrali.
- Se la sostituzione contiene volutamente il testo cercato o cambia solo le maiuscole, la verifica è dichiarata non conclusiva: nessun falso avviso di vecchie occorrenze residue.
- Un nome esatto che collide con il nome troncato di un altro font non autorizza il riuso di una risorsa ambigua. La sostituzione richiede consenso e i file restano intatti in caso di annullamento.
- Test del focus con clic reale e digitazione da tastiera, senza il focus implicito dei metodi di compilazione dei campi.

Limite esplicito: questa release non ricostruisce font completi da una scansione
come i motori dedicati dei prodotti professionali. La correzione delle cifre non
equivale alla riscrittura fedele di interi paragrafi. Per modifiche estese è
preferibile il documento sorgente, ad esempio Word. I documenti e i font dei
clienti usati nelle prove locali non sono inclusi nel repository.
