# Calcolo rapido

Applicazione web autonoma per comporre una giornata alimentare e vederne subito
calorie e macronutrienti. Nasce come modalità interna del sito nutrizionista ed
è stata scorporata: non condivide più nulla con quel progetto.

## Come funziona

- **Nessun server, nessun account.** Tutto viene calcolato nel browser.
- **Nessun dato esce dal dispositivo.** La giornata in corso, gli alimenti
  personalizzati e i dati per il fabbisogno stanno nel `localStorage`.
- **Funziona offline** e si installa come app (PWA): dopo la prima apertura il
  service worker tiene una copia dei file.

## I dati e il loro rischio

Vivono in un browser solo. Non c'è nessuna copia altrove: una pulizia dei dati
di navigazione, un browser reinstallato o un telefono cambiato li porta via.
Per questo il riquadro **«I tuoi dati»** in fondo alla pagina esporta tutto in
un file JSON — diete, profili e alimenti creati — e lo ricarica. Quel file è
l'unica copia di sicurezza esistente; l'importazione **sostituisce** il
contenuto del browser, non lo fonde.

Se il browser rifiuta di salvare (navigazione privata, memoria del sito
bloccata) compare un avviso fisso in cima alla pagina: prima si continuava a
lavorare credendo che tutto fosse al sicuro.

Nel salvataggio finiscono **dati di salute** — sesso, età, peso, altezza — e,
se li si scrive nel nome della dieta, anche dati identificativi del paziente.
Sono in chiaro, come in qualunque `localStorage`. Meglio un codice o le
iniziali che nome e cognome per esteso. «Cancella tutto» rimuove ogni traccia
dal dispositivo.

## Sicurezza

- **Nessuna dipendenza esterna, nessuna chiamata di rete fuori dominio**: la
  superficie d'attacco è quasi nulla.
- Ogni dato scritto dall'utente passa da `escapeHtml` prima di finire in
  pagina: nomi di dieta, di giornata, di alimento, note e categorie.
- La **Content-Security-Policy** è dichiarata in un `<meta>` di `index.html`,
  perché `_headers` su GitHub Pages non viene applicato (vedi il commento in
  testa a quel file). Resta scoperta `frame-ancestors`, che in un `<meta>` non
  è ammessa: per difendersi dall'incorniciamento in un iframe servono header
  veri, cioè un hosting che li permetta.

## Diete, giornate, pasti

Tre livelli, dal più grande al più piccolo:

- **Dieta** — un piano a sé: ha nome, colore, profilo della persona e obiettivi
  propri. Fino a 10, si cambia dal menù in cima alla pagina. Le diete non
  condividono nulla fra loro.
- **Giornata** — una variante della stessa dieta (fino a 7 schede). Le giornate
  di una dieta condividono obiettivi e profilo.
- **Pasto** — colazione, spuntino del mattino, pranzo, merenda, cena, spuntino
  serale.

Il **colore della dieta** non è un'etichetta: riscrive la famiglia di variabili
CSS `--accent`, quindi tinge intestazione, bottoni, barre e schede. Serve a
non scrivere per sbaglio nella dieta sbagliata. Il verde è il colore
predefinito di `:root`, perciò una dieta verde ha l'aspetto di sempre.

Nel codice, `state` è **la dieta aperta**: un riferimento dentro
`archivio.diete`, non una copia. Cambiare dieta vuol dire riassegnare quella
variabile, così tutto il resto continua a leggere `state.giornate` come
quando le diete erano una sola. La pila di «Annulla» viene azzerata a ogni
cambio: contiene le giornate della dieta che si sta lasciando.

Lo stato salvato in `localStorage` (`rapido-stato-v1`) è ora
`{ diete: [...], dietaAttiva }`. Uno stato scritto da una versione precedente
viene letto lo stesso e diventa la prima dieta.

## Obiettivi giornalieri

Si possono scrivere a mano (calorie, proteine, grassi, carboidrati) oppure farli
calcolare dal profilo della persona:

1. **Calorie** — Mifflin-St Jeor per il metabolismo basale, moltiplicato per il
   fattore di attività (PAL) e corretto dell'eventuale deficit o surplus.
2. **Proteine** — grammi per chilo di peso corporeo (per difetto quelli tipici
   del livello di attività scelto).
3. **Grassi** — una quota delle calorie totali, 27% se non si indica altro
   (i LARN danno 20–35%), convertita in grammi a 9 kcal/g.
4. **Carboidrati** — le calorie che restano, a 4 kcal/g.

Se proteine e grassi richiesti superano da soli le calorie disponibili, i
carboidrati restano a 0 e l'app lo segnala invece di mostrare un numero
negativo.

### Ripartizione per pasto

Facoltativa, propria di ogni dieta. Assegna a ogni pasto una quota delle calorie
del giorno (per difetto 20/5/35/10/25/5, somma 100%) e ogni pasto guadagna un
obiettivo suo: la testata dice «in linea», «+120 su 400» o «−90 su 400». Oltre
il 15% di scostamento la pastiglia cambia colore.

Serve anche l'obiettivo calorico della giornata: senza, le percentuali non si
possono tradurre in calorie e l'app lo dice.

### Misure casalinghe: ml, cucchiai, bicchieri

I valori della tabella sono **per 100 grammi**, sempre. Millilitri, cucchiai e
bicchieri non sono altre etichette per la stessa cosa: 100 ml di olio pesano
91 g, cioè 81 kcal in meno di 100 g. Il grammo resta l'unità dei conti, e la
misura casalinga è ciò che si scrive e si legge.

Due strade per arrivare ai grammi, perché sono due problemi diversi:

- i **liquidi** hanno una densità (`densita`, in g/ml): un cucchiaio è 15 ml di
  quel liquido, un bicchiere 200 ml, e il peso si ricava moltiplicando;
- i **solidi** no. Un cucchiaio di farina pesa 9 g, non 15: fra i granelli c'è
  aria, e la densità apparente non si deduce da nulla. Per loro `foods.json`
  porta direttamente i grammi di un cucchiaio raso (`gCucchiaio`).

Il bicchiere esiste solo per i liquidi: un bicchiere di farina non è una misura
che qualcuno usi in cucina.

**93 alimenti su 464** hanno almeno una misura casalinga: **63 liquidi** (33
bevande, 9 succhi, aceto, 7 tipi di latte più soia e mandorle, 7 oli, 2 panne,
2 brodi) e **30 con il cucchiaio** (zuccheri, miele, marmellate, crema di
nocciole, cacao, 10 farine, pane grattugiato, parmigiano e grana, burro, burro
di arachidi, maionese, concentrato di pomodoro, yogurt).

Ogni alimento parte dalla misura più naturale — millilitri per i liquidi,
cucchiai per zucchero e farina, grammi per il resto — e il menù accanto alla
quantità permette di cambiare, convertendo il numero già scritto. Sulla scheda
dell'alimento sono scritte le conversioni che l'app applica, e mezzi cucchiai
si possono scrivere (passo 0,5).

L'unità resta attaccata alla voce: riga, stampa e testo copiato dicono
«2 cucchiai» e «1 bicchiere», con singolare e plurale corretti. Nella voce si
conservano **sia** la quantità scritta **sia** i grammi calcolati, così
correggere e annullare non fa slittare il valore per arrotondamenti successivi.
Le voci salvate prima non hanno unità e restano in grammi; quelle della prima
versione dei millilitri vengono convertite in lettura.

Sostituendo un alimento la misura segue il nuovo: un olio scambiato con del
pane passa ai grammi.

**Attenzione alla fonte:** densità e grammi per cucchiaio **non** vengono dal
CREA, che non li pubblica. Sono valori di riferimento d'uso comune, con la
densità a 20 °C e il cucchiaio preso a **15 ml** (un cucchiaio raso da tavola).
Chi segue la convenzione dietetica per cui «un cucchiaio d'olio = 10 g» deve
saperlo: qui un cucchiaio d'olio pesa 13,7 g, che è il volume reale.

### Sostituzioni equivalenti

Il pulsante ⇄ su ogni riga propone alimenti che, alla giusta quantità, danno le
**stesse calorie** di quello inserito. Le proposte restano nella categoria
dell'alimento di partenza — un formaggio al posto di una verdura non è una
sostituzione — e sono ordinate per differenza di proteine, mostrata insieme a
quella di grassi e carboidrati. La **nota viene rimossa**: descriveva
l'alimento di prima, e «pane integrale — cotta al dente» finirebbe sul foglio
del paziente. Un alimento personalizzato non ha categoria: in
quel caso si cerca fra tutti. Escluse le quantità sopra i 500 g, che sono
equivalenze solo sulla carta.

### Stampa per il paziente

Dal menù ▾ accanto a «Stampa». Foglio con i soli alimenti, le quantità e le
note: niente calorie, macronutrienti o obiettivi, che servono a chi la dieta la
scrive. Testo più grande, perché si legge in cucina.

## File

| File | Ruolo |
| --- | --- |
| `index.html` | la pagina, unica |
| `style.css` | tutto il foglio di stile |
| `app.js` | tutta la logica |
| `tema-init.js` | applica il tema salvato prima del rendering (evita il flash chiaro) |
| `foods.json` | tabella degli alimenti, in sola lettura (vedi sotto) |
| `manifest.json` | dati per l'installazione come app |
| `sw.js` | service worker: cache network-first per l'uso offline |
| `_headers` | header di sicurezza per Cloudflare Pages |
| `icons/` | icone dell'app |

## La tabella degli alimenti

`foods.json` contiene **464 alimenti in 17 categorie**, ricavati dal foglio
*Tabella alimenti* del file «Macronutrienti - calcolo (alimenti selezionati)»:
una selezione ragionata, non l'elenco completo delle tabelle di composizione.

Ogni voce ha nome, calorie, proteine, grassi e carboidrati per 100 g, più la
categoria, il codice dell'alimento e — dove c'è — il nome scientifico. La
categoria serve alle sostituzioni equivalenti; il codice non è ancora usato e
servirà a identificare l'alimento quando la tabella verrà aggiornata.

Sui **62 liquidi** c'è in più il campo `densita` (g/ml), aggiunto a mano: non
viene dal foglio di partenza. Vedi «Millilitri per i liquidi».

Un valore a **−2 significa «dato non disponibile»**, non zero: è la convenzione
del foglio di partenza. Sono 41 alimenti (per esempio i carboidrati del
parmigiano). L'app non lo confonde più con uno zero: sulla riga scrive «n.d.» e
sotto il totale della giornata avverte che il conto è **per difetto**, dicendo
quale nutriente manca e in quanti alimenti.

Per sostituire la tabella: si riesporta il foglio, si tolgono le righe di
categoria, si ripuliscono i nomi dal nome scientifico fra parentesi quadre e si
riscrive il file con la stessa struttura. I nomi vanno lasciati come sono: sono
la chiave con cui l'app ritrova gli alimenti.

## Prova in locale

Serve un server HTTP: il service worker e `fetch("foods.json")` non funzionano
aprendo il file con `file://`.

```bash
npx serve .
```

## Pubblicazione

Online su GitHub Pages: **https://test-cod1.github.io/calcolo-rapido/**
Ogni `push` sul ramo `main` aggiorna il sito in un paio di minuti.

Sito statico senza build: per spostarlo altrove basta pubblicare la cartella
così com'è. Attenzione a `id`, `start_url` e `scope` nel `manifest.json`: sono
impostati sulla sottocartella `/calcolo-rapido/` di GitHub Pages e vanno portati
a `/` se l'app finisce sulla radice di un dominio.

Il file `_headers` è specifico di Cloudflare Pages: su GitHub Pages viene
ignorato (gli header di sicurezza non sono configurabili). È tenuto qui pronto
per un eventuale trasloco.

`.nojekyll` serve a impedire che GitHub Pages passi i file per Jekyll, che
scarterebbe tutto ciò che inizia con `_`.

## Aggiornamenti

`sw.js` è network-first: chi è online vede sempre l'ultima versione, senza dover
toccare `CACHE_VERSION`. Quella costante va cambiata solo se si rinominano file
e si vogliono svuotare le cache vecchie.
