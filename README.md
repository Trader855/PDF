# Tomorrow Now PDF Editor

Editor PDF locale per macOS, sviluppato da **Tomorrow Now**. Il documento resta
sul dispositivo: il backend ascolta esclusivamente su `127.0.0.1` e la versione
browser è progettata per lavorare direttamente nella memoria del browser.

Questo repository contiene il sorgente completo dell'applicazione Mac ed è
dedicato esclusivamente al PDF Editor. Sito istituzionale e altri prodotti
Tomorrow Now sono mantenuti in repository separati.

## Download

Scarica sempre la versione più recente dalla pagina [Releases](https://github.com/Trader855/PDF/releases/latest).
Accanto a ogni pacchetto è indicato il tag del relativo
[codice sorgente](https://github.com/Trader855/PDF).

## Funzioni principali della versione 1.5.1

- sblocco dei PDF protetti quando si conosce la password;
- riordino, inserimento, rotazione, duplicazione, estrazione ed eliminazione delle pagine;
- annulla e ripristina le modifiche;
- aggiunta e modifica di testo e immagini, incluso il testo riconosciuto dentro immagini incorporate;
- modifica coerente dello stesso valore in più punti del PDF, con scelta delle occorrenze e annullamento unico;
- firme digitate o disegnate, con libreria locale di firme e timbri riutilizzabili;
- evidenziatore, penna libera, frecce e rettangoli;
- creazione e compilazione di campi modulo PDF interattivi;
- compressione ottimizzata per l'invio via e-mail;
- OCR locale in italiano e inglese per rendere ricercabili le scansioni;
- ricerca in tutto il documento con `⌘F`, evidenziazione dei risultati e navigazione avanti/indietro;
- controllo automatico discreto degli aggiornamenti GitHub, con indicatore “Aggiorna”, download su conferma e installazione al riavvio;
- comando **Aiuto → Controlla aggiornamenti…** nella barra menu di macOS.
- comando **Aiuto → Codice sorgente e licenze…** sempre collegato a questo
  repository pubblico;
- barra Tomorrow Now sempre visibile in fondo all'app, con collegamento sicuro
  al sito ufficiale;
- renderer Electron isolato e sandboxed, senza accesso diretto a Node.js;
- backend su `127.0.0.1` protetto da un token casuale per ogni avvio e da una
  policy CORS limitata all'app locale.

## Sviluppo locale

Requisiti: Node.js, pnpm e Python 3.9 o successivo.

```sh
pnpm install --frozen-lockfile
python3 -m venv .build-venv
.build-venv/bin/pip install -r backend/requirements-build.txt
pnpm start
```

Il repository non contiene certificati Apple, password del portachiavi o token
GitHub. Firma e notarizzazione usano esclusivamente credenziali esterne fornite
dall'ambiente di build.

## Controlli prima di una release

`pnpm test` esegue la suite automatica su caratteri, font, modifica e aggiunta
testo, salvataggi ripetuti, pagine, annotazioni, immagini e moduli.

Per includere un PDF reale nella regressione:

```sh
MAC_PDF_EDITOR_REGRESSION_PDF="/percorso/documento.pdf" pnpm run test:real-pdf
```

`pnpm run qa:release` ricostruisce l'app e verifica anche il backend realmente
incluso nel pacchetto macOS. Una release è distribuibile solo se tutti i test
terminano con esito positivo.

## Compatibilità

La versione attuale è compatibile con Mac Apple Silicon (M1, M2, M3, M4 e successivi).

## Installazione

1. Scarica il file DMG dalla release più recente.
2. Apri il DMG.
3. Trascina **Mac PDF Editor** nella cartella **Applicazioni**. Nell'app e nella
   nuova icona troverai il marchio **Tomorrow Now PDF Editor**. Il nome del
   pacchetto resta invariato in questa release per non interrompere gli
   aggiornamenti automatici delle installazioni esistenti.

La versione distribuita è firmata con Developer ID, notarizzata da Apple e
verificata da Gatekeeper.

Dalla versione 1.4.1 il pulsante con la freccia circolare mostra anche la scritta
“Aggiorna” quando è disponibile una nuova versione. Lo stesso controllo è
accessibile da **Aiuto → Controlla aggiornamenti…**. L'app esegue anche un
controllo silenzioso all'avvio e chiede sempre conferma prima di scaricare.

## Licenza e marchi

Il codice è pubblicato sotto [GNU Affero General Public License v3.0](LICENSE).
Consulta anche [dipendenze e attribuzioni](THIRD_PARTY_NOTICES.md),
[policy di sicurezza](SECURITY.md) e [regole sui marchi](TRADEMARKS.md).

Tomorrow Now PDF Editor è un progetto indipendente e non è affiliato o
approvato da Adobe Inc.
