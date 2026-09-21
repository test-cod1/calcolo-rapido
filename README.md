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

### Misure casalinghe: ml, cucchiai, cucchiaini, bicchieri

I valori della tabella sono **per 100 grammi**, sempre. Millilitri, cucchiai e
bicchieri non sono altre etichette per la stessa cosa: 100 ml di olio pesano
91 g, cioè 81 kcal in meno di 100 g. Il grammo resta l'unità dei conti, e la
misura casalinga è ciò che si scrive e si legge.

I volumi di riferimento sono **cucchiaio 15 ml**, **cucchiaino 5 ml**,
**bicchiere 200 ml**.

Due strade per arrivare ai grammi, perché sono due problemi diversi:

- i **liquidi** hanno una densità (`densita`, in g/ml): il peso si ricava
  moltiplicando il volume della misura per la densità;
- i **solidi** no. Un cucchiaio di farina pesa 9 g, non 15: fra i granelli c'è
  aria, e la densità apparente non si deduce da nulla. Per loro `foods.json`
  porta direttamente i grammi di un cucchiaio raso (`gCucchiaio`).

Il **cucchiaino non ha una tabella propria**: è un terzo di cucchiaio, e a
parità di alimento la densità apparente è la stessa, quindi si ottiene
dividendo. Tornano i valori d'uso comune — zucchero 4 g, farina 3 g, cacao 2 g,
miele 6,7 g, olio 4,6 g.

Il bicchiere esiste solo per i liquidi: un bicchiere di farina non è una misura
che qualcuno usi in cucina.

Un cucchiaio smette di essere una misura casalinga quando se ne contano troppi:
un cucchiaio di yogurt è una quantità che si sa fare, undici è un numero da
leggere due volte. Quando è **l'app a proporre** una quantità — oggi solo nelle
sostituzioni — oltre i **quattro cucchiai** torna ai grammi: lo yogurt passa ai
grammi sopra i 72 g, il burro sopra i 48, la farina sopra i 36, il parmigiano
sopra i 20. Millilitri e bicchieri non hanno questo limite, perché 200 ml o un
bicchiere e mezzo si leggono a colpo d'occhio.

Nel riquadro di inserimento la stessa scelta non si può fare: lì l'unità si
propone prima che la quantità sia scritta, e cambiarla mentre si digita sarebbe
peggio del difetto. Lì c'è il selettore, e se scrivi undici cucchiai l'app te li
lascia: il limite riguarda solo ciò che propone da sé.

**93 alimenti su 464** hanno almeno una misura casalinga: **63 liquidi** (33
bevande, 9 succhi, aceto, 7 tipi di latte più soia e mandorle, 7 oli, 2 panne,
2 brodi) e **30 con il cucchiaio** (zuccheri, miele, marmellate, crema di
nocciole, cacao, 10 farine, pane grattugiato, parmigiano e grana, burro, burro
di arachidi, maionese, concentrato di pomodoro, yogurt).

Ogni alimento parte dalla misura più naturale — millilitri per i liquidi,
cucchiai per zucchero e farina, grammi per il resto — e il menù accanto alla
quantità permette di cambiare, convertendo il numero già scritto (1 cucchiaio
diventa 3 cucchiaini, poi 12 g, e tornando indietro di nuovo 1 cucchiaio).
Sulla scheda dell'alimento sono scritte le conversioni che l'app applica, e
mezze dosi si possono scrivere (passo 0,5).

L'unità resta attaccata alla voce: riga, stampa e testo copiato dicono
«2 cucchiaini» e «1 bicchiere», con singolare e plurale corretti. Nella voce si
conservano **sia** la quantità scritta **sia** i grammi calcolati, così
correggere e annullare non fa slittare il valore per arrotondamenti successivi.
Le voci salvate prima non hanno unità e restano in grammi; quelle della prima
versione dei millilitri vengono convertite in lettura.

Sostituendo un alimento la misura segue il nuovo: un olio scambiato con del
pane passa ai grammi.

**Attenzione alla fonte:** densità e grammi per cucchiaio **non** vengono dal
CREA, che non li pubblica. Sono valori di riferimento d'uso comune, con la
densità a 20 °C e i volumi delle misure presi come sopra (cucchiaio e
cucchiaino rasi). Chi segue la convenzione dietetica per cui «un cucchiaio
d'olio = 10 g» deve saperlo: qui un cucchiaio d'olio pesa 13,7 g e un
cucchiaino 4,6 g, che sono i volumi reali.

### Sostituzioni equivalenti

Il pulsante ⇄ su ogni riga propone alimenti che, alla giusta quantità, danno
all'incirca le **stesse calorie** di quello inserito. Due scelte le rendono
usabili su una dieta vera.

**Si pesca nel gruppo alimentare, non nella categoria.** Le 17 categorie di
`foods.json` sono descrittive e troppo strette: carni, pesci, uova e legumi
stanno in quattro elenchi diversi, quindi al posto del pollo arrivava solo
altra carne — tacchino, gallina. I gruppi raccolgono le categorie che per una
sostituzione valgono lo stesso, e al posto del pollo compaiono anche merluzzo,
uova, legumi, formaggi e salumi. Questi ultimi a parità di calorie portano
molti più grassi e sale: è una valutazione che spetta a chi scrive la dieta,
non a un elenco deciso nel codice, e tenerli fuori vorrebbe dire non poterli
nemmeno vedere. Ogni riga espone il proprio scarto di grassi, che è
l'informazione con cui la scelta si fa. Una categoria fuori dai gruppi (oggi
«Miscellanea») resta gruppo di se stessa. Ogni riga dice anche da quale
categoria arriva.

Siccome carni e pesci sono le categorie più numerose e le più somiglianti,
riempirebbero da sole l'elenco e i legumi resterebbero sempre sotto il taglio.
Perciò **ogni categoria del gruppo porta le sue tre migliori**, e i posti che
restano vanno alle migliori in assoluto. Con sei categorie nel gruppo proteico
le quote coprono quasi tutte le quindici righe, e il taglio per vicinanza pesa
solo sulle ultime.

**Le quantità sono porzioni, non risultati di una divisione.** «138 g di pollo»
è un numero che nessuno pesa e che promette al paziente una precisione che il
calcolo non ha, visto che parte da valori medi di tabella: si prende il numero
più vicino di una scala d'uso comune (…120, 125, 130, 140, 150, 160, 175…) e
diventano 140 g. Sotto i 20 si resta al passo di uno, perché su un condimento
da 10 g saltare a 12 sposterebbe le calorie del 20%. Le misure casalinghe si
arrotondano invece al mezzo cucchiaio, e l'arrotondamento avviene **nell'unità
con cui l'alimento si misurerà**, altrimenti i «1,4 cucchiai» tornerebbero
dalla porta di servizio.

Le calorie scritte su ogni riga sono quindi quelle **vere della porzione
arrotondata**, con fra parentesi lo scarto rispetto alla voce di partenza,
accanto a quelli di proteine, grassi e carboidrati. Chi si scosta di più
dell'8% (mai meno di 2 kcal) viene scartato: senza quel limite, al posto di una
tazza di brodo da 7 kcal veniva proposto mezzo cucchiaio di maionese, 46 kcal,
perché una misura casalinga non scende sotto il mezzo cucchiaio.

**Restano fuori le bevande alcoliche.** L'etanolo dà 7 kcal per grammo e non è
un macronutriente: il whisky ha 238 kcal e proteine, grassi e carboidrati a
zero, quindi pareggiava le calorie di qualunque cosa con uno scarto perfetto su
ogni riga del confronto, e al posto di un'aranciata compariva del gin. Siccome
«Bevande alcoliche, analcoliche» è una categoria sola, la categoria non bastava
a separarli. Li riconosce invece lo scarto fra le calorie dichiarate e quelle
dei macronutrienti: sopra il 30% sono 21 voci e sono tutte alcoliche, sotto non
si supera il 5%. Un alcolico resta proponibile al posto di un altro alcolico,
dove il cambio è quello che si sta cercando davvero — il vino al posto della
birra.

Restano fuori le quantità sopra i 500 g, che sono equivalenze solo sulla carta.
La **nota viene rimossa**: descriveva l'alimento di prima, e «pane integrale —
cotta al dente» finirebbe sul foglio del paziente. Un alimento personalizzato
non ha categoria: in quel caso si cerca fra tutti.

### Spostare e scambiare un pasto

Il pulsante ⇅ nella testata di un pasto lo porta altrove senza reinserire
niente. La destinazione è una coppia: **quale giornata** (il campo compare solo
con più schede) e **quale pasto**. Da lì due strade:

- **Sposta** — gli alimenti lasciano la casella di partenza e si aggiungono a
  quelli già presenti nella destinazione.
- **Scambia** — le due caselle fanno il baratto: il pranzo del giorno 1 e
  quello del giorno 2 si invertono in un colpo solo.

Con la destinazione vuota le due strade portano allo stesso punto, e il testo
sotto i campi lo dice; con la destinazione piena dice esattamente che fine
faranno gli alimenti di entrambe. Il pasto proposto segue la giornata scelta:
nella stessa giornata un pasto diverso (la colazione che diventa la merenda),
su un'altra giornata lo stesso pasto — finché non se ne sceglie uno a mano.

A differenza del ⇄ di riga, che sostituisce un alimento, e della → che
**copia** un pasto in altre giornate lasciandolo dov'è, qui le voci cambiano
posto: dopo uno spostamento non restano in due posti. Tutto è reversibile con
«Annulla».

### Correggere un alimento creato da te

Nell'elenco dei suggerimenti gli alimenti tuoi portano l'etichetta «mio» e una
**matita**. Da lì si correggono nome e valori, senza uscire dalla ricerca: il
momento in cui ci si accorge che un valore è sbagliato è proprio quello in cui
lo si sta cercando per inserirlo.

Il punto non è il modulo, è cosa succede alle voci **già inserite**. Una voce
si porta via una copia dei valori al momento dell'inserimento (`copiaPer100`):
serve a non far cambiare da sotto una dieta già consegnata, ma per un alimento
che stai correggendo è l'opposto di quello che vuoi, e prima l'unica strada era
togliere le voci dalle diete e rifarle a mano.

Al salvataggio, se l'alimento è già in qualche dieta, compare un riepilogo di
**che cosa cambierebbe davvero**: quante voci, in quali diete e giornate, e come
si sposta il totale di ognuna — calorie e macronutrienti, perché correggendo i
soli grassi le calorie restano identiche e una riga che dicesse «invariate»
mentirebbe. Poi si sceglie: **aggiorna anche le voci**, oppure **solo
l'alimento** per i prossimi inserimenti. Se l'alimento non è in nessuna dieta
non c'è niente da chiedere e si salva e basta.

Due cose che rendono la faccenda affidabile:

- **Un id stabile.** Ogni alimento creato qui ne ha uno che non cambia quando
  cambiano nome e valori, e la voce lo porta con sé: è il filo che le lega.
  Senza, il legame sarebbe il nome, cioè proprio la cosa che si vuole poter
  correggere. Gli alimenti salvati prima che gli id esistessero ne ricevono uno
  alla prima apertura, e le voci che avevano già prodotto restano riconoscibili
  dal nome — con il limite che un tuo alimento omonimo di uno della tabella non
  è distinguibile, ed è un altro motivo per cui il riepilogo elenca sempre dove
  andrà a finire la modifica.
- **«Annulla» esteso all'archivio.** La pila di annullamento lavora sulle
  giornate della dieta aperta, ma questa è l'unica operazione che può toccare
  diete chiuse: per lei lo scatto comprende l'intero archivio e gli alimenti
  creati, così le voci e l'alimento tornano indietro insieme. Con il solo
  scatto delle giornate «Annulla» avrebbe riportato indietro una dieta
  lasciando le altre riscritte, che è peggio del non poter annullare.

Salvare dal riquadro di inserimento un alimento con il nome di uno che è già
tuo passa dalla stessa domanda: è una correzione, non una creazione.

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

Su **93 alimenti** ci sono in più i campi delle misure casalinghe, aggiunti a
mano e non presenti nel foglio di partenza: `densita` (g/ml) sui 63 liquidi e
`gCucchiaio` sui 30 che si dosano col cucchiaio. Vedi «Misure casalinghe».

Le **calorie dell'alcol** non stanno in nessuna delle quattro colonne, perché
l'etanolo non è un macronutriente. Con una bevanda alcolica in giornata, la
barra dei macronutrienti continua a fare 100% ma quel 100% non copre tutte le
calorie: sotto il totale l'app scrive quante ne arrivano dall'alcol, così il
conto resta leggibile. Le categorie non servono a riconoscerle — «Bevande
alcoliche, analcoliche» è una categoria sola — e bastano invece le calorie che
i macronutrienti non spiegano: vedi «Sostituzioni equivalenti».

Un valore a **−2 significa «dato non disponibile»**, non zero: è la convenzione
del foglio di partenza. Sono 41 alimenti (per esempio i carboidrati del
parmigiano). L'app non lo confonde più con uno zero: sulla riga scrive «n.d.» e
sotto il totale della giornata avverte che il conto è **per difetto**, dicendo
quale nutriente manca e in quanti alimenti.

Per sostituire la tabella: si riesporta il foglio, si tolgono le righe di
categoria, si ripuliscono i nomi dal nome scientifico fra parentesi quadre e si
riscrive il file con la stessa struttura. I nomi vanno lasciati come sono: sono
la chiave con cui l'app ritrova gli alimenti.

Vale anche per i **nomi delle categorie**, refusi compresi: «Carni di tutti I
tipi» con la I maiuscola, «crakers», «Dolci, ciocc». I gruppi alimentari delle
sostituzioni sono scritti in `app.js` copiando quelle stringhe, e correggere un
refuso nella tabella senza correggerlo anche lì sfascia il gruppo — le
sostituzioni tornano a pescare nella sola categoria di partenza, senza errori e
senza niente di visibile. Per questo all'avvio l'app confronta le due liste e
scrive in console quali categorie non trova più.

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

«Sempre l'ultima versione» vale però **al caricamento della pagina**. Una scheda
rimasta aperta — ed è il caso normale, una dieta si scrive in mezza giornata —
continua a eseguire il codice di prima. Per quelle c'è un riquadro in cima alla
pagina, «È disponibile una versione aggiornata», con un pulsante che ricarica;
la pagina non si ricarica mai da sé, perché farlo sotto le mani di chi sta
scrivendo sarebbe peggio del problema.

Quel riquadro compare quando il browser si accorge che **`sw.js` è cambiato**,
non `app.js`: è il file del service worker quello che viene confrontato. Perciò,
se si vuole che le schede aperte vedano l'avviso, **`CACHE_VERSION` va cambiata
a ogni pubblicazione che conti** — ed è il secondo motivo per toccarla, oltre a
quello dei file rinominati.
