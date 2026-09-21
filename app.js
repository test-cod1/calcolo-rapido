// ---------------------------------------------------------------------------
// "Calcolo rapido" — applicazione autonoma.
//
// Obiettivo: fare in fretta i conti mentre la dieta viene scritta altrove
// (Word, carta, un gestionale). Qui non ci sono pazienti, login, database:
// si sceglie un alimento, si dice quanto, e si vede subito il risultato.
//
// Non esiste alcun server: l'unico dato caricato dalla rete è la tabella degli
// alimenti (foods.json), in sola lettura e servita insieme alla pagina. Tutto
// il resto (giornata in corso, alimenti personalizzati, dati per il fabbisogno,
// tema) vive nel localStorage di questo browser.
// ---------------------------------------------------------------------------

const PASTI = ["Colazione", "Spuntino mattina", "Pranzo", "Merenda", "Cena", "Spuntino serale"];
const TEMA_KEY = "calcolo-rapido-tema";
const CHIAVE_STATO = "rapido-stato-v1";
const CHIAVE_ALIMENTI = "rapido-alimenti-v1";

// Fattori di attività (PAL) per passare dal metabolismo basale al fabbisogno.
const FATTORI_ATTIVITA = {
  "Sedentario": 1.2,
  "Leggero": 1.375,
  "Moderato": 1.55,
  "Intenso": 1.725,
  "Molto intenso": 1.9
};

// Le due tabelle qui sopra e qui sotto vengono lette con il livello di attività
// come chiave, e quel livello arriva anche da uno stato salvato. Un valore che
// non è dei nostri NON restituisce undefined: su un oggetto letterale
// "constructor" o "toString" rispondono con roba ereditata da Object, il
// fallback `|| 1.55` non scatta e il fabbisogno finisce a "NaN kcal". Da qui
// passa tutto quello che poi indicizza le tabelle.
function attivitaValida(v) {
  return Object.prototype.hasOwnProperty.call(FATTORI_ATTIVITA, v) ? v : "Moderato";
}

// Proteine suggerite in grammi per kg di peso corporeo, in base al livello di
// attività: sono valori di partenza dentro gli intervalli di uso comune
// (0,8–1 g/kg per l'adulto sedentario secondo i LARN, fino a ~2 g/kg negli
// sportivi). Restano una proposta modificabile: il valore digitato a mano ha
// sempre la precedenza.
const G_PER_KG_SUGGERITO = {
  "Sedentario": 1,
  "Leggero": 1.2,
  "Moderato": 1.4,
  "Intenso": 1.6,
  "Molto intenso": 1.8
};

// Grassi come quota delle calorie totali. I LARN indicano 20–35% per l'adulto:
// 27% sta in mezzo e lascia ai carboidrati una quota di norma sostenibile.
// Anche questo è solo un punto di partenza modificabile.
// Intervalli ammessi per i dati della persona, gli stessi dichiarati nei campi
// di index.html. Gli attributi min/max del markup non impediscono di battere un
// numero fuori scala — segnalano e basta — quindi il calcolo se li ricontrolla.
const LIMITI_PROFILO = {
  eta:     { nome: "età",     min: 1,  max: 120, unita: "anni" },
  peso:    { nome: "peso",    min: 1,  max: 400, unita: "kg" },
  altezza: { nome: "altezza", min: 50, max: 250, unita: "cm" }
};

const PERC_GRASSI_SUGGERITA = 27;
const PERC_GRASSI_MIN = 15;
const PERC_GRASSI_MAX = 45;

// Calorie per grammo (fattori di Atwater): servono a passare dai grammi di un
// macronutriente alle calorie e viceversa.
const KCAL_PER_G = { proteine: 4, grassi: 9, carboidrati: 4 };

// Come distribuire le calorie della giornata fra i pasti, in percentuale.
// È la ripartizione di uso comune (colazione abbondante, pranzo pasto
// principale, cena più contenuta) e serve solo da punto di partenza: ogni
// valore è modificabile e la somma deve tornare a 100.
const RIPARTIZIONE_TIPICA = {
  "Colazione": 20,
  "Spuntino mattina": 5,
  "Pranzo": 35,
  "Merenda": 10,
  "Cena": 25,
  "Spuntino serale": 5
};

// Quanto ci si può discostare dall'obiettivo di un pasto prima di segnalarlo.
// Il 15% evita di accendere un avviso per pochi grammi di differenza.
const TOLLERANZA_PASTO = 0.15;

// Limiti dei testi liberi. Non sono capricci: un nome o una nota lunghissimi
// sfondano la riga a schermo e il foglio stampato, e restano nel salvataggio.
// I nomi di dieta e giornata sono già limitati a 40 dai rispettivi campi.
const MAX_NOME_ALIMENTO = 60;
const MAX_NOTA = 80;

// Tetto di una singola voce. Cinque chili di un alimento solo non sono una
// porzione ma una cifra battuta male (o un decimale finito nel posto
// sbagliato): senza un limite il numero entra in dieta, schiaccia tutte le
// barre della giornata e finisce sul foglio stampato.
const MAX_GRAMMI_VOCE = 5000;

// Nel foglio di partenza -2 vuol dire "dato non disponibile", non zero. Sono 41
// alimenti (per esempio i carboidrati del parmigiano). Trattarlo come zero fa
// sottostimare il totale della giornata senza che nessuno se ne accorga:
// l'app lo tiene da parte per poterlo dichiarare.
const VALORE_ASSENTE = -2;
const ETICHETTE_MACRO = { kcal: "calorie", proteine: "proteine", grassi: "grassi", carboidrati: "carboidrati" };

// ---------- Stato ----------

const MAX_GIORNATE = 7;
const MAX_DIETE = 10;

// Colore di riconoscimento della dieta: tinge intestazione, bottoni e schede,
// così passando da una dieta all'altra si vede a colpo d'occhio dove si sta
// lavorando. Gli id finiscono nello stato salvato: non vanno rinominati.
const COLORI_DIETA = [
  { id: "verde",    nome: "Verde" },
  { id: "blu",      nome: "Blu" },
  { id: "viola",    nome: "Viola" },
  { id: "ambra",    nome: "Ambra" },
  { id: "mattone",  nome: "Mattone" },
  { id: "turchese", nome: "Turchese" },
  { id: "rosa",     nome: "Rosa" },
  { id: "ardesia",  nome: "Ardesia" }
];

function coloreValido(id) {
  return COLORI_DIETA.some(c => c.id === id) ? id : COLORI_DIETA[0].id;
}

function nomeColore(id) {
  const c = COLORI_DIETA.find(c => c.id === coloreValido(id));
  return c ? c.nome : "";
}

function creaPastiVuoti() {
  const g = {};
  PASTI.forEach(p => { g[p] = []; });
  return g;
}

function creaGiornata(nome) {
  return { nome, pasti: creaPastiVuoti() };
}

// I dati della persona per il calcolo del fabbisogno. Età, peso, altezza e gli
// altri numeri restano stringhe: sono quello che è stato battuto nei campi, e
// lì tornano quando si riapre la dieta.
function creaProfiloVuoto() {
  return { sesso: "", eta: "", peso: "", altezza: "", attivita: "Moderato", correzione: "", gPerKg: "", percGrassi: "" };
}

// Nome libero per la giornata nuova: "Giorno N" con il primo numero non ancora
// in uso, così chiudendo la 2ª e riaprendone una non escono due "Giorno 3".
function nomeGiornataLibero() {
  const usati = new Set(state.giornate.map(g => g.nome));
  for (let i = 1; i <= MAX_GIORNATE + 1; i++) {
    const nome = `Giorno ${i}`;
    if (!usati.has(nome)) return nome;
  }
  return "Giornata";
}

// Una dieta è un piano a sé: profilo, obiettivi e giornate sono suoi e non
// vengono condivisi con le altre. Le giornate restano quello che erano, cioè
// le varianti della STESSA dieta.
function creaDietaVuota(nome, colore) {
  return {
    nome: nome || "Dieta 1",
    colore: coloreValido(colore),
    obiettivo: null,             // kcal obiettivo del giorno (null = nessuno)
    obiettivoProteine: null,     // grammi di proteine obiettivo (null = nessuno)
    obiettivoGrassi: null,       // grammi di grassi obiettivo (null = nessuno)
    obiettivoCarboidrati: null,  // grammi di carboidrati obiettivo (null = nessuno)
    // Percentuale di calorie per pasto, oppure null quando la ripartizione non
    // è in uso: senza di essa i pasti mostrano solo la quota che hanno preso,
    // senza un riferimento con cui confrontarla.
    ripartizione: null,
    giornate: [creaGiornata("Giorno 1")],
    attiva: 0,
    profilo: creaProfiloVuoto()
  };
}

// ---------- Ripartizione per pasto ----------

function creaRipartizioneTipica() {
  const r = {};
  PASTI.forEach(p => { r[p] = RIPARTIZIONE_TIPICA[p] || 0; });
  return r;
}

// Rilegge la ripartizione salvata pasto per pasto. Un pasto che non c'è più
// (l'elenco dei pasti è cambiato una volta e può cambiare ancora) sparisce, e
// uno nuovo parte da 0: meglio una quota a zero, visibile e correggibile, che
// una percentuale inventata.
function leggiRipartizione(salvata) {
  if (!salvata || typeof salvata !== "object") return null;
  const r = {};
  PASTI.forEach(p => {
    const v = Number(salvata[p]);
    r[p] = v > 0 && v <= 100 ? v : 0;
  });
  return sommaRipartizione(r) > 0 ? r : null;
}

function sommaRipartizione(r) {
  return PASTI.reduce((s, p) => s + (Number(r[p]) || 0), 0);
}

// Calorie previste per un pasto, o null se non c'è nulla con cui calcolarle:
// serve sia la ripartizione sia l'obiettivo calorico della giornata.
function obiettivoPasto(pasto) {
  if (!state.ripartizione || !(state.obiettivo > 0)) return null;
  const perc = Number(state.ripartizione[pasto]) || 0;
  if (perc <= 0) return null;
  return (state.obiettivo * perc) / 100;
}

function creaArchivioVuoto() {
  return { diete: [creaDietaVuota("Dieta 1", COLORI_DIETA[0].id)], dietaAttiva: 0 };
}

// Come per le giornate: primo "Dieta N" non ancora in uso.
function nomeDietaLibero() {
  const usati = new Set(archivio.diete.map(d => d.nome));
  for (let i = 1; i <= MAX_DIETE + 1; i++) {
    const nome = `Dieta ${i}`;
    if (!usati.has(nome)) return nome;
  }
  return "Dieta";
}

// Due diete con lo stesso nome sono indistinguibili nel menù a tendina, nella
// stampa e nel testo copiato: al nome ripetuto si aggiunge un numero.
function nomeDietaUnico(nome, esclusa) {
  const base = nome.slice(0, 40);
  const usati = new Set(archivio.diete.filter((d, i) => i !== esclusa).map(d => d.nome));
  if (!usati.has(base)) return base;
  for (let i = 2; i <= MAX_DIETE + 1; i++) {
    const tentativo = `${base.slice(0, 36)} (${i})`;
    if (!usati.has(tentativo)) return tentativo;
  }
  return base;
}

// Primo colore non ancora assegnato: due diete dello stesso colore vanificano
// il colpo d'occhio. Finiti i colori si ricomincia dal primo.
function coloreDietaLibero() {
  const usati = new Set(archivio.diete.map(d => d.colore));
  const libero = COLORI_DIETA.find(c => !usati.has(c.id));
  return libero ? libero.id : COLORI_DIETA[archivio.diete.length % COLORI_DIETA.length].id;
}

// Pasti della giornata su cui si sta lavorando: quasi tutto il resto del file
// passa da qui invece di toccare direttamente lo stato.
function pastiCorrenti() {
  return state.giornate[state.attiva].pasti;
}

function giornataCorrente() {
  return state.giornate[state.attiva];
}

let archivio = creaArchivioVuoto();
// "state" è la dieta aperta: un riferimento dentro l'archivio, non una copia.
// Cambiare dieta vuol dire riassegnare questa variabile, e tutto il resto del
// file continua a leggere state.obiettivo / state.giornate come prima.
let state = archivio.diete[0];
let alimentiBase = [];          // voci di foods.json, mai modificate
let alimentiCustom = [];        // alimenti creati qui, solo in locale
let foodMap = new Map();        // chiave (nome originale) -> valori per 100 g
let foodNames = [];             // chiavi ordinate per nome visualizzato
let indiceRicerca = [];         // stesse voci, con i testi già normalizzati
let displayToKey = new Map();   // nome visualizzato normalizzato -> chiave
let categoriaDi = new Map();    // chiave -> categoria (solo per gli alimenti di base)
let idCustomDi = new Map();     // chiave -> id dell'alimento personalizzato
let densitaDi = new Map();      // chiave -> g/ml, solo per i liquidi
let cucchiaioDi = new Map();    // chiave -> grammi in un cucchiaio raso
let alimentoSelezionato = null; // { chiave, nome, per100 }
let modoCalcolo = "grammi";     // grammi | kcal | proteine
let calcoloCorrente = null;     // risultato mostrato nell'anteprima
let indiceSuggerimento = -1;
let timerToast = null;
let erroreCaricamentoAlimenti = false;

// ---------- Elementi ----------

const el = (id) => document.getElementById(id);

const temaChiaroBtn = el("tema-chiaro-btn");
const temaNotteBtn = el("tema-notte-btn");

const obiettivoInput = el("obiettivo-input");
const obiettivoProtInput = el("obiettivo-prot-input");
const obiettivoFatInput = el("obiettivo-fat-input");
const obiettivoCarbInput = el("obiettivo-carb-input");
const fabbisognoToggle = el("fabbisogno-toggle");
const fabbisognoBox = el("fabbisogno-box");
const sessoGruppo = el("sesso-gruppo");
const etaInput = el("eta-input");
const pesoInput = el("peso-input");
const altezzaInput = el("altezza-input");
const attivitaSelect = el("attivita-select");
const correzioneInput = el("deficit-input");
const gkgInput = el("gkg-input");
const gkgNota = el("gkg-nota");
const percGrassiInput = el("perc-grassi-input");
const percGrassiNota = el("perc-grassi-nota");
const ripartizioneToggle = el("ripartizione-toggle");
const ripartizioneStato = el("ripartizione-stato");
const ripartizioneBox = el("ripartizione-box");
const ripartizioneCampi = el("ripartizione-campi");
const ripartizioneSomma = el("ripartizione-somma");
const ripartizioneTipicaBtn = el("ripartizione-tipica-btn");
const ripartizioneSpegniBtn = el("ripartizione-spegni-btn");
const sostituisciOverlay = el("sostituisci-overlay");
const sostituisciTitolo = el("sostituisci-titolo");
const sostituisciElenco = el("sostituisci-elenco");
const sostituisciAnnullaBtn = el("sostituisci-annulla-btn");
const fabbisognoEsito = el("fabbisogno-esito");

const foodInput = el("food-input");
const suggestions = el("suggestions");
const foodError = el("food-error");
const nuovoAlimentoBtn = el("nuovo-alimento-btn");
const nuovoAlimentoForm = el("nuovo-alimento-form");
const nuovoNome = el("nuovo-nome");
const nuovoKcal = el("nuovo-kcal");
const nuovoProt = el("nuovo-prot");
const nuovoFat = el("nuovo-fat");
const nuovoCarb = el("nuovo-carb");
const nuovoAlimentoError = el("nuovo-alimento-error");
const salvaAlimentoBtn = el("salva-alimento-btn");
const annullaAlimentoBtn = el("annulla-alimento-btn");

const alimentoScelto = el("alimento-scelto");
const alimentoSceltoNome = el("alimento-scelto-nome");
const alimentoSceltoPer100 = el("alimento-scelto-per100");
const alimentoEliminaBtn = el("alimento-elimina-btn");
const modificaAlimentoOverlay = el("modifica-alimento-overlay");
const modificaAlimentoTitolo = el("modifica-alimento-titolo");
const modificaAlimentoForm = el("modifica-alimento-form");
const modificaAlimentoNome = el("modifica-alimento-nome");
const modificaAlimentoKcal = el("modifica-alimento-kcal");
const modificaAlimentoProt = el("modifica-alimento-prot");
const modificaAlimentoFat = el("modifica-alimento-fat");
const modificaAlimentoCarb = el("modifica-alimento-carb");
const modificaAlimentoErrore = el("modifica-alimento-errore");
const modificaAlimentoAvantiBtn = el("modifica-alimento-avanti-btn");
const modificaAlimentoAnnullaBtn = el("modifica-alimento-annulla-btn");
const modificaAlimentoConferma = el("modifica-alimento-conferma");
const modificaAlimentoRiepilogo = el("modifica-alimento-riepilogo");
const modificaAlimentoDove = el("modifica-alimento-dove");
const modificaAlimentoPropagaBtn = el("modifica-alimento-propaga-btn");
const modificaAlimentoSoloBtn = el("modifica-alimento-solo-btn");
const modificaAlimentoIndietroBtn = el("modifica-alimento-indietro-btn");

const modoGruppo = el("modo-gruppo");
const quantitaInput = el("quantita-input");
const quantitaUnita = el("quantita-unita");
const unitaSelect = el("unita-select");
const modoNota = el("modo-nota");

const preview = el("preview");
const previewKcal = el("preview-kcal");
const previewGrammi = el("preview-grammi");
const previewProt = el("preview-prot");
const previewFat = el("preview-fat");
const previewCarb = el("preview-carb");

const notaInput = el("nota-input");
const pastoSelect = el("pasto-select");
const aggiungiBtn = el("aggiungi-btn");

const dietaSelect = el("dieta-select");
const dietaNomeInput = el("dieta-nome-input");
const dietaRinominaBtn = el("dieta-rinomina-btn");
const dietaColoreBtn = el("dieta-colore-btn");
const dietaColori = el("dieta-colori");
const dietaNuovaBtn = el("dieta-nuova-btn");
const dietaEliminaBtn = el("dieta-elimina-btn");
const dietaInfo = el("dieta-info");

const giornateSchede = el("giornate-schede");
const giornataNuovaBtn = el("giornata-nuova-btn");
const giornataContenuto = el("giornata-contenuto");
const totaliGiorno = el("totali-giorno");
const barraTotale = el("barra-totale");
const copiaBtn = el("copia-btn");
const copiaMenuBtn = el("copia-menu-btn");
const copiaMenu = el("copia-menu");
const stampaBtn = el("stampa-btn");
const stampaMenuBtn = el("stampa-menu-btn");
const stampaMenu = el("stampa-menu");
const annullaBtn = el("annulla-btn");

const copiaPastoOverlay = el("copia-pasto-overlay");
const copiaPastoTitolo = el("copia-pasto-titolo");
const copiaPastoElenco = el("copia-pasto-elenco");
const copiaPastoErrore = el("copia-pasto-errore");
const copiaPastoConfermaBtn = el("copia-pasto-conferma-btn");
const copiaPastoAnnullaBtn = el("copia-pasto-annulla-btn");
const spostaPastoOverlay = el("sposta-pasto-overlay");
const spostaPastoTitolo = el("sposta-pasto-titolo");
const spostaPastoCampoGiornata = el("sposta-pasto-campo-giornata");
const spostaPastoGiornata = el("sposta-pasto-giornata");
const spostaPastoPasto = el("sposta-pasto-pasto");
const spostaPastoEsito = el("sposta-pasto-esito");
const spostaPastoScambiaBtn = el("sposta-pasto-scambia-btn");
const spostaPastoSpostaBtn = el("sposta-pasto-sposta-btn");
const spostaPastoAnnullaBtn = el("sposta-pasto-annulla-btn");
const svuotaBtn = el("svuota-btn");
const areaStampa = el("area-stampa");
const toast = el("toast");

const installaBtn = el("installa-btn");
const installaOverlay = el("installa-overlay");
const avvisoSalvataggio = el("avviso-salvataggio");
const avvisoAggiornamento = el("avviso-aggiornamento");
const aggiornaBtn = el("aggiorna-btn");
const esportaBtn = el("esporta-btn");
const importaBtn = el("importa-btn");
const importaFile = el("importa-file");
const cancellaTuttoBtn = el("cancella-tutto-btn");
const installaIstruzioni = el("installa-istruzioni");
const installaChiudiBtn = el("installa-chiudi-btn");

// ---------- Utilità ----------

function round1(n) { return Math.round(n * 10) / 10; }
function arrotonda(n) { return Math.round(n); }

function escapeHtml(testo) {
  return String(testo)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Minuscolo e senza accenti: serve per confrontare quello che si digita con i
// nomi del database (dove "però" e "pero" devono corrispondere entrambi).
function normalizzaTesto(s) {
  return (s == null ? "" : String(s)).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

const NOMI_PROPRI = new Set(["bruxelles", "witloof", "iceberg", "cheddar", "grana", "parmigiano", "gouda", "brie", "emmental", "camembert", "philadelphia", "gorgonzola"]);

function sentenceCase(str) {
  return str.trim().split(/\s+/).map((p, i) => {
    const w = p.toLowerCase();
    if (NOMI_PROPRI.has(w) || i === 0) return w.charAt(0).toUpperCase() + w.slice(1);
    return w;
  }).join(" ");
}

// I nomi del database CREA sono in MAIUSCOLO con la coda invertita
// ("AGLIO, fresco"): qui diventano leggibili ("Aglio (fresco)").
// La virgola che separa la coda sta sempre fuori dalle parentesi. Quelle
// dentro sono un'altra cosa — in «VINO ROSSO (13,5 %vol)» è un separatore
// decimale — e tagliare lì dava «Vino rosso (13 (5 %vol))», che si leggeva
// nella ricerca, sulla riga, nel testo copiato e sul foglio del paziente.
function primaVirgolaDiCoda(nome) {
  let dentro = 0;
  for (let i = 0; i < nome.length; i++) {
    const c = nome[i];
    if (c === "(") dentro++;
    else if (c === ")") dentro = Math.max(0, dentro - 1);
    else if (c === "," && dentro === 0) return i;
  }
  return -1;
}

function formattaNome(nome) {
  if (!nome) return nome;
  const i = primaVirgolaDiCoda(nome);
  const main = i >= 0 ? nome.slice(0, i) : nome;
  // La virgola iniziale va tolta: nel database CREA qualche voce ne ha due di
  // fila ("POLLO,, INTERO") e senza questo si leggerebbe "Pollo (, intero)".
  const qual = i >= 0 ? nome.slice(i + 1).replace(/^[\s,]+/, "").trim() : "";
  const mainFmt = sentenceCase(main);
  return qual ? `${mainFmt} (${qual.toLowerCase()})` : mainFmt;
}

function mostraToast(messaggio) {
  toast.textContent = messaggio;
  toast.classList.remove("hidden");
  clearTimeout(timerToast);
  timerToast = setTimeout(() => toast.classList.add("hidden"), 2200);
}

// ---------- Tema ----------

function applicaTema(tema) {
  const notte = tema === "notte";
  document.documentElement.classList.toggle("tema-notte", notte);
  temaChiaroBtn.classList.toggle("attivo", !notte);
  temaNotteBtn.classList.toggle("attivo", notte);
  // aria-pressed: a chi usa uno screen reader dice quale delle due modalità è
  // attiva, informazione che altrimenti passa solo dal colore del bottone.
  temaChiaroBtn.setAttribute("aria-pressed", String(!notte));
  temaNotteBtn.setAttribute("aria-pressed", String(notte));
}

function inizializzaTema() {
  let tema = null;
  try { tema = localStorage.getItem(TEMA_KEY); } catch (e) { /* storage non disponibile */ }
  if (tema !== "chiaro" && tema !== "notte") {
    tema = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "notte" : "chiaro";
  }
  applicaTema(tema);
  const imposta = (t) => {
    applicaTema(t);
    try { localStorage.setItem(TEMA_KEY, t); } catch (e) { /* ignora */ }
  };
  temaChiaroBtn.addEventListener("click", () => imposta("chiaro"));
  temaNotteBtn.addEventListener("click", () => imposta("notte"));
}

// ---------- Persistenza locale ----------

// Se il salvataggio non riesce (navigazione privata, spazio esaurito, memoria
// del sito bloccata) l'app NON deve fare finta di niente: chi sta scrivendo una
// dieta continuerebbe a lavorare convinto che sia al sicuro, e la perderebbe
// tutta alla prima ricarica. L'avviso resta a video finché il salvataggio non
// torna a funzionare.
let salvataggioNonRiuscito = false;

function salvaStato() {
  try {
    localStorage.setItem(CHIAVE_STATO, JSON.stringify(archivio));
    if (salvataggioNonRiuscito) {
      salvataggioNonRiuscito = false;
      mostraAvvisoSalvataggio();
    }
  } catch (e) {
    salvataggioNonRiuscito = true;
    mostraAvvisoSalvataggio();
  }
}

function mostraAvvisoSalvataggio() {
  avvisoSalvataggio.classList.toggle("hidden", !salvataggioNonRiuscito);
}

function caricaStato() {
  let salvato = null;
  try { salvato = JSON.parse(localStorage.getItem(CHIAVE_STATO) || "null"); } catch (e) { salvato = null; }
  if (!salvato || typeof salvato !== "object") return;

  const nuovo = creaArchivioVuoto();
  if (Array.isArray(salvato.diete) && salvato.diete.length) {
    nuovo.diete = salvato.diete.slice(0, MAX_DIETE).map((d, i) =>
      leggiDieta(d, `Dieta ${i + 1}`, COLORI_DIETA[i % COLORI_DIETA.length].id));
    const attiva = Number(salvato.dietaAttiva);
    nuovo.dietaAttiva = attiva >= 0 && attiva < nuovo.diete.length ? attiva : 0;
  } else {
    // Stato scritto prima delle diete multiple: diventa la prima dieta.
    nuovo.diete = [leggiDieta(salvato, "Dieta 1", COLORI_DIETA[0].id)];
    nuovo.dietaAttiva = 0;
  }
  archivio = nuovo;
  state = archivio.diete[archivio.dietaAttiva];
}

// Rilegge una dieta campo per campo: come per i pasti, una struttura salvata
// da una versione diversa (o manomessa) non deve poter rompere il rendering.
function leggiDieta(salvata, nomePredefinito, colorePredefinito) {
  const dieta = creaDietaVuota(nomePredefinito, colorePredefinito);
  if (!salvata || typeof salvata !== "object") return dieta;

  dieta.nome = String(salvata.nome || nomePredefinito).slice(0, 40);
  dieta.colore = coloreValido(salvata.colore || colorePredefinito);
  dieta.obiettivo = Number(salvata.obiettivo) > 0 ? Number(salvata.obiettivo) : null;
  dieta.obiettivoProteine = Number(salvata.obiettivoProteine) > 0 ? Number(salvata.obiettivoProteine) : null;
  dieta.obiettivoGrassi = Number(salvata.obiettivoGrassi) > 0 ? Number(salvata.obiettivoGrassi) : null;
  dieta.obiettivoCarboidrati = Number(salvata.obiettivoCarboidrati) > 0 ? Number(salvata.obiettivoCarboidrati) : null;
  dieta.ripartizione = leggiRipartizione(salvata.ripartizione);
  dieta.profilo = leggiProfilo(salvata.profilo);

  if (Array.isArray(salvata.giornate) && salvata.giornate.length) {
    dieta.giornate = salvata.giornate.slice(0, MAX_GIORNATE).map((g, i) => ({
      nome: String((g && g.nome) || `Giorno ${i + 1}`).slice(0, 40),
      pasti: leggiPasti(g && g.pasti)
    }));
    const attiva = Number(salvata.attiva);
    dieta.attiva = attiva >= 0 && attiva < dieta.giornate.length ? attiva : 0;
  } else if (salvata.giornata) {
    // Stato scritto prima delle schede multiple: diventa la prima giornata.
    dieta.giornate = [{ nome: "Giorno 1", pasti: leggiPasti(salvata.giornata) }];
    dieta.attiva = 0;
  }
  return dieta;
}

// Rilegge il profilo campo per campo, come tutto il resto dello stato salvato.
// Prima qui c'era un Object.assign, ed era l'unico punto in cui una struttura
// salvata entrava senza controlli: copiava qualunque chiave con qualunque tipo,
// "__proto__" compreso — che JSON.parse produce come proprietà propria e che
// l'assegnamento fa finire sul prototipo dell'oggetto invece che dentro.
function leggiProfilo(salvato) {
  const profilo = creaProfiloVuoto();
  if (!salvato || typeof salvato !== "object") return profilo;
  profilo.sesso = salvato.sesso === "M" || salvato.sesso === "F" ? salvato.sesso : "";
  profilo.attivita = attivitaValida(salvato.attivita);
  profilo.eta = numeroDaCampo(salvato.eta);
  profilo.peso = numeroDaCampo(salvato.peso);
  profilo.altezza = numeroDaCampo(salvato.altezza);
  profilo.correzione = numeroDaCampo(salvato.correzione);
  profilo.gPerKg = numeroDaCampo(salvato.gPerKg);
  profilo.percGrassi = numeroDaCampo(salvato.percGrassi);
  return profilo;
}

// I campi del profilo conservano quello che è stato battuto, perché è quello
// che va rimesso nei campi: restano stringhe, ma solo se rileggono un numero.
// I limiti veri (età, peso, altezza, quota di grassi) restano dove sono sempre
// stati, cioè nel markup e nel calcolo del fabbisogno.
function numeroDaCampo(v) {
  if (typeof v === "number") return isFinite(v) ? String(v) : "";
  if (typeof v !== "string") return "";
  const pulito = v.trim().slice(0, 12);
  if (!pulito || isNaN(parseFloat(pulito.replace(",", ".")))) return "";
  return pulito;
}

// Rilegge i pasti voce per voce: una struttura salvata da una versione diversa
// (o manomessa) non deve poter rompere il rendering.
function leggiPasti(salvati) {
  const pasti = creaPastiVuoti();
  PASTI.forEach(pasto => {
    const voci = salvati && Array.isArray(salvati[pasto]) ? salvati[pasto] : [];
    pasti[pasto] = voci.filter(v => v && v.per100).map(v => ({
      nome: String(v.nome || "Alimento").slice(0, MAX_NOME_ALIMENTO),
      grammi: Math.max(0, Number(v.grammi) || 0),
      nota: String(v.nota || "").slice(0, MAX_NOTA),
      per100: normalizzaPer100(v.per100),
      // Il legame con l'alimento personalizzato deve sopravvivere alla
      // ricarica, o dopo un F5 la voce non saprebbe più da dove viene.
      ...(typeof v.idAlimento === "string" && v.idAlimento.trim()
        ? { idAlimento: v.idAlimento.trim().slice(0, 40) } : {}),
      ...leggiUnita(v)
    }));
  });
  return pasti;
}

function salvaAlimentiCustom() {
  try { localStorage.setItem(CHIAVE_ALIMENTI, JSON.stringify(alimentiCustom)); } catch (e) { /* ignora */ }
}

// Gli alimenti salvati passano dalla stessa normalizzazione del caricamento da
// file: prima qui bastava che `nome` ci fosse, e un nome che non è una stringa
// (dato corrotto, o scritto da un'altra pagina dello stesso dominio) faceva
// esplodere formattaNome dentro ricostruisciElenco — che gira in una async, per
// cui l'errore restava zitto e la ricerca alimenti si presentava vuota.
// Un identificatore che non cambia quando cambiano il nome e i valori. È il
// filo che lega una voce già inserita all'alimento da cui è venuta: senza, il
// legame sarebbe il nome, cioè proprio la cosa che si vuole poter correggere.
// Il contatore serve ai casi di due alimenti creati nello stesso millisecondo,
// che con la sola data avrebbero lo stesso id.
let contatoreIdAlimento = 0;
function nuovoIdAlimento() {
  contatoreIdAlimento += 1;
  return `a${Date.now().toString(36)}-${contatoreIdAlimento.toString(36)}`;
}

function leggiAlimentiCustom(dati) {
  if (!Array.isArray(dati)) return [];
  return dati
    // Un nome che non è un testo non è recuperabile: convertirlo darebbe
    // "[object Object]" in mezzo agli alimenti, che è peggio del silenzio.
    .filter(a => a && (typeof a.nome === "string" || typeof a.nome === "number") && String(a.nome).trim() !== "")
    // Gli alimenti salvati prima che gli id esistessero ne ricevono uno adesso:
    // da qui in avanti sono rintracciabili come gli altri, e le voci che hanno
    // già prodotto restano riconoscibili dal nome.
    .map(a => ({
      id: typeof a.id === "string" && a.id.trim() ? a.id.trim().slice(0, 40) : nuovoIdAlimento(),
      nome: String(a.nome).trim().slice(0, MAX_NOME_ALIMENTO),
      ...normalizzaPer100(a)
    }));
}

function caricaAlimentiCustom() {
  let grezzi = [];
  try {
    grezzi = JSON.parse(localStorage.getItem(CHIAVE_ALIMENTI) || "[]");
  } catch (e) {
    grezzi = [];
  }
  alimentiCustom = leggiAlimentiCustom(grezzi);
  // Gli id assegnati adesso vanno riscritti subito. Se restassero solo in
  // memoria, al prossimo avvio ne nascerebbero di nuovi e le voci timbrate con
  // quelli di oggi punterebbero a un alimento che non esiste più: la
  // correzione non le troverebbe, e il legame si spezzerebbe a ogni ricarica.
  const daRiscrivere = !Array.isArray(grezzi)
    || grezzi.length !== alimentiCustom.length
    || grezzi.some(a => !a || typeof a.id !== "string" || !a.id.trim());
  if (alimentiCustom.length && daRiscrivere) salvaAlimentiCustom();
}

// ---------- Diete ----------
// Le diete sono indipendenti: cambiare dieta significa cambiare paziente, non
// giornata. Per questo ognuna ha un nome e un colore propri, e il colore vale
// per tutta la pagina: è il segnale che dice "stai lavorando su quest'altra".

// Rinomina in corso della dieta aperta: il menù a tendina lascia il posto a un
// campo di testo, come per le schede delle giornate.
let dietaInRinomina = false;

function applicaColoreDieta() {
  document.body.dataset.dieta = coloreValido(state.colore);
}

function chiudiRinominaDieta() {
  dietaInRinomina = false;
}

// Tutto quello che cambia quando si passa da una dieta all'altra: colore,
// campi del profilo, obiettivi, giornate. La pila di annullamento viene
// azzerata perché contiene le giornate della dieta che si sta lasciando:
// riversarle qui sarebbe un disastro silenzioso.
function apriDietaCorrente(messaggio) {
  state = archivio.diete[archivio.dietaAttiva];
  pilaAnnulla = [];
  modificaPesoInCorso = null;
  chiudiRinominaDieta();
  chiudiRinominaScheda();
  chiudiMenuAzioni();
  salvaStato();
  applicaColoreDieta();
  ripristinaCampiProfilo();
  renderFabbisogno();
  renderGiornata();
  aggiornaBottoneAnnulla();
  if (messaggio) mostraToast(messaggio);
}

function cambiaDieta(indice) {
  if (indice < 0 || indice >= archivio.diete.length || indice === archivio.dietaAttiva) return;
  archivio.dietaAttiva = indice;
  apriDietaCorrente(`Dieta aperta: ${archivio.diete[indice].nome}`);
}

// La creazione di una dieta non è annullabile con «Annulla»: quel pulsante
// lavora dentro una dieta sola. Per disfarla c'è il cestino qui accanto.
function nuovaDieta() {
  if (archivio.diete.length >= MAX_DIETE) return;
  const dieta = creaDietaVuota(nomeDietaLibero(), coloreDietaLibero());
  archivio.diete.push(dieta);
  archivio.dietaAttiva = archivio.diete.length - 1;
  apriDietaCorrente(`${dieta.nome}: pronta`);
}

function eliminaDieta() {
  if (archivio.diete.length <= 1) return;
  const dieta = state;
  const nome = dieta.nome;
  const conAlimenti = dieta.giornate.some(g => !pastiVuoti(g.pasti));
  const avviso = conAlimenti
    ? " Contiene degli alimenti e l'operazione non si può annullare."
    : "";
  if (!confirm(`Eliminare la dieta "${nome}"?${avviso}`)) return;
  archivio.diete.splice(archivio.dietaAttiva, 1);
  if (archivio.dietaAttiva >= archivio.diete.length) archivio.dietaAttiva = archivio.diete.length - 1;
  apriDietaCorrente(`Dieta "${nome}" eliminata`);
}

function apriRinominaDieta() {
  dietaInRinomina = true;
  dietaNomeInput.value = state.nome;
  renderDiete();
  // Il fuoco si prende qui, una volta sola. Il campo è nel markup fisso e non
  // viene ricreato a ogni render (a differenza di quello delle giornate),
  // quindi renderDiete non deve rimetterci mano: se lo facesse, un ridisegno
  // qualsiasi durante la rinomina strapperebbe il fuoco da dov'è.
  dietaNomeInput.focus();
  dietaNomeInput.select();
}

function confermaRinominaDieta(valore) {
  chiudiRinominaDieta();
  const pulito = String(valore || "").trim();
  if (pulito) state.nome = nomeDietaUnico(pulito, archivio.dietaAttiva);
  salvaStato();
  renderDiete();
  renderGiornata();
}

// Esce dalla rinomina lasciando il nome com'era. Il campo che si nasconde
// perde il fuoco e fa scattare il "blur", ma quello controlla dietaInRinomina
// e a quel punto lo trova già chiuso: non riscrive nulla.
function annullaRinominaDieta() {
  if (!dietaInRinomina) return;
  chiudiRinominaDieta();
  renderDiete();
}

function impostaColoreDieta(id) {
  state.colore = coloreValido(id);
  salvaStato();
  applicaColoreDieta();
  renderDiete();
}

function renderDiete() {
  const piu = archivio.diete.length > 1;

  dietaSelect.classList.toggle("hidden", dietaInRinomina);
  dietaNomeInput.classList.toggle("hidden", !dietaInRinomina);
  if (!dietaInRinomina) {
    dietaSelect.innerHTML = archivio.diete.map((d, i) =>
      `<option value="${i}"${i === archivio.dietaAttiva ? " selected" : ""}>${escapeHtml(d.nome)}</option>`
    ).join("");
  }

  const pieno = archivio.diete.length >= MAX_DIETE;
  dietaNuovaBtn.disabled = pieno;
  dietaNuovaBtn.title = pieno
    ? `Massimo ${MAX_DIETE} diete: eliminane una per aggiungerne un'altra`
    : "Aggiungi una dieta";
  dietaEliminaBtn.disabled = !piu;
  dietaEliminaBtn.title = piu
    ? `Elimina «${state.nome}» con tutte le sue giornate`
    : "L'unica dieta non si può eliminare";

  dietaColori.innerHTML = COLORI_DIETA.map(c => `
    <button type="button" class="dieta-colore${c.id === state.colore ? " attivo" : ""}" data-colore="${c.id}"
            title="${c.nome}" aria-label="Colore ${c.nome}" aria-pressed="${c.id === state.colore}"></button>`).join("");

  const r = mediaGiornate(state.giornate);
  const parti = [
    piu ? `Dieta ${archivio.dietaAttiva + 1} di ${archivio.diete.length}` : "Un'unica dieta",
    `${state.giornate.length} ${state.giornate.length === 1 ? "giornata" : "giornate"}`,
    r ? `media ${arrotonda(r.media.kcal)} kcal` : "ancora vuota"
  ];
  if (state.obiettivo > 0) parti.push(`obiettivo ${arrotonda(state.obiettivo)} kcal`);
  parti.push(`colore ${nomeColore(state.colore)}`);
  dietaInfo.textContent = parti.join(" · ");
}

// ---------- Misure casalinghe ----------
// I valori della tabella sono per 100 GRAMMI, sempre. Millilitri, cucchiai e
// bicchieri non sono altre etichette per la stessa cosa: 100 ml di olio pesano
// 91 g, cioè 81 kcal in meno di 100 g. Il grammo resta quindi l'unità dei
// conti, e la misura casalinga è ciò che si scrive e si legge.
//
// Due strade per arrivare ai grammi, perché sono due problemi diversi:
//   - i LIQUIDI hanno una densità: un cucchiaio è 15 ml di quel liquido, un
//     bicchiere 200 ml, e il peso si ricava moltiplicando;
//   - i SOLIDI no. Un cucchiaio di farina pesa 9 g, non 15: fra i granelli
//     c'è aria, e la densità apparente non si deduce da nulla. Per loro
//     foods.json porta direttamente i grammi di un cucchiaio raso.
// Il bicchiere esiste solo per i liquidi: un bicchiere di farina non è una
// misura che qualcuno usi in cucina.
//
// Nessuno di questi valori viene dal CREA, che non li pubblica: sono
// riferimenti d'uso comune, con il volume del cucchiaio preso a 15 ml.

const ML_CUCCHIAIO = 15;
const ML_CUCCHIAINO = 5;
const ML_BICCHIERE = 200;
// Un cucchiaino è un terzo di cucchiaio. Per i solidi questo evita una seconda
// tabella di pesi: a parità di alimento la densità apparente è la stessa, quindi
// basta dividere i grammi del cucchiaio. Tornano i valori d'uso comune —
// zucchero 4 g, farina 3 g, cacao 2 g, miele 6,7 g.
const CUCCHIAINI_PER_CUCCHIAIO = ML_CUCCHIAIO / ML_CUCCHIAINO;

// nome: singolare e plurale, per scrivere "1 cucchiaio" e "2 cucchiai".
const MISURE = {
  g:          { uno: "g", molti: "g", passo: 1 },
  ml:         { uno: "ml", molti: "ml", passo: 1 },
  cucchiaio:  { uno: "cucchiaio", molti: "cucchiai", passo: 0.5 },
  cucchiaino: { uno: "cucchiaino", molti: "cucchiaini", passo: 0.5 },
  bicchiere:  { uno: "bicchiere", molti: "bicchieri", passo: 0.5 }
};

// Unità scelta nel riquadro di inserimento.
let unitaCorrente = "g";

// Quali misure può usare un alimento, in ordine di comodità.
function misureDisponibili(densita, gCucchiaio) {
  if (densita > 0) return ["ml", "cucchiaio", "cucchiaino", "bicchiere", "g"];
  if (gCucchiaio > 0) return ["cucchiaio", "cucchiaino", "g"];
  return ["g"];
}

// Quante cucchiaiate si contano ancora prima che il conto diventi il problema.
const MAX_CUCCHIAI_PROPOSTI = 4;

// La misura con cui l'app PROPONE una quantità calcolata da lei. Non la decide
// l'alimento da solo: il database dà un peso al cucchiaio anche allo yogurt, e
// un cucchiaio di yogurt è una misura vera, undici no — al posto di un
// bicchiere di latte compariva «11 cucchiai di yogurt», che non è più una
// misura casalinga ma un numero da leggere due volte. Sopra la soglia si torna
// ai grammi.
//
// Millilitri e bicchieri restano fuori dal conto: 200 ml o un bicchiere e mezzo
// si leggono a colpo d'occhio per qualunque quantità.
//
// Nel riquadro di inserimento questa scelta non si può fare — lì la quantità
// non è ancora stata scritta, e cambiare unità mentre si digita sarebbe peggio
// del difetto — e infatti lì c'è il selettore.
function misuraProposta(grammi, densita, gCucchiaio) {
  const misura = misureDisponibili(densita, gCucchiaio)[0];
  if (misura !== "cucchiaio" && misura !== "cucchiaino") return misura;
  const quanti = misuraDaGrammi(grammi, misura, densita, gCucchiaio);
  return quanti > MAX_CUCCHIAI_PROPOSTI ? "g" : misura;
}

// Grammi corrispondenti a una quantità espressa in una misura. Restituisce
// null quando la conversione non è possibile: meglio niente che un numero
// inventato.
function grammiDaMisura(quantita, unita, densita, gCucchiaio) {
  if (!(quantita > 0)) return null;
  if (unita === "g") return quantita;
  if (unita === "ml") return densita > 0 ? quantita * densita : null;
  if (unita === "bicchiere") return densita > 0 ? quantita * ML_BICCHIERE * densita : null;
  if (unita === "cucchiaio") {
    if (densita > 0) return quantita * ML_CUCCHIAIO * densita;
    return gCucchiaio > 0 ? quantita * gCucchiaio : null;
  }
  if (unita === "cucchiaino") {
    if (densita > 0) return quantita * ML_CUCCHIAINO * densita;
    return gCucchiaio > 0 ? quantita * gCucchiaio / CUCCHIAINI_PER_CUCCHIAIO : null;
  }
  return null;
}

// Il percorso inverso, per riscrivere un peso nella misura scelta.
function misuraDaGrammi(grammi, unita, densita, gCucchiaio) {
  const perUno = grammiDaMisura(1, unita, densita, gCucchiaio);
  return perUno > 0 ? grammi / perUno : null;
}

// Numeri all'italiana, senza decimali inutili: 250 ml, non "250,0 ml".
function fmtNumero(n) {
  return Number(n).toLocaleString("it-IT");
}

function etichettaMisura(unita, quantita) {
  const m = MISURE[unita] || MISURE.g;
  return Math.abs(quantita) === 1 ? m.uno : m.molti;
}

// Quantità e unità di una voce già inserita, per mostrarla come è stata
// scritta. Una voce salvata prima delle misure casalinghe non ha unità: è in
// grammi.
function quantitaVoce(voce) {
  const unita = voce.unita;
  if (unita && unita !== "g" && MISURE[unita]) {
    const q = Number(voce.quantita) > 0
      ? Number(voce.quantita)
      : misuraDaGrammi(voce.grammi, unita, voce.densita, voce.gCucchiaio);
    if (q > 0) return { valore: round1(q), unita };
  }
  return { valore: voce.grammi, unita: "g" };
}

function testoQuantitaVoce(voce) {
  const q = quantitaVoce(voce);
  return `${fmtNumero(q.valore)} ${etichettaMisura(q.unita, q.valore)}`;
}

// Rilegge dal salvataggio i campi della misura, scartando quello che non torna:
// senza densità o grammi-per-cucchiaio la conversione non si può fare, e si
// torna ai grammi invece di mostrare un valore inventato.
function leggiUnita(v) {
  if (!v || typeof v !== "object") return {};
  const densita = Number(v.densita) > 0 ? Number(v.densita) : undefined;
  const gCucchiaio = Number(v.gCucchiaio) > 0 ? Number(v.gCucchiaio) : undefined;
  const base = {};
  if (densita) base.densita = densita;
  if (gCucchiaio) base.gCucchiaio = gCucchiaio;

  const unita = v.unita;
  if (!unita || unita === "g" || !MISURE[unita]) return base;
  // "ml" era l'unico campo delle prime versioni: vale come quantità.
  const quantita = Number(v.quantita) > 0 ? Number(v.quantita)
    : (unita === "ml" && Number(v.ml) > 0 ? Number(v.ml) : 0);
  if (!(grammiDaMisura(1, unita, densita, gCucchiaio) > 0)) return base;
  return quantita > 0 ? { ...base, unita, quantita } : { ...base, unita };
}

// ---------- Copia di sicurezza su file ----------
// Tutto vive nel localStorage di un browser solo: senza un file esportabile una
// pulizia dei dati di navigazione porta via mesi di lavoro senza rimedio.

const VERSIONE_FILE = 1;

function nomeFileSalvataggio() {
  const d = new Date();
  const p = n => String(n).padStart(2, "0");
  return `calcolo-rapido-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.json`;
}

function esportaDati() {
  const contenuto = {
    formato: "calcolo-rapido",
    versione: VERSIONE_FILE,
    esportatoIl: new Date().toISOString(),
    archivio,
    alimentiCustom
  };
  try {
    const blob = new Blob([JSON.stringify(contenuto, null, 1)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nomeFileSalvataggio();
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Rilasciato dopo il clic: revocarlo subito annullerebbe il download.
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    mostraToast("Salvato: conserva il file, è la tua copia di sicurezza");
  } catch (e) {
    mostraToast("Salvataggio su file non riuscito");
  }
}

async function importaDati(file) {
  if (!file) return;
  let dati = null;
  try {
    dati = JSON.parse(await file.text());
  } catch (e) {
    mostraToast("File non leggibile: non è un salvataggio di Calcolo rapido");
    return;
  }
  if (!dati || dati.formato !== "calcolo-rapido" || !dati.archivio) {
    mostraToast("File non riconosciuto: non è un salvataggio di Calcolo rapido");
    return;
  }
  const quante = Array.isArray(dati.archivio.diete) ? dati.archivio.diete.length : 0;
  if (!quante) {
    mostraToast("Il file non contiene nessuna dieta");
    return;
  }
  // Anche gli alimenti creati vengono sostituiti, quindi la domanda li conta:
  // il caso da dire ad alta voce è il file che non ne porta nessuno, dove la
  // sostituzione è una cancellazione e basta.
  const alimentiInArrivo = leggiAlimentiCustom(dati.alimentiCustom);
  const quantiMiei = alimentiCustom.length;
  const avvisoAlimenti = quantiMiei
    ? `\n\n${quantiMiei === 1 ? "Anche l'alimento che hai creato viene sostituito" : `Anche i ${quantiMiei} alimenti che hai creato vengono sostituiti`}: il file ne porta ${alimentiInArrivo.length || "nessuno"}.`
    : "";

  // Sostituzione, non fusione: unire due archivi darebbe diete duplicate senza
  // che si capisca quali. Chi vuole tenere anche il lavoro di adesso lo salva
  // prima su file.
  if (!confirm(`Caricare ${quante} ${quante === 1 ? "dieta" : "diete"} dal file?\n\nQuesto SOSTITUISCE tutto il lavoro presente in questo browser. Se ti serve, salvalo prima su file.${avvisoAlimenti}`)) return;

  // Le stesse funzioni che rileggono il localStorage: un file manomesso o
  // scritto da un'altra versione non deve poter rompere il rendering.
  const nuovo = creaArchivioVuoto();
  nuovo.diete = dati.archivio.diete.slice(0, MAX_DIETE).map((d, i) =>
    leggiDieta(d, `Dieta ${i + 1}`, COLORI_DIETA[i % COLORI_DIETA.length].id));
  const attiva = Number(dati.archivio.dietaAttiva);
  nuovo.dietaAttiva = attiva >= 0 && attiva < nuovo.diete.length ? attiva : 0;
  archivio = nuovo;

  // Anche gli alimenti vengono SOSTITUITI, e per questo fuori da ogni "se": un
  // file senza alimenti (scritto a mano, o da una versione che li chiamerà in
  // un altro modo) lasciava in piedi quelli di prima, e il browser restava con
  // le diete del file e gli alimenti di chi c'era prima — cioè l'archivio
  // ibrido che la sostituzione serve a evitare. leggiAlimentiCustom risponde
  // con un elenco vuoto a qualunque cosa non sia un elenco.
  alimentiCustom = alimentiInArrivo;
  salvaAlimentiCustom();
  ricostruisciElenco();

  apriDietaCorrente(`Caricate ${quante} ${quante === 1 ? "dieta" : "diete"} dal file`);
}

function cancellaTutto() {
  if (!confirm("Cancellare TUTTE le diete, i profili e gli alimenti creati su questo dispositivo?\n\nL'operazione non si può annullare. Se ti serve una copia, chiudi e usa prima «Salva su file».")) return;
  if (!confirm("Confermi? Tutto il contenuto di questo browser verrà cancellato.")) return;
  try {
    localStorage.removeItem(CHIAVE_STATO);
    localStorage.removeItem(CHIAVE_ALIMENTI);
  } catch (e) { /* niente da fare: si riparte comunque da vuoto */ }
  archivio = creaArchivioVuoto();
  alimentiCustom = [];
  ricostruisciElenco();
  apriDietaCorrente("Tutto cancellato");
}

// ---------- Finestre di dialogo ----------
// Gli overlay sono finestre modali a tutti gli effetti: vanno annunciate a chi
// usa uno screen reader, devono ricevere il fuoco e non lasciarlo scappare
// sulla pagina dietro, e alla chiusura devono restituirlo dov'era.

let fuocoPrimaDelDialogo = null;

function apriDialogo(overlay) {
  fuocoPrimaDelDialogo = document.activeElement;
  overlay.classList.remove("hidden");
  // Il primo campo VISIBILE: un dialogo che nasconde un campo secondo il caso
  // (la scelta della giornata quando la giornata è una sola) lascerebbe il fuoco
  // su un elemento invisibile, cioè da nessuna parte.
  const primo = Array.from(overlay.querySelectorAll("button, [href], input, select, textarea"))
    .find(campo => !campo.disabled && campo.offsetParent !== null);
  if (primo) primo.focus();
}

function chiudiDialogo(overlay) {
  overlay.classList.add("hidden");
  if (fuocoPrimaDelDialogo && document.contains(fuocoPrimaDelDialogo)) {
    fuocoPrimaDelDialogo.focus();
  }
  fuocoPrimaDelDialogo = null;
}

function dialogoAperto() {
  return [copiaPastoOverlay, spostaPastoOverlay, sostituisciOverlay, modificaAlimentoOverlay, installaOverlay]
    .find(o => o && !o.classList.contains("hidden")) || null;
}

// Tab e Shift+Tab girano dentro il dialogo aperto invece di uscirne.
function trattieniFuoco(e) {
  if (e.key !== "Tab") return;
  const overlay = dialogoAperto();
  if (!overlay) return;
  const fuocabili = Array.from(
    overlay.querySelectorAll("button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex='-1'])")
  ).filter(el => el.offsetParent !== null);
  if (!fuocabili.length) return;
  const primo = fuocabili[0];
  const ultimo = fuocabili[fuocabili.length - 1];
  if (!overlay.contains(document.activeElement)) {
    e.preventDefault();
    primo.focus();
    return;
  }
  if (e.shiftKey && document.activeElement === primo) {
    e.preventDefault();
    ultimo.focus();
  } else if (!e.shiftKey && document.activeElement === ultimo) {
    e.preventDefault();
    primo.focus();
  }
}

// ---------- Ripartizione per pasto: interfaccia ----------

function renderRipartizione() {
  const attiva = !!state.ripartizione;
  ripartizioneToggle.classList.toggle("attivo", attiva);

  if (!attiva) {
    ripartizioneStato.textContent = "non impostata";
    ripartizioneCampi.innerHTML = "";
    ripartizioneSomma.textContent = "";
    return;
  }

  const somma = sommaRipartizione(state.ripartizione);
  const quadra = Math.abs(somma - 100) < 0.5;
  ripartizioneStato.textContent = quadra
    ? (state.obiettivo > 0 ? "attiva" : "attiva (manca l'obiettivo calorie)")
    : `somma ${round1(somma)}%`;
  ripartizioneStato.classList.toggle("ripartizione-stato-errata", !quadra);

  ripartizioneCampi.innerHTML = PASTI.map(pasto => {
    const perc = Number(state.ripartizione[pasto]) || 0;
    const kcal = obiettivoPasto(pasto);
    return `
      <div class="campo ripartizione-campo">
        <label for="rip-${slug(pasto)}">${pasto}</label>
        <div class="ripartizione-input">
          <input type="number" id="rip-${slug(pasto)}" data-pasto-perc="${escapeHtml(pasto)}"
                 min="0" max="100" step="1" inputmode="numeric" value="${perc}">
          <span>%</span>
        </div>
        <span class="ripartizione-kcal">${kcal ? `${arrotonda(kcal)} kcal` : "—"}</span>
      </div>`;
  }).join("");

  ripartizioneSomma.textContent = quadra
    ? `Somma: 100% ✓`
    : `Somma: ${round1(somma)}% — deve fare 100%, correggi prima di fidarti degli obiettivi per pasto.`;
  ripartizioneSomma.classList.toggle("error", !quadra);
}

// Aggiorna le calorie a fianco di ogni pasto e la riga della somma senza
// ricreare i campi: mentre si digita una percentuale il fuoco deve restare
// dov'è.
function aggiornaEtichetteRipartizione() {
  if (!state.ripartizione) return;
  ripartizioneCampi.querySelectorAll("[data-pasto-perc]").forEach(campo => {
    const kcal = obiettivoPasto(campo.dataset.pastoPerc);
    const etichetta = campo.closest(".ripartizione-campo").querySelector(".ripartizione-kcal");
    if (etichetta) etichetta.textContent = kcal ? `${arrotonda(kcal)} kcal` : "—";
  });
  const somma = sommaRipartizione(state.ripartizione);
  const quadra = Math.abs(somma - 100) < 0.5;
  ripartizioneSomma.textContent = quadra
    ? "Somma: 100% ✓"
    : `Somma: ${round1(somma)}% — deve fare 100%, correggi prima di fidarti degli obiettivi per pasto.`;
  ripartizioneSomma.classList.toggle("error", !quadra);
  ripartizioneStato.textContent = quadra
    ? (state.obiettivo > 0 ? "attiva" : "attiva (manca l'obiettivo calorie)")
    : `somma ${round1(somma)}%`;
  ripartizioneStato.classList.toggle("ripartizione-stato-errata", !quadra);
}

// Identificatore utilizzabile in un attributo id a partire dal nome del pasto.
function slug(testo) {
  return normalizzaTesto(testo).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function attivaRipartizione() {
  state.ripartizione = creaRipartizioneTipica();
  salvaStato();
  renderGiornata();
}

function spegniRipartizione() {
  state.ripartizione = null;
  salvaStato();
  ripartizioneBox.classList.add("hidden");
  renderGiornata();
  mostraToast("Ripartizione per pasto disattivata");
}

// ---------- Database alimenti ----------

// `|| 0` difensivo: un valore mancante darebbe NaN e il NaN si propagherebbe in
// tutti i totali della giornata.
function normalizzaPer100(a) {
  const per100 = {
    kcal: Math.max(0, Number(a.kcal) || 0),
    proteine: Math.max(0, Number(a.proteine) || 0),
    grassi: Math.max(0, Number(a.grassi) || 0),
    carboidrati: Math.max(0, Number(a.carboidrati) || 0)
  };
  // I valori a -2 restano zero nei conti (non c'è altro da sommare), ma li
  // annotiamo: "0 g di carboidrati" e "carboidrati non misurati" sono due cose
  // diverse, e la seconda va detta invece di far finta della prima.
  // Il -2 si riconosce dal valore grezzo (tabella alimenti) oppure da un elenco
  // già annotato: una voce salvata nella giornata porta i suoi valori a zero,
  // e senza questo l'informazione andrebbe persa alla ricarica.
  const daiValori = Object.keys(ETICHETTE_MACRO).filter(k => Number(a[k]) === VALORE_ASSENTE);
  const giaNoti = Array.isArray(a.assenti) ? a.assenti.filter(k => k in ETICHETTE_MACRO) : [];
  const assenti = Array.from(new Set([...daiValori, ...giaNoti]));
  if (assenti.length) per100.assenti = assenti;
  return per100;
}

// ---------- Calorie che non vengono dai macronutrienti ----------
// L'etanolo dà 7 kcal per grammo e non è uno dei tre macronutrienti, quindi su
// un bicchiere di vino le calorie dichiarate e la somma di proteine, grassi e
// carboidrati non tornano: il whisky ha 238 kcal e macro a zero. Senza dirlo,
// la barra dei macro dichiara un 100% che non copre tutte le calorie del
// giorno, e le sostituzioni propongono mezzo bicchiere di gin al posto di un
// succo di frutta — stesse calorie, stessi (zero) macro, scarto perfetto.
//
// In tabella non c'è una colonna per l'alcol, ma non serve: lo scarto lo
// riconosce da sé. Misurato su tutti i 464 alimenti, la separazione è netta:
// oltre il 30% di calorie non spiegate ci sono 21 voci e sono TUTTE alcoliche
// (20 bevande più l'estratto di vaniglia, che è alcolico anche lui), la più
// bassa al 45%; sotto, il resto della tabella non supera il 5%. Le due soglie
// sono quindi larghe entrambe, e quella assoluta tiene fuori il rumore di
// arrotondamento sui valori minimi — la birra analcolica, 9 kcal, ha uno
// scarto del 24% che sono 2 kcal in tutto.
const SCARTO_ALCOL_PERC = 0.30;
const SCARTO_ALCOL_KCAL = 10;

// Calorie per 100 g che i tre macronutrienti non spiegano. Un valore "non
// disponibile" vale zero, come già lo vale nei conti: lo scarto diventa così un
// limite massimo, e va bene che lo sia. Fra i superalcolici sono proprio quelli
// con le proteine a -2 (brandy, cognac, grappa) i casi in cui non si può
// sapere se le calorie mancanti siano alcol o un dato che nessuno ha misurato:
// trattarli come gli altri li tiene fuori dalle sostituzioni, che è la cosa
// giusta in tutti e due i casi.
function kcalFuoriDaiMacro(per100) {
  if (!per100) return 0;
  const daiMacro = per100.proteine * KCAL_PER_G.proteine
    + per100.grassi * KCAL_PER_G.grassi
    + per100.carboidrati * KCAL_PER_G.carboidrati;
  return Math.max(0, per100.kcal - daiMacro);
}

// Vero per gli alimenti la cui energia viene in buona parte dall'alcol.
function eAlcolico(per100) {
  if (!per100 || !(per100.kcal > 0)) return false;
  const scarto = kcalFuoriDaiMacro(per100);
  return scarto >= SCARTO_ALCOL_KCAL && scarto / per100.kcal >= SCARTO_ALCOL_PERC;
}

// Calorie della giornata che arrivano dall'alcol. Si contano solo sugli
// alimenti riconosciuti come alcolici, non sommando lo scarto di tutti: su un
// alimento qualunque quello scarto è il gioco degli arrotondamenti della
// tabella, e sommato su una giornata intera diventerebbe un numero inventato.
function kcalDaAlcol(voci) {
  return voci.reduce((somma, voce) => {
    if (!eAlcolico(voce.per100)) return somma;
    return somma + kcalFuoriDaiMacro(voce.per100) * (Math.round(voce.grammi) / 100);
  }, 0);
}

// Copia dei valori per 100 g da attaccare a una voce della giornata. Le voci
// non devono condividere l'oggetto della tabella: sono la fotografia dei valori
// al momento dell'inserimento, e restano quelli. `assenti` è un array e va
// copiato a sua volta, o la condivisione si sposterebbe lì dentro.
function copiaPer100(per100) {
  const copia = { ...per100 };
  if (Array.isArray(per100 && per100.assenti)) copia.assenti = per100.assenti.slice();
  return copia;
}

// Quali dati mancano in una giornata, e in quanti alimenti: serve a dichiarare
// che il totale è per difetto invece di presentarlo come esatto.
function datiAssenti(voci) {
  const perNutriente = new Map();
  voci.forEach(voce => {
    (voce.per100 && voce.per100.assenti || []).forEach(k => {
      if (!perNutriente.has(k)) perNutriente.set(k, new Set());
      perNutriente.get(k).add(voce.nome);
    });
  });
  return perNutriente;
}

// Ricostruisce SEMPRE la mappa da zero, base + personalizzati. Fondamentale
// per gli alimenti personalizzati che hanno lo stesso nome di uno del database
// CREA: eliminandone uno deve riaffiorare la voce di base, non sparire tutto.
function ricostruisciElenco() {
  foodMap = new Map();
  categoriaDi = new Map();
  densitaDi = new Map();
  cucchiaioDi = new Map();
  alimentiBase.forEach(a => {
    foodMap.set(a.nome, normalizzaPer100(a));
    // Densità: presente solo sui liquidi, è ciò che abilita i millilitri.
    if (Number(a.densita) > 0) densitaDi.set(a.nome, Number(a.densita));
    if (Number(a.gCucchiaio) > 0) cucchiaioDi.set(a.nome, Number(a.gCucchiaio));
    // La categoria non serve al calcolo, ma senza di essa le sostituzioni
    // proporrebbero un formaggio al posto di una verdura.
    if (a.categoria) categoriaDi.set(a.nome, String(a.categoria));
  });
  idCustomDi = new Map();
  alimentiCustom.forEach(a => {
    foodMap.set(a.nome, normalizzaPer100(a));
    if (a.id) idCustomDi.set(a.nome, a.id);
  });

  foodNames = Array.from(foodMap.keys()).sort((a, b) => formattaNome(a).localeCompare(formattaNome(b), "it"));
  displayToKey = new Map();
  foodNames.forEach(k => displayToKey.set(normalizzaTesto(formattaNome(k)), k));
  // Indice pre-normalizzato: la ricerca scorre 900+ voci a ogni tasto premuto,
  // rifare ogni volta formattaNome + normalizzaTesto renderebbe la digitazione
  // a scatti. L'ordine è quello alfabetico di foodNames e viene conservato.
  indiceRicerca = foodNames.map(k => ({
    chiave: k,
    testoChiave: normalizzaTesto(k),
    testoMostrato: normalizzaTesto(formattaNome(k))
  }));
}

// I gruppi alimentari sono scritti in GRUPPI_ALIMENTARI come nomi di categoria
// copiati da foods.json, refusi compresi: «Carni di tutti I tipi» con la I
// maiuscola, «crakers», «Dolci, ciocc». Il giorno in cui si riesporta la
// tabella e qualcuno corregge un refuso, la categoria non viene più trovata, il
// gruppo si sfalda e le sostituzioni tornano a pescare dentro la sola categoria
// — senza un errore, senza una differenza visibile, solo un elenco di proposte
// più povero che nessuno collega alla causa. Qui non si può correggere niente
// in automatico (il nome giusto è quello nuovo, non il nostro), ma si può
// smettere di farlo in silenzio.
function verificaGruppiAlimentari(alimenti) {
  const presenti = new Set(alimenti.map(a => a && a.categoria).filter(Boolean));
  const orfane = GRUPPI_ALIMENTARI.flat().filter(c => !presenti.has(c));
  if (!orfane.length) return;
  console.warn(
    "Calcolo rapido: queste categorie di GRUPPI_ALIMENTARI non esistono in foods.json e non raggruppano più niente:\n  " +
    orfane.join("\n  ") +
    "\nVanno riallineate ai nomi della tabella, altrimenti le sostituzioni pescano solo dentro la categoria di partenza."
  );
}

async function caricaAlimenti() {
  try {
    const risposta = await fetch("foods.json");
    // Senza questo controllo una risposta d'errore in formato JSON passerebbe
    // per buona: il messaggio qui sotto non comparirebbe e la ricerca
    // resterebbe vuota senza spiegazione.
    if (!risposta.ok) throw new Error(`foods.json: risposta ${risposta.status}`);
    const dati = await risposta.json();
    if (!Array.isArray(dati)) throw new Error("foods.json non contiene un elenco di alimenti");
    alimentiBase = dati;
    verificaGruppiAlimentari(dati);
  } catch (e) {
    alimentiBase = [];
    erroreCaricamentoAlimenti = true;
    foodError.textContent = "Non è stato possibile caricare l'elenco degli alimenti. Controlla la connessione e ricarica la pagina.";
    foodError.classList.remove("hidden");
  }
  ricostruisciElenco();
}

function ePersonalizzato(chiave) {
  return alimentiCustom.some(a => a.nome === chiave);
}

// ---------- Autocompletamento ----------

function mostraSuggerimenti(chiavi) {
  indiceSuggerimento = -1;
  if (!chiavi.length) {
    nascondiSuggerimenti();
    return;
  }
  suggestions.innerHTML = chiavi.map((k, i) => {
    // La matita compare solo sugli alimenti tuoi: quelli della tabella CREA non
    // si correggono, e il posto per accorgersi che un valore è sbagliato è
    // proprio qui, mentre lo si sta cercando per inserirlo.
    const id = idCustomDi.get(k);
    const nome = escapeHtml(formattaNome(k));
    const tag = id
      ? ` <span class="tag-custom">mio</span><button type="button" class="suggestion-matita" data-modifica-alimento="${escapeHtml(id)}" title="Correggi ${nome}" aria-label="Correggi ${nome}">✎</button>`
      : "";
    return `<div class="suggestion-item" data-index="${i}">${nome}${tag}</div>`;
  }).join("");
  suggestions.dataset.items = JSON.stringify(chiavi);
  suggestions.classList.remove("hidden");
}

function nascondiSuggerimenti() {
  suggestions.innerHTML = "";
  suggestions.dataset.items = "[]";
  suggestions.classList.add("hidden");
  indiceSuggerimento = -1;
}

// Vero se `q` compare in `testo` all'inizio di una parola: serve a far salire
// "Petto di pollo" o "Pollo (ala)" quando si cerca "pollo", tenendo sotto le
// voci in cui il testo cercato capita in mezzo a una parola ("Cipolle").
function iniziaParola(testo, q) {
  let i = testo.indexOf(q);
  while (i !== -1) {
    if (i === 0 || /[\s,.;:/(\['"«-]/.test(testo.charAt(i - 1))) return true;
    i = testo.indexOf(q, i + 1);
  }
  return false;
}

// Quanto è "buona" la corrispondenza: 0 il nome comincia col testo cercato,
// 1 comincia con esso una delle parole successive, 2 lo contiene e basta.
// null = nessuna corrispondenza.
function rangoCorrispondenza(voce, q) {
  if (voce.testoMostrato.startsWith(q) || voce.testoChiave.startsWith(q)) return 0;
  if (iniziaParola(voce.testoMostrato, q) || iniziaParola(voce.testoChiave, q)) return 1;
  if (voce.testoMostrato.includes(q) || voce.testoChiave.includes(q)) return 2;
  return null;
}

function aggiornaSuggerimenti() {
  const q = normalizzaTesto(foodInput.value.trim());
  if (!q) {
    nascondiSuggerimenti();
    return;
  }
  const trovati = [];
  indiceRicerca.forEach(voce => {
    const rango = rangoCorrispondenza(voce, q);
    if (rango !== null) trovati.push({ rango, chiave: voce.chiave });
  });
  // sort() è stabile: a parità di rango resta l'ordine alfabetico di partenza.
  trovati.sort((a, b) => a.rango - b.rango);
  mostraSuggerimenti(trovati.slice(0, 50).map(t => t.chiave));
}

function evidenziaSuggerimento() {
  const items = suggestions.querySelectorAll(".suggestion-item");
  items.forEach((item, i) => item.classList.toggle("active", i === indiceSuggerimento));
  if (indiceSuggerimento >= 0 && items[indiceSuggerimento]) {
    items[indiceSuggerimento].scrollIntoView({ block: "nearest" });
  }
}

function scegliSuggerimento(indice) {
  const chiavi = JSON.parse(suggestions.dataset.items || "[]");
  const chiave = chiavi[indice];
  if (!chiave) return;
  foodInput.value = formattaNome(chiave);
  nascondiSuggerimenti();
  selezionaAlimento(chiave);
  quantitaInput.focus();
  quantitaInput.select();
}

// Dal testo digitato risale alla chiave originale del database.
function risolviChiave(testo) {
  const raw = (testo || "").trim();
  if (!raw) return null;
  if (foodMap.has(raw)) return raw;
  return displayToKey.get(normalizzaTesto(raw)) || null;
}

// ---------- Selezione alimento e calcolo ----------

function selezionaAlimento(chiave) {
  if (!chiave || !foodMap.has(chiave)) {
    alimentoSelezionato = null;
    alimentoScelto.classList.add("hidden");
  } else {
    const per100 = foodMap.get(chiave);
    const densita = densitaDi.get(chiave) || null;
    const gCucchiaio = cucchiaioDi.get(chiave) || null;
    alimentoSelezionato = { chiave, nome: formattaNome(chiave), per100, densita, gCucchiaio,
      idAlimento: idCustomDi.get(chiave) || null };
    alimentoSceltoNome.textContent = alimentoSelezionato.nome;
    // Le conversioni si dicono subito: sono quelle che l'app applica, e vederle
    // scritte evita di doversi fidare al buio.
    const peso = (u) => {
      const g = grammiDaMisura(1, u, densita, gCucchiaio);
      return g ? `1 ${MISURE[u].uno} = ${round1(g)} g` : "";
    };
    const conversione = [
      densita ? `100 ml = ${round1(grammiDaMisura(100, "ml", densita, gCucchiaio))} g` : "",
      peso("cucchiaio"),
      peso("cucchiaino"),
      peso("bicchiere")
    ].filter(Boolean).join(" · ");
    alimentoSceltoPer100.textContent =
      `per 100 g: ${round1(per100.kcal)} kcal · ${round1(per100.proteine)} P · ${round1(per100.grassi)} G · ${round1(per100.carboidrati)} C` +
      (conversione ? ` — ${conversione}` : "");
    alimentoEliminaBtn.classList.toggle("hidden", !ePersonalizzato(chiave));
    alimentoScelto.classList.remove("hidden");
  }
  // Si parte dalla misura più naturale per quell'alimento: millilitri per i
  // liquidi, cucchiai per zucchero, farina e affini, grammi per tutto il resto.
  // Il selettore permette comunque di cambiare.
  unitaCorrente = alimentoSelezionato
    ? misureDisponibili(alimentoSelezionato.densita, alimentoSelezionato.gCucchiaio)[0]
    : "g";
  aggiornaSelettoreUnita();
  aggiornaAnteprima();
}

// Il selettore compare solo dove ha senso: alimento con almeno una misura
// casalinga e quantità espressa come peso. Partendo da calorie o da proteine il
// numero digitato non è una quantità di alimento, quindi l'unità non è in gioco.
function aggiornaSelettoreUnita() {
  const misure = alimentoSelezionato
    ? misureDisponibili(alimentoSelezionato.densita, alimentoSelezionato.gCucchiaio)
    : ["g"];
  const attivo = misure.length > 1 && modoCalcolo === "grammi";
  unitaSelect.classList.toggle("hidden", !attivo);
  quantitaUnita.classList.toggle("hidden", attivo);
  if (!misure.includes(unitaCorrente)) unitaCorrente = misure[0];
  // Il passo segue sempre l'unità in uso, anche quando il selettore non si
  // vede: lasciarci quello dell'alimento di prima darebbe mezzi grammi su un
  // campo che vuole numeri interi.
  quantitaInput.step = MISURE[unitaCorrente].passo;
  if (!attivo) {
    // Svuotato quando è nascosto: lasciarci le misure dell'alimento di prima
    // significherebbe tenere in pagina uno stato che non corrisponde a nulla.
    unitaSelect.innerHTML = "";
    return;
  }
  unitaSelect.innerHTML = misure.map(u =>
    `<option value="${u}"${u === unitaCorrente ? " selected" : ""}>${MISURE[u].molti}</option>`).join("");
}

function impostaUnita(unita) {
  if (!alimentoSelezionato || !MISURE[unita] || unita === unitaCorrente) return;
  const densita = alimentoSelezionato.densita;
  const gCucchiaio = alimentoSelezionato.gCucchiaio;
  if (!misureDisponibili(densita, gCucchiaio).includes(unita)) return;
  // Il numero già digitato viene convertito invece di essere azzerato: chi ha
  // scritto 200 ml e passa ai grammi si aspetta di leggere 206.
  const valore = parseFloat(quantitaInput.value);
  if (valore > 0) {
    const grammi = grammiDaMisura(valore, unitaCorrente, densita, gCucchiaio);
    const convertito = grammi !== null ? misuraDaGrammi(grammi, unita, densita, gCucchiaio) : null;
    if (convertito !== null) quantitaInput.value = round1(convertito);
  }
  unitaCorrente = unita;
  aggiornaSelettoreUnita();
  aggiornaAnteprima();
}

function testoNotaModo() {
  if (modoCalcolo === "grammi") return "Scrivi i grammi: calcoliamo calorie e macronutrienti.";
  if (modoCalcolo === "kcal") return "Scrivi le calorie che vuoi ottenere: calcoliamo i grammi da mettere nella dieta.";
  return "Scrivi i grammi di proteine da raggiungere: calcoliamo i grammi di alimento.";
}

function impostaModo(modo) {
  modoCalcolo = modo;
  Array.from(modoGruppo.children).forEach(b => b.classList.toggle("attivo", b.dataset.modo === modo));
  if (modo === "grammi") quantitaUnita.textContent = "g";
  else if (modo === "kcal") quantitaUnita.textContent = "kcal";
  else quantitaUnita.textContent = "g prot.";
  aggiornaSelettoreUnita();
  aggiornaAnteprima();
}

// Traduce il valore digitato in grammi di alimento, secondo la modalità scelta.
// Restituisce null se il calcolo non è possibile (es. grammi di proteine
// richiesti da un alimento che non ne contiene).
function grammiDaValore(per100, valore) {
  if (modoCalcolo === "grammi") {
    // In una misura casalinga il numero digitato non è un peso: va convertito,
    // altrimenti 100 ml di olio verrebbero contati come 100 g, cioè 81 kcal di
    // troppo.
    if (unitaCorrente === "g" || !alimentoSelezionato) return valore;
    const g = grammiDaMisura(valore, unitaCorrente, alimentoSelezionato.densita, alimentoSelezionato.gCucchiaio);
    return g === null ? valore : g;
  }
  const per1g = (modoCalcolo === "kcal" ? per100.kcal : per100.proteine) / 100;
  if (per1g <= 0) return null;
  return valore / per1g;
}

// I grammi si arrotondano PRIMA di calcolare i macronutrienti: così l'anteprima
// e la riga poi inserita nella giornata mostrano esattamente gli stessi numeri.
function calcolaVoce(per100, grammi) {
  const arrotondati = Math.round(grammi);
  const f = arrotondati / 100;
  return {
    grammi: arrotondati,
    kcal: round1(per100.kcal * f),
    proteine: round1(per100.proteine * f),
    grassi: round1(per100.grassi * f),
    carboidrati: round1(per100.carboidrati * f)
  };
}

function aggiornaAnteprima() {
  const testo = foodInput.value.trim();
  // L'avviso "non trovato" compare solo se si sta scrivendo qualcosa. Se invece
  // è fallito il caricamento del database resta sempre a video: senza alimenti
  // la pagina non può funzionare.
  if (!erroreCaricamentoAlimenti) {
    foodError.classList.toggle("hidden", !testo || !!alimentoSelezionato);
  }
  modoNota.textContent = testoNotaModo();

  const valore = parseFloat(quantitaInput.value);
  if (!alimentoSelezionato || !valore || valore <= 0) {
    preview.classList.add("hidden");
    aggiungiBtn.disabled = true;
    calcoloCorrente = null;
    return;
  }

  const grammi = grammiDaValore(alimentoSelezionato.per100, valore);
  if (grammi === null || !isFinite(grammi) || grammi <= 0) {
    preview.classList.add("hidden");
    aggiungiBtn.disabled = true;
    calcoloCorrente = null;
    modoNota.textContent = modoCalcolo === "kcal"
      ? "Questo alimento non apporta calorie: non si può partire da un valore calorico."
      : "Questo alimento non contiene proteine: non si può partire dalle proteine.";
    return;
  }

  const v = calcolaVoce(alimentoSelezionato.per100, grammi);

  // Sotto il grammo il peso arrotonderebbe a 0: si finirebbe per inserire nel
  // piano una riga da "0 g / 0 kcal", che non vuol dire nulla.
  if (v.grammi < 1) {
    preview.classList.add("hidden");
    aggiungiBtn.disabled = true;
    calcoloCorrente = null;
    modoNota.textContent = modoCalcolo === "grammi"
      ? "Quantità troppo piccola: serve almeno 1 g."
      : "Quantità troppo piccola: corrisponde a meno di 1 g di alimento.";
    return;
  }

  // E il tetto dall'altra parte: senza, un decimale finito nel posto sbagliato
  // entra in dieta e schiaccia le barre di tutta la giornata.
  if (v.grammi > MAX_GRAMMI_VOCE) {
    preview.classList.add("hidden");
    aggiungiBtn.disabled = true;
    calcoloCorrente = null;
    modoNota.textContent = modoCalcolo === "grammi"
      ? `Quantità troppo grande: il massimo per una voce è ${MAX_GRAMMI_VOCE} g.`
      : `Quantità troppo grande: corrisponde a ${v.grammi.toLocaleString("it-IT")} g di alimento, oltre il massimo di ${MAX_GRAMMI_VOCE} g.`;
    return;
  }

  // per100 viene COPIATO, non passato per riferimento: la voce inserita nella
  // giornata deve restare quella di oggi anche se domani l'alimento di partenza
  // cambia valori. È la stessa promessa che l'app fa già a parole quando si
  // elimina un alimento personalizzato («le voci già inserite restano
  // invariate»), e che con l'oggetto condiviso non avrebbe potuto mantenere.
  calcoloCorrente = { nome: alimentoSelezionato.nome, grammi: v.grammi, per100: copiaPer100(alimentoSelezionato.per100),
    idAlimento: alimentoSelezionato.idAlimento };
  // L'unità con cui è stata scritta la quantità resta attaccata alla voce: la
  // riga, la stampa e il testo copiato la ripetono come l'ha scritta chi compone
  // la dieta, invece di ritradurla in grammi.
  // Densità e grammi-per-cucchiaio viaggiano sempre con la voce: servono a
  // ricalcolare la misura più tardi senza dover riaprire la tabella.
  if (alimentoSelezionato.densita) calcoloCorrente.densita = alimentoSelezionato.densita;
  if (alimentoSelezionato.gCucchiaio) calcoloCorrente.gCucchiaio = alimentoSelezionato.gCucchiaio;
  if (unitaCorrente !== "g" && modoCalcolo === "grammi") {
    calcoloCorrente.unita = unitaCorrente;
    calcoloCorrente.quantita = round1(valore);
  }

  previewKcal.textContent = v.kcal;
  // Con i millilitri il peso corrispondente si mostra SEMPRE, anche partendo
  // dal volume: è il numero con cui sono stati fatti i conti.
  previewGrammi.textContent = (unitaCorrente !== "g" || modoCalcolo !== "grammi")
    ? `≈ ${v.grammi} g`
    : "";
  previewProt.textContent = v.proteine;
  previewFat.textContent = v.grassi;
  previewCarb.textContent = v.carboidrati;
  preview.classList.remove("hidden");
  aggiungiBtn.disabled = false;
}

// ---------- Alimenti personalizzati (solo locali) ----------

function apriFormNuovoAlimento() {
  nuovoAlimentoForm.classList.remove("hidden");
  nuovoNome.value = foodInput.value.trim();
  nascondiSuggerimenti();
  nuovoNome.focus();
}

function chiudiFormNuovoAlimento() {
  nuovoAlimentoForm.classList.add("hidden");
  nuovoAlimentoError.classList.add("hidden");
  [nuovoNome, nuovoKcal, nuovoProt, nuovoFat, nuovoCarb].forEach(i => { i.value = ""; });
}

function salvaNuovoAlimento() {
  const nome = nuovoNome.value.trim().slice(0, MAX_NOME_ALIMENTO);
  const valori = [nuovoKcal, nuovoProt, nuovoFat, nuovoCarb].map(i => parseFloat(i.value));
  if (!nome || valori.some(v => isNaN(v) || v < 0)) {
    nuovoAlimentoError.classList.remove("hidden");
    return;
  }
  const esistente = alimentiCustom.find(a => a.nome === nome);
  const alimento = {
    id: esistente ? esistente.id : nuovoIdAlimento(),
    nome,
    kcal: round1(valori[0]),
    proteine: round1(valori[1]),
    grassi: round1(valori[2]),
    carboidrati: round1(valori[3])
  };
  const dopo = () => {
    chiudiFormNuovoAlimento();
    foodInput.value = formattaNome(nome);
    selezionaAlimento(nome);
    quantitaInput.focus();
  };

  // Salvare con il nome di un alimento che è già tuo non è una creazione ma una
  // correzione, e merita la stessa domanda della sezione «I miei alimenti»:
  // altrimenti da qui si riscriverebbero valori usati in diete intere senza che
  // nessuno lo dica.
  if (esistente) {
    avviaModificaAlimento(esistente, alimento, dopo);
    return;
  }

  alimentiCustom.push(alimento);
  salvaAlimentiCustom();
  ricostruisciElenco();
  dopo();
  mostraToast("Alimento salvato su questo dispositivo");
}

// Tutte le voci, in tutte le diete, nate da un certo alimento personalizzato.
// Il legame è l'id. Per le voci inserite prima che gli id esistessero resta il
// nome, che è tutto quello che hanno: se un tuo alimento si chiama come uno
// della tabella, quelle vecchie voci non sono distinguibili — per questo la
// finestra di conferma elenca sempre dove andrà a finire la modifica.
function vociDelAlimento(alimento) {
  const atteso = formattaNome(alimento.nome);
  const trovate = [];
  archivio.diete.forEach(dieta => {
    dieta.giornate.forEach(giornata => {
      PASTI.forEach(pasto => {
        giornata.pasti[pasto].forEach(voce => {
          const combacia = voce.idAlimento ? voce.idAlimento === alimento.id : voce.nome === atteso;
          if (combacia) trovate.push({ dieta, giornata, pasto, voce });
        });
      });
    });
  });
  return trovate;
}

// Scrive l'alimento corretto e, se richiesto, riscrive le voci che ne erano
// nate. Un solo passo di annullamento per l'operazione intera: le voci e
// l'alimento devono tornare indietro insieme, o si resterebbe con una dieta
// riportata ai valori vecchi e un alimento già corretto.
function scriviAlimento(originale, nuovo, usi, propaga) {
  registraAnnullaArchivio(`modifica di ${formattaNome(originale.nome)}`);
  if (propaga) {
    const per100 = normalizzaPer100(nuovo);
    const nome = formattaNome(nuovo.nome);
    usi.forEach(({ voce }) => {
      voce.nome = nome;
      voce.per100 = copiaPer100(per100);
      // Le voci vecchie riconosciute dal nome prendono il timbro adesso: alla
      // prossima correzione saranno rintracciabili anche se il nome cambia.
      voce.idAlimento = nuovo.id;
    });
  }
  alimentiCustom = alimentiCustom.filter(a => a.id !== originale.id);
  alimentiCustom.push(nuovo);
  salvaAlimentiCustom();
  ricostruisciElenco();
  // Il riquadro di inserimento può avere in campo proprio quell'alimento: la
  // riga dei valori sotto al nome è quella di prima, e il nome stesso può
  // essere cambiato. Si rilegge, così quello che si sta per inserire è già la
  // versione corretta.
  if (alimentoSelezionato && alimentoSelezionato.idAlimento === nuovo.id) {
    foodInput.value = formattaNome(nuovo.nome);
    selezionaAlimento(nuovo.nome);
  }
  salvaStato();
  renderGiornata();
}

// ---------- Correzione di un alimento personalizzato ----------
// La correzione in corso: l'alimento di partenza, i valori nuovi, le voci che
// ne sono nate e che cosa fare dopo (il riquadro di inserimento e la sezione
// chiudono in modi diversi).
let modificaAlimento = null;

function apriModificaAlimento(id) {
  const alimento = alimentiCustom.find(a => a.id === id);
  if (!alimento) return;
  const per100 = normalizzaPer100(alimento);
  modificaAlimento = { originale: alimento, dopo: chiudiModificaAlimento };
  modificaAlimentoTitolo.textContent = `Correggi «${formattaNome(alimento.nome)}»`;
  modificaAlimentoNome.value = formattaNome(alimento.nome);
  modificaAlimentoKcal.value = round1(per100.kcal);
  modificaAlimentoProt.value = round1(per100.proteine);
  modificaAlimentoFat.value = round1(per100.grassi);
  modificaAlimentoCarb.value = round1(per100.carboidrati);
  nascondiSuggerimenti();
  mostraPassoModifica("form");
  apriDialogo(modificaAlimentoOverlay);
}

function chiudiModificaAlimento() {
  modificaAlimento = null;
  chiudiDialogo(modificaAlimentoOverlay);
}

function mostraPassoModifica(passo) {
  modificaAlimentoForm.classList.toggle("hidden", passo !== "form");
  modificaAlimentoConferma.classList.toggle("hidden", passo !== "conferma");
  modificaAlimentoErrore.classList.add("hidden");
}

function erroreModifica(testo) {
  modificaAlimentoErrore.textContent = testo;
  modificaAlimentoErrore.classList.remove("hidden");
}

// Dal modulo ai valori, con i controlli che valgono anche per la creazione.
// Torna null e scrive l'errore quando qualcosa non va.
function leggiModuloModifica(originale) {
  const nome = modificaAlimentoNome.value.trim().slice(0, MAX_NOME_ALIMENTO);
  const valori = [modificaAlimentoKcal, modificaAlimentoProt, modificaAlimentoFat, modificaAlimentoCarb]
    .map(i => parseFloat(i.value));
  if (!nome || valori.some(v => isNaN(v) || v < 0)) {
    erroreModifica("Scrivi un nome e quattro numeri non negativi.");
    return null;
  }
  // Due alimenti tuoi con lo stesso nome sarebbero indistinguibili nell'elenco
  // e nella ricerca: meglio fermarsi qui che lasciarli convivere.
  const gemello = alimentiCustom.find(a => a.id !== originale.id && a.nome === nome);
  if (gemello) {
    erroreModifica("Hai già un alimento con questo nome.");
    return null;
  }
  return {
    id: originale.id,
    nome,
    kcal: round1(valori[0]),
    proteine: round1(valori[1]),
    grassi: round1(valori[2]),
    carboidrati: round1(valori[3])
  };
}

// Il passaggio comune: se l'alimento non è in nessuna dieta si scrive e basta,
// altrimenti si chiede, perché da qui si possono riscrivere voci di diete che
// in questo momento non si stanno nemmeno guardando.
function avviaModificaAlimento(originale, nuovo, dopo) {
  const usi = vociDelAlimento(originale);
  if (!usi.length) {
    scriviAlimento(originale, nuovo, [], false);
    if (dopo) dopo();
    mostraToast("Alimento aggiornato");
    return;
  }
  modificaAlimento = { originale, nuovo, usi, dopo };
  mostraConfermaModifica();
  if (modificaAlimentoOverlay.classList.contains("hidden")) apriDialogo(modificaAlimentoOverlay);
}

// Dice quante voci, in quali diete, e di quanto cambia il totale di ogni
// giornata toccata: è il numero su cui si decide, e senza si firmerebbe al
// buio una modifica che può spostare una dieta di centinaia di calorie.
function mostraConfermaModifica() {
  const { originale, nuovo, usi } = modificaAlimento;
  const per100Nuovo = normalizzaPer100(nuovo);
  modificaAlimentoTitolo.textContent = `Correggi «${formattaNome(originale.nome)}»`;
  const rinominato = formattaNome(originale.nome) !== formattaNome(nuovo.nome);
  modificaAlimentoRiepilogo.textContent =
    `${formattaNome(originale.nome)} è già in ${usi.length} ${usi.length === 1 ? "voce" : "voci"}.`
    + (rinominato ? ` Aggiornandole prenderebbero anche il nome nuovo, «${formattaNome(nuovo.nome)}».` : "")
    + " Ecco come cambierebbero le giornate che le contengono:";

  const perGiornata = new Map();
  usi.forEach(u => {
    if (!perGiornata.has(u.giornata)) perGiornata.set(u.giornata, { dieta: u.dieta, voci: [] });
    perGiornata.get(u.giornata).voci.push(u.voce);
  });

  modificaAlimentoDove.innerHTML = Array.from(perGiornata.entries()).map(([giornata, dati]) => {
    const prima = totaliDi(giornata.pasti);
    const scarti = dati.voci.reduce((somma, voce) => {
      const nuovi = calcolaVoce(per100Nuovo, voce.grammi);
      const vecchi = calcolaVoce(voce.per100, voce.grammi);
      return {
        kcal: somma.kcal + nuovi.kcal - vecchi.kcal,
        proteine: somma.proteine + nuovi.proteine - vecchi.proteine,
        grassi: somma.grassi + nuovi.grassi - vecchi.grassi,
        carboidrati: somma.carboidrati + nuovi.carboidrati - vecchi.carboidrati
      };
    }, { kcal: 0, proteine: 0, grassi: 0, carboidrati: 0 });

    const macro = [["proteine", "P"], ["grassi", "G"], ["carboidrati", "C"]]
      .filter(([k]) => round1(scarti[k]) !== 0)
      .map(([k, sigla]) => `${segno(round1(scarti[k]))} ${sigla}`)
      .join(" · ");
    const inKcal = Math.round(scarti.kcal) === 0
      ? `${arrotonda(prima.kcal)} kcal invariate`
      : `${arrotonda(prima.kcal)} → ${arrotonda(prima.kcal + scarti.kcal)} kcal`;
    const cambio = macro ? `${inKcal} · ${macro}` : inKcal;
    return `
      <div class="modifica-alimento-riga">
        <span>${escapeHtml(dati.dieta.nome)} · ${escapeHtml(giornata.nome)}</span>
        <span class="modifica-alimento-kcal">${cambio}</span>
      </div>`;
  }).join("");

  mostraPassoModifica("conferma");
}

function concludiModificaAlimento(propaga) {
  if (!modificaAlimento || !modificaAlimento.nuovo) return;
  const { originale, nuovo, usi, dopo } = modificaAlimento;
  scriviAlimento(originale, nuovo, usi, propaga);
  modificaAlimento = null;
  if (dopo) dopo();
  mostraToast(propaga
    ? `Aggiornato, con ${usi.length} ${usi.length === 1 ? "voce" : "voci"} nelle diete`
    : "Aggiornato solo l'alimento: le voci già inserite restano com'erano");
}

function eliminaAlimentoPersonalizzato() {
  if (!alimentoSelezionato || !ePersonalizzato(alimentoSelezionato.chiave)) return;
  const chiave = alimentoSelezionato.chiave;
  if (!confirm(`Eliminare l'alimento personalizzato "${formattaNome(chiave)}"? Le voci già inserite nella giornata restano invariate.`)) return;

  alimentiCustom = alimentiCustom.filter(a => a.nome !== chiave);
  salvaAlimentiCustom();
  ricostruisciElenco();

  // Se il nome esisteva anche nel database CREA, la voce di base torna in gioco:
  // la si rimette in campo invece di svuotare tutto, così si vede cos'è cambiato.
  if (foodMap.has(chiave)) {
    foodInput.value = formattaNome(chiave);
    selezionaAlimento(chiave);
    mostraToast("Eliminato: tornano i valori dell'alimento di base");
  } else {
    foodInput.value = "";
    selezionaAlimento(null);
    mostraToast("Alimento eliminato");
  }
}

// ---------- Annulla ----------
// Ogni modifica alla giornata mette da parte una copia di com'era PRIMA, con
// una descrizione in italiano da mostrare all'utente. Si annulla a ritroso.
// La pila vive solo in memoria: chiudendo o ricaricando la pagina si perde,
// mentre la giornata (già salvata) resta.

const MAX_ANNULLA = 20;
let pilaAnnulla = [];
// Modifica di un peso in corso: la copia viene presa quando il campo riceve il
// fuoco e finisce nella pila solo se il valore cambia davvero, altrimenti ogni
// cifra digitata sarebbe un passo di annullamento a sé.
let modificaPesoInCorso = null;

// La copia comprende tutte le giornate e quale era aperta: annullando si torna
// anche sulla scheda dov'era avvenuta la modifica, altrimenti si vedrebbe un
// cambiamento "invisibile" su una scheda diversa da quella a video.
function clonaGiornate() {
  return { giornate: JSON.parse(JSON.stringify(state.giornate)), attiva: state.attiva };
}

function registraAnnulla(descrizione) {
  pilaAnnulla.push({ ...clonaGiornate(), descrizione });
  if (pilaAnnulla.length > MAX_ANNULLA) pilaAnnulla.shift();
  aggiornaBottoneAnnulla();
}

// Uno scatto dell'INTERO archivio, diete chiuse comprese, più gli alimenti
// creati. Serve alla correzione di un alimento personalizzato, che è l'unica
// operazione capace di toccare diete diverse da quella aperta: con il solo
// scatto delle giornate «Annulla» ne riporterebbe indietro una e lascerebbe le
// altre riscritte, che è peggio del non poter annullare affatto.
function registraAnnullaArchivio(descrizione) {
  pilaAnnulla.push({
    archivio: JSON.parse(JSON.stringify(archivio)),
    alimentiCustom: JSON.parse(JSON.stringify(alimentiCustom)),
    descrizione
  });
  if (pilaAnnulla.length > MAX_ANNULLA) pilaAnnulla.shift();
  aggiornaBottoneAnnulla();
}

// Descrizione con il nome della scheda, ma solo quando le schede sono più di
// una: con una sola giornata sarebbe rumore inutile.
function conNomeGiornata(testo) {
  return state.giornate.length > 1 ? `${testo} · ${giornataCorrente().nome}` : testo;
}

function aggiornaBottoneAnnulla() {
  const ultima = pilaAnnulla[pilaAnnulla.length - 1];
  annullaBtn.disabled = !ultima;
  const testo = ultima ? `Annulla: ${ultima.descrizione}` : "Niente da annullare";
  annullaBtn.title = testo;
  annullaBtn.setAttribute("aria-label", testo);
}

function annullaUltima() {
  const ultima = pilaAnnulla.pop();
  if (!ultima) return;
  if (ultima.archivio) {
    archivio = ultima.archivio;
    state = archivio.diete[archivio.dietaAttiva];
    alimentiCustom = ultima.alimentiCustom;
    salvaAlimentiCustom();
    ricostruisciElenco();
  } else {
    state.giornate = ultima.giornate;
    state.attiva = Math.min(ultima.attiva, state.giornate.length - 1);
  }
  salvaStato();
  renderGiornata();
  aggiornaBottoneAnnulla();
  mostraToast("Annullato: " + ultima.descrizione);
}

// ---------- Giornata ----------

function totaliVoci(voci) {
  return voci.reduce((acc, voce) => {
    const v = calcolaVoce(voce.per100, voce.grammi);
    acc.kcal += v.kcal;
    acc.proteine += v.proteine;
    acc.grassi += v.grassi;
    acc.carboidrati += v.carboidrati;
    return acc;
  }, { kcal: 0, proteine: 0, grassi: 0, carboidrati: 0 });
}

function totaliDi(pasti) {
  return totaliVoci(PASTI.flatMap(p => pasti[p]));
}

function totaliGiornata() {
  return totaliDi(pastiCorrenti());
}

function pastiVuoti(pasti) {
  return PASTI.every(p => pasti[p].length === 0);
}

function giornataVuota() {
  return pastiVuoti(pastiCorrenti());
}

function aggiungiAlPasto() {
  if (!calcoloCorrente) return;
  const pasto = pastoSelect.value;
  registraAnnulla(conNomeGiornata(`aggiunta di ${calcoloCorrente.nome} a ${pasto}`));
  pastiCorrenti()[pasto].push({
    nome: calcoloCorrente.nome,
    grammi: calcoloCorrente.grammi,
    nota: notaInput.value.trim().slice(0, MAX_NOTA),
    per100: calcoloCorrente.per100,
    ...(calcoloCorrente.densita ? { densita: calcoloCorrente.densita } : {}),
    ...(calcoloCorrente.gCucchiaio ? { gCucchiaio: calcoloCorrente.gCucchiaio } : {}),
    ...(calcoloCorrente.unita ? { unita: calcoloCorrente.unita, quantita: calcoloCorrente.quantita } : {}),
    ...(calcoloCorrente.idAlimento ? { idAlimento: calcoloCorrente.idAlimento } : {})
  });
  salvaStato();
  renderGiornata();

  // Campo alimento pronto per la voce successiva; il pasto resta quello scelto.
  foodInput.value = "";
  quantitaInput.value = "";
  notaInput.value = "";
  nascondiSuggerimenti();
  selezionaAlimento(null);
  mostraToast(`Aggiunto a ${pasto}`);
  foodInput.focus();
}

// Percentuali di energia dai tre macronutrienti (4/9/4 kcal per grammo).
function ripartizioneMacro(t) {
  const kcalProt = t.proteine * 4;
  const kcalFat = t.grassi * 9;
  const kcalCarb = t.carboidrati * 4;
  const somma = kcalProt + kcalFat + kcalCarb;
  if (somma <= 0) return { prot: 0, fat: 0, carb: 0 };
  return {
    prot: Math.round((kcalProt / somma) * 100),
    fat: Math.round((kcalFat / somma) * 100),
    carb: Math.round((kcalCarb / somma) * 100)
  };
}

// Dettaglio dei macronutrienti di una riga. Sta in una funzione sola perché la
// usano sia il disegno completo sia il ridisegno parziale durante la correzione
// di un peso: quando erano due, il secondo riscriveva il testo e portava via i
// "n.d.".
function dettaglioRigaHtml(voce) {
  const v = calcolaVoce(voce.per100, voce.grammi);
  const nota = voce.nota ? ` · ${escapeHtml(voce.nota)}` : "";
  // "n.d." al posto dello zero dove il dato non esiste: uno zero dichiarerebbe
  // un'assenza misurata, che è un'altra cosa.
  const assenti = (voce.per100 && voce.per100.assenti) || [];
  const q = (chiave, valore) => assenti.includes(chiave)
    ? `<abbr class="nd" title="Dato non disponibile nella tabella alimenti">n.d.</abbr>`
    : valore;
  return `${q("proteine", v.proteine)} P · ${q("grassi", v.grassi)} G · ${q("carboidrati", v.carboidrati)} C${nota}`;
}

function rigaAlimentoHtml(voce, pasto, indice) {
  const v = calcolaVoce(voce.per100, voce.grammi);
  const quantita = quantitaVoce(voce);
  return `
    <div class="riga-alimento" data-pasto="${escapeHtml(pasto)}" data-indice="${indice}">
      <div class="riga-testo">
        <div class="riga-nome">${escapeHtml(voce.nome)}</div>
        <div class="riga-dettaglio">${dettaglioRigaHtml(voce)}</div>
      </div>
      <input type="number" class="riga-grammi" value="${quantita.valore}" min="0" step="${MISURE[quantita.unita].passo}" inputmode="decimal"
             data-pasto="${escapeHtml(pasto)}" data-indice="${indice}"
             aria-label="Quantità di ${escapeHtml(voce.nome)} in ${MISURE[quantita.unita].molti}">
      <span class="riga-unita">${etichettaMisura(quantita.unita, quantita.valore)}</span>
      <span class="riga-kcal">${v.kcal} kcal</span>
      <button type="button" class="riga-sostituisci no-print" data-sostituisci-pasto="${escapeHtml(pasto)}" data-indice="${indice}"
              title="Sostituisci con un alimento equivalente" aria-label="Sostituisci ${escapeHtml(voce.nome)}">⇄</button>
      <button type="button" class="riga-elimina" data-pasto="${escapeHtml(pasto)}" data-indice="${indice}"
              title="Togli dalla giornata" aria-label="Togli ${escapeHtml(voce.nome)} dalla giornata">✕</button>
    </div>
  `;
}

// Confronto fra le calorie di un pasto e quelle che la ripartizione gli
// assegna. Fuori tolleranza il testo dice di quanto, così si sa se spostare
// qualcosa o lasciar stare.
function scartoPastoHtml(pasto, kcalPasto) {
  const meta = obiettivoPasto(pasto);
  if (!meta) return "";
  const scarto = kcalPasto - meta;
  const fuori = Math.abs(scarto) > meta * TOLLERANZA_PASTO;
  const classe = fuori ? (scarto > 0 ? " pasto-oltre" : " pasto-sotto") : " pasto-in-linea";
  const testo = !fuori
    ? `in linea (${arrotonda(meta)})`
    : scarto > 0
      ? `+${arrotonda(scarto)} su ${arrotonda(meta)}`
      : `−${arrotonda(-scarto)} su ${arrotonda(meta)}`;
  return `<span class="pasto-obiettivo${classe}">${testo}</span>`;
}

function pastoHtml(pasto, kcalGiorno) {
  const voci = pastiCorrenti()[pasto];
  const t = totaliVoci(voci);
  const quota = kcalGiorno > 0 ? Math.round((t.kcal / kcalGiorno) * 100) : 0;
  return `
    <div class="pasto" data-pasto="${escapeHtml(pasto)}">
      <div class="pasto-testata">
        <span class="pasto-nome">${pasto}</span>
        <span class="pasto-kcal">${arrotonda(t.kcal)} kcal <span class="pasto-quota">(${quota}%)</span>${scartoPastoHtml(pasto, t.kcal)}</span>
        <div class="pasto-azioni no-print">
          <button type="button" data-copia-pasto="${escapeHtml(pasto)}" title="Copia questo pasto come testo" aria-label="Copia ${pasto} come testo">📋</button>
          ${state.giornate.length > 1 ? `<button type="button" data-porta-pasto="${escapeHtml(pasto)}" title="Copia questo pasto in altre giornate" aria-label="Copia ${pasto} in altre giornate">→</button>` : ""}
          <button type="button" data-sposta-pasto="${escapeHtml(pasto)}" title="Sposta o scambia questo pasto" aria-label="Sposta o scambia ${pasto}">⇅</button>
          <button type="button" data-svuota-pasto="${escapeHtml(pasto)}" title="Svuota questo pasto" aria-label="Svuota ${pasto}">🗑</button>
        </div>
      </div>
      <div class="pasto-macro">${round1(t.proteine)} g proteine · ${round1(t.grassi)} g grassi · ${round1(t.carboidrati)} g carboidrati</div>
      ${voci.map((voce, i) => rigaAlimentoHtml(voce, pasto, i)).join("")}
    </div>
  `;
}

// Riga "X / Y g" con barra, per un macronutriente che ha un obiettivo.
// Restituisce stringa vuota se l'obiettivo non è impostato, così chi la chiama
// può inserirla senza controlli.
function bloccoObiettivoMacro(nome, valore, meta, classeBarra) {
  if (!(meta > 0)) return "";
  const percentuale = Math.min(100, Math.round((valore / meta) * 100));
  const scarto = round1(Math.abs(meta - valore));
  const sforato = valore > meta;
  return `
    <div class="totali-riga-obiettivo">
      <span>${nome} <strong>${round1(valore)}</strong> / ${round1(meta)} g</span>
      <span>${sforato ? `${scarto} g oltre` : `restano ${scarto} g`}</span>
    </div>
    <div class="barra-obiettivo ${classeBarra}"><span style="width:${percentuale}%"></span></div>
  `;
}

function totaliHtml(t) {
  const macro = ripartizioneMacro(t);
  const obiettivo = state.obiettivo;
  let barraObiettivo = "";
  let residuo = "";

  if (obiettivo > 0) {
    const percentuale = Math.min(100, Math.round((t.kcal / obiettivo) * 100));
    const sforato = t.kcal > obiettivo;
    const scarto = Math.abs(arrotonda(obiettivo - t.kcal));
    residuo = sforato
      ? `<span class="totali-residuo sforato">${scarto} kcal oltre l'obiettivo (${arrotonda(obiettivo)})</span>`
      : `<span class="totali-residuo">restano ${scarto} kcal su ${arrotonda(obiettivo)}</span>`;
    barraObiettivo = `<div class="barra-obiettivo"><span class="${sforato ? "sforato" : ""}" style="width:${percentuale}%"></span></div>`;
  }

  // Obiettivo proteine: qui "oltre" non è un allarme come per le calorie (è
  // normale superarlo di poco), quindi la barra piena resta del colore delle
  // proteine e cambia solo il testo.
  let bloccoProteine = "";
  if (state.obiettivoProteine > 0) {
    const meta = state.obiettivoProteine;
    const percentuale = Math.min(100, Math.round((t.proteine / meta) * 100));
    const scarto = round1(Math.abs(meta - t.proteine));
    const raggiunto = t.proteine >= meta;
    bloccoProteine = `
      <div class="totali-riga-obiettivo">
        <span>Proteine <strong>${round1(t.proteine)}</strong> / ${round1(meta)} g</span>
        <span class="${raggiunto ? "obiettivo-raggiunto" : ""}">${raggiunto ? `obiettivo raggiunto (+${scarto} g)` : `mancano ${scarto} g`}</span>
      </div>
      <div class="barra-obiettivo barra-proteine"><span style="width:${percentuale}%"></span></div>
    `;
  }

  // Grassi e carboidrati si leggono come una scorta da non sforare, più che
  // come una soglia da raggiungere: il testo dice quanto ne resta, e la barra
  // non diventa rossa perché superarli di poco non è un errore.
  const bloccoGrassi = bloccoObiettivoMacro("Grassi", t.grassi, state.obiettivoGrassi, "barra-grassi");
  const bloccoCarboidrati = bloccoObiettivoMacro("Carboidrati", t.carboidrati, state.obiettivoCarboidrati, "barra-carboidrati");

  // Se qualche alimento della giornata non ha un dato, il totale è per difetto
  // e va detto: presentarlo come esatto porterebbe a decisioni sbagliate.
  const vociDelGiorno = PASTI.flatMap(p => pastiCorrenti()[p]);

  // Le percentuali della barra qui sotto sono calcolate sulle calorie dei tre
  // macronutrienti, non sul totale: con dell'alcol in giornata i tre numeri
  // fanno comunque 100% mentre una fetta delle calorie non è rappresentata da
  // nessun colore. Dirlo è l'unico modo perché quel 100% resti leggibile.
  const alcol = kcalDaAlcol(vociDelGiorno);
  const avvisoAlcol = alcol >= 1
    ? `<p class="totali-incompleto">${arrotonda(alcol)} kcal su ${arrotonda(t.kcal)} vengono dall'alcol, che non è un macronutriente: le percentuali qui sopra riguardano solo proteine, grassi e carboidrati.</p>`
    : "";

  const assenti = datiAssenti(vociDelGiorno);
  let avvisoAssenti = "";
  if (assenti.size) {
    const parti = Array.from(assenti.entries()).map(([k, nomi]) => {
      const n = nomi.size;
      return `${ETICHETTE_MACRO[k]} (${n} ${n === 1 ? "alimento" : "alimenti"})`;
    });
    avvisoAssenti = `<p class="totali-incompleto">Totale per difetto: la tabella non riporta ${parti.join(" · ")}.</p>`;
  }

  return `
    <div class="totali">
      <div class="totali-testata">
        <span class="totali-kcal">${arrotonda(t.kcal)} kcal</span>
        ${residuo}
      </div>
      ${barraObiettivo}
      ${bloccoProteine}
      ${bloccoGrassi}
      ${bloccoCarboidrati}
      <div class="macro-barra">
        <i class="m-prot" style="width:${macro.prot}%"></i><i class="m-fat" style="width:${macro.fat}%"></i><i class="m-carb" style="width:${macro.carb}%"></i>
      </div>
      <div class="macro-legenda">
        <span><i class="punto p-prot"></i>Proteine <b>${round1(t.proteine)} g</b> (${macro.prot}%)</span>
        <span><i class="punto p-fat"></i>Grassi <b>${round1(t.grassi)} g</b> (${macro.fat}%)</span>
        <span><i class="punto p-carb"></i>Carboidrati <b>${round1(t.carboidrati)} g</b> (${macro.carb}%)</span>
      </div>
      ${avvisoAlcol}
      ${avvisoAssenti}
    </div>
  `;
}

function renderBarraTotale(t) {
  if (giornataVuota()) {
    barraTotale.classList.add("hidden");
    return;
  }
  let residuo = "";
  if (state.obiettivo > 0) {
    const scarto = arrotonda(state.obiettivo - t.kcal);
    residuo = scarto >= 0
      ? `<span class="bt-residuo">restano ${scarto} kcal</span>`
      : `<span class="bt-residuo sforato">+${Math.abs(scarto)} kcal</span>`;
  }
  let residuoProt = "";
  if (state.obiettivoProteine > 0) {
    const scarto = round1(state.obiettivoProteine - t.proteine);
    residuoProt = scarto > 0
      ? `<span class="bt-residuo bt-residuo-prot">${scarto} g prot.</span>`
      : `<span class="bt-residuo bt-residuo-prot obiettivo-raggiunto">prot. ✓</span>`;
  }
  // Grassi e carboidrati: solo il residuo, con l'iniziale del macronutriente.
  // Sono gli ultimi arrivati nella barra, e su schermo stretto sono i primi a
  // sparire (regola in CSS) per non far crescere la barra su due righe.
  const residuoMacro = (meta, valore, sigla, classe) => {
    if (!(meta > 0)) return "";
    const scarto = round1(meta - valore);
    return scarto >= 0
      ? `<span class="bt-residuo ${classe}">${scarto} g ${sigla}</span>`
      : `<span class="bt-residuo ${classe} sforato">+${Math.abs(scarto)} g ${sigla}</span>`;
  };
  const residuoFat = residuoMacro(state.obiettivoGrassi, t.grassi, "gr.", "bt-residuo-fat");
  const residuoCarb = residuoMacro(state.obiettivoCarboidrati, t.carboidrati, "carb.", "bt-residuo-carb");
  // Etichetta a sinistra: con più diete aperte il nome della giornata da solo
  // sarebbe ambiguo ("Giorno 1" ce l'hanno tutte), quindi si antepone la dieta.
  const etichette = [];
  if (archivio.diete.length > 1) etichette.push(state.nome);
  if (state.giornate.length > 1) etichette.push(giornataCorrente().nome);
  const nomeGiornata = etichette.length
    ? `<span class="bt-giornata">${escapeHtml(etichette.join(" · "))}</span>`
    : "";
  barraTotale.innerHTML = `
    ${nomeGiornata}
    <span class="bt-kcal">${arrotonda(t.kcal)} kcal</span>
    <span class="bt-macro">${round1(t.proteine)} P · ${round1(t.grassi)} G · ${round1(t.carboidrati)} C</span>
    ${residuo}
    ${residuoProt}
    ${residuoFat}
    ${residuoCarb}
  `;
  barraTotale.classList.remove("hidden");
}

// Indice della scheda in fase di rinomina (null = nessuna).
let schedaInRinomina = null;

function chiudiRinominaScheda() {
  schedaInRinomina = null;
}

function renderSchede() {
  const multipla = state.giornate.length > 1;
  giornateSchede.innerHTML = state.giornate.map((g, i) => {
    const attiva = i === state.attiva;
    const kcal = arrotonda(totaliDi(g.pasti).kcal);
    if (attiva && schedaInRinomina === i) {
      return `
        <div class="giornata-scheda attiva in-rinomina">
          <input type="text" class="scheda-nome-input" id="scheda-nome-input" value="${escapeHtml(g.nome)}"
                 maxlength="40" data-rinomina aria-label="Nome della giornata">
        </div>`;
    }
    const titolo = attiva
      ? `${g.nome} — tocca di nuovo per rinominare`
      : `Apri ${g.nome} (${kcal} kcal)`;
    return `
      <div class="giornata-scheda${attiva ? " attiva" : ""}">
        <button type="button" class="scheda-apri" data-indice="${i}" role="tab"
                aria-selected="${attiva}" title="${escapeHtml(titolo)}">
          <span class="scheda-nome">${escapeHtml(g.nome)}</span>
          <span class="scheda-kcal">${kcal}</span>
        </button>
        ${multipla ? `<button type="button" class="scheda-chiudi" data-chiudi="${i}" title="Chiudi ${escapeHtml(g.nome)}" aria-label="Chiudi ${escapeHtml(g.nome)}">✕</button>` : ""}
      </div>`;
  }).join("");

  const pieno = state.giornate.length >= MAX_GIORNATE;
  giornataNuovaBtn.disabled = pieno;
  giornataNuovaBtn.title = pieno
    ? `Massimo ${MAX_GIORNATE} giornate: chiudine una per aggiungerne un'altra`
    : "Aggiungi una giornata";

  if (schedaInRinomina !== null) {
    const campo = el("scheda-nome-input");
    if (campo) { campo.focus(); campo.select(); }
  }

  // Con 7 schede su telefono la striscia scorre: quella aperta va portata in
  // vista, altrimenti si cambia giornata "alla cieca".
  const attivaEl = giornateSchede.querySelector(".giornata-scheda.attiva");
  if (attivaEl && giornateSchede.scrollWidth > giornateSchede.clientWidth) {
    attivaEl.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
}

function renderGiornata() {
  renderDiete();
  renderRipartizione();
  renderSchede();
  aggiornaMenuAzioni();
  const t = totaliGiornata();

  if (giornataVuota()) {
    giornataContenuto.innerHTML = '<p class="vuoto">Nessun alimento inserito: comincia dal riquadro qui sopra.</p>';
    totaliGiorno.innerHTML = "";
  } else {
    giornataContenuto.innerHTML = PASTI
      .filter(p => pastiCorrenti()[p].length > 0)
      .map(p => pastoHtml(p, t.kcal))
      .join("");
    totaliGiorno.innerHTML = totaliHtml(t);
  }
  renderBarraTotale(t);
}

// Ricalcola i numeri già a video SENZA ricostruire l'elenco: mentre si corregge
// il peso di una riga il campo deve restare dov'è, con il cursore dentro (un
// render completo lo distruggerebbe a ogni cifra digitata).
function aggiornaCalcoliUI() {
  const t = totaliGiornata();

  giornataContenuto.querySelectorAll(".pasto").forEach(blocco => {
    const pasto = blocco.dataset.pasto;
    const voci = pastiCorrenti()[pasto] || [];
    const tp = totaliVoci(voci);
    const quota = t.kcal > 0 ? Math.round((tp.kcal / t.kcal) * 100) : 0;
    blocco.querySelector(".pasto-kcal").innerHTML =
      `${arrotonda(tp.kcal)} kcal <span class="pasto-quota">(${quota}%)</span>${scartoPastoHtml(pasto, tp.kcal)}`;
    blocco.querySelector(".pasto-macro").textContent =
      `${round1(tp.proteine)} g proteine · ${round1(tp.grassi)} g grassi · ${round1(tp.carboidrati)} g carboidrati`;
  });

  giornataContenuto.querySelectorAll(".riga-alimento").forEach(riga => {
    const voce = vocePer(riga.dataset.pasto, Number(riga.dataset.indice));
    if (!voce) return;
    const v = calcolaVoce(voce.per100, voce.grammi);
    const quantita = quantitaVoce(voce);
    riga.querySelector(".riga-dettaglio").innerHTML = dettaglioRigaHtml(voce);
    riga.querySelector(".riga-kcal").textContent = `${v.kcal} kcal`;
    // Anche il singolare/plurale: scrivendo 2 dove c'era 1, "cucchiaio" deve
    // diventare "cucchiai" subito, non alla conferma.
    riga.querySelector(".riga-unita").textContent = etichettaMisura(quantita.unita, quantita.valore);
  });

  // Il totale sulla scheda aperta segue la correzione in corso, senza
  // ricostruire la barra delle schede (il campo perderebbe il fuoco).
  const schedaAttiva = giornateSchede.querySelector(".giornata-scheda.attiva .scheda-kcal");
  if (schedaAttiva) schedaAttiva.textContent = arrotonda(t.kcal);

  totaliGiorno.innerHTML = totaliHtml(t);
  renderBarraTotale(t);
}

function vocePer(pasto, indice) {
  return (pastiCorrenti()[pasto] && pastiCorrenti()[pasto][indice]) || null;
}

// Scrive la quantità di una voce a partire dal numero digitato nella riga, che
// è nell'unità mostrata: in millilitri il peso si ricava dalla densità, ed è il
// peso a finire nei conti. Torna false se il numero non è utilizzabile.
function scriviQuantitaVoce(voce, valore) {
  if (!(valore > 0)) return false;
  const unita = voce.unita;
  const grammi = unita && unita !== "g"
    ? grammiDaMisura(valore, unita, voce.densita, voce.gCucchiaio)
    : null;
  // Il pavimento a 1 g vale per tutte le unità, non solo per le misure
  // casalinghe: scrivendo "0,4" in un campo grammi l'arrotondamento dava zero e
  // restava in dieta una riga "0 g / 0 kcal", che è quanto il riquadro di
  // inserimento impedisce da sempre con il suo controllo sull'anteprima.
  const pesati = Math.max(1, Math.round(grammi !== null ? grammi : valore));
  // Oltre il tetto non si scrive niente e la riga resta com'era: chi lo chiama
  // controlla il valore di ritorno.
  if (pesati > MAX_GRAMMI_VOCE) return false;
  if (grammi !== null) voce.quantita = round1(valore);
  voce.grammi = pesati;
  return true;
}

function rimuoviVoce(pasto, indice) {
  const voce = vocePer(pasto, indice);
  if (!voce) return;
  registraAnnulla(conNomeGiornata(`rimozione di ${voce.nome} da ${pasto}`));
  pastiCorrenti()[pasto].splice(indice, 1);
  salvaStato();
  renderGiornata();
}

function svuotaPasto(pasto) {
  const voci = pastiCorrenti()[pasto];
  if (!voci || !voci.length) return;
  if (!confirm(`Svuotare "${pasto}"?`)) return;
  registraAnnulla(conNomeGiornata(`svuotamento di ${pasto}`));
  pastiCorrenti()[pasto] = [];
  salvaStato();
  renderGiornata();
}

function svuotaGiornata() {
  if (giornataVuota()) return;
  if (!confirm(`Svuotare "${giornataCorrente().nome}"? Puoi comunque tornare indietro con «Annulla».`)) return;
  registraAnnulla(`svuotamento di ${giornataCorrente().nome}`);
  giornataCorrente().pasti = creaPastiVuoti();
  salvaStato();
  renderGiornata();
}

// ---------- Schede delle giornate ----------

function cambiaGiornata(indice) {
  if (indice < 0 || indice >= state.giornate.length || indice === state.attiva) return;
  state.attiva = indice;
  chiudiRinominaScheda();
  salvaStato();
  renderGiornata();
}

function nuovaGiornata() {
  if (state.giornate.length >= MAX_GIORNATE) return;
  const nome = nomeGiornataLibero();
  registraAnnulla(`creazione di ${nome}`);
  state.giornate.push(creaGiornata(nome));
  state.attiva = state.giornate.length - 1;
  salvaStato();
  renderGiornata();
  mostraToast(`${nome}: pronta`);
}

function chiudiGiornata(indice) {
  const giornata = state.giornate[indice];
  if (!giornata || state.giornate.length <= 1) return;
  if (!pastiVuoti(giornata.pasti) &&
      !confirm(`Chiudere "${giornata.nome}"? Contiene degli alimenti. Puoi comunque tornare indietro con «Annulla».`)) {
    return;
  }
  registraAnnulla(`chiusura di ${giornata.nome}`);
  state.giornate.splice(indice, 1);
  // Restando sulla stessa posizione si finisce sulla scheda che ha preso il
  // posto di quella chiusa; se era l'ultima si arretra di una.
  if (state.attiva > indice || state.attiva >= state.giornate.length) {
    state.attiva = Math.max(0, state.attiva - 1);
  }
  salvaStato();
  renderGiornata();
}

// ---------- Sostituzioni equivalenti ----------
// Trova alimenti che, alla giusta quantità, danno le STESSE calorie di quello
// già inserito. Le calorie sono il vincolo da rispettare (l'obiettivo della
// giornata è calorico), le proteine il criterio per ordinare: fra due
// alternative da 200 kcal, quella con proteine simili cambia meno il piano.

const MAX_SOSTITUZIONI = 15;
// Oltre mezzo chilo la sostituzione è teorica: nessuno mangia 800 g di zucchine
// per pareggiare una fetta di formaggio.
const MAX_GRAMMI_SOSTITUTO = 500;

// I gruppi alimentari raccolgono le categorie di foods.json che, per una
// sostituzione, valgono la stessa cosa. Le categorie da sole sono troppo
// strette: carni, pesci, uova e legumi stanno in quattro elenchi diversi,
// quindi al posto del pollo arrivava solo altra carne — tacchino, gallina —
// mentre chi scrive una dieta vuole vedere anche il merluzzo e il tofu.
//
// Nel gruppo proteico stanno anche formaggi e salumi. A parità di calorie
// portano molti più grassi e sale di un petto di pollo, e la tentazione è
// tenerli fuori; ma è una valutazione che spetta a chi scrive la dieta, non a
// un elenco deciso qui dentro, e toglierli vuol dire non poterli nemmeno
// vedere. Restano dentro e ogni riga espone il suo scarto di grassi, che è
// l'informazione con cui la scelta si fa davvero.
//
// Una categoria che non compare qui (oggi «Miscellanea», domani una nuova)
// resta gruppo di se stessa: si continua a pescare dentro la categoria, come
// prima, invece di finire in un gruppo che non le appartiene.
const GRUPPI_ALIMENTARI = [
  ["Carni di tutti I tipi, frattaglie", "Pesci, crostacei, molluschi", "Uova",
   "Legumi e prodotti della soia", "Formaggi", "Insaccati e salumi"],
  ["Cereali, farine, pasta, crakers", "Tuberi, patate, fecola"],
  ["Brioches, merendine, biscotti", "Dolci, ciocc, zucchero, marmellate"]
];

const gruppoDiCategoria = new Map();
GRUPPI_ALIMENTARI.forEach((categorie, i) => {
  categorie.forEach(c => gruppoDiCategoria.set(c, i));
});

// Due alimenti sono intercambiabili quando stanno nello stesso gruppo; per le
// categorie fuori dai gruppi il confronto resta fra categorie.
function stessoGruppo(categoriaA, categoriaB) {
  if (!categoriaA || !categoriaB) return false;
  const a = gruppoDiCategoria.get(categoriaA);
  const b = gruppoDiCategoria.get(categoriaB);
  return a === undefined || b === undefined ? categoriaA === categoriaB : a === b;
}

// Le categorie dalle quali si sta pescando, per dirlo quando non si trova
// niente: «fra carni, pesci, uova e legumi» spiega la ricerca fatta, mentre il
// nome di un gruppo inventato qui dentro non vorrebbe dire nulla.
function categorieCompatibili(categoria) {
  const gruppo = gruppoDiCategoria.get(categoria);
  return gruppo === undefined ? [categoria] : GRUPPI_ALIMENTARI[gruppo];
}

// Le quantità che si scrivono davvero su una dieta. Il conto esatto dà «138 g
// di pollo»: un numero che nessuno pesa e che promette al paziente una
// precisione che il calcolo non ha, visto che parte da valori medi di tabella.
// Sotto i 20 si resta al passo di uno: su un condimento da 10 g saltare a 12
// sposterebbe le calorie del 20%, e "13 ml di olio" si scrive su una dieta
// quanto "140 g di pollo". Il numero tondo serve dove il numero era assurdo.
// Si prende il numero più vicino di questa scala e le calorie mostrate sono poi
// quelle della quantità arrotondata, non quelle di partenza: il conto torna su
// ciò che la persona mangerà, non su ciò che sarebbe servito.
const PORZIONI = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
  25, 30, 35, 40, 45, 50,
  60, 70, 75, 80, 90, 100, 110, 120, 125, 130, 140, 150, 160, 175, 180, 190, 200,
  220, 250, 280, 300, 320, 350, 400, 450, 500
];

// Quanto può scostarsi dalle calorie di partenza la porzione arrotondata.
// Serve perché l'arrotondamento non è indolore: una misura casalinga non
// scende sotto il mezzo cucchiaio, e al posto di una tazza di brodo da 7 kcal
// veniva proposto mezzo cucchiaio di maionese, 46 kcal. Un'alternativa che
// stravolge il pasto non è un'alternativa, e il numero piccolo accanto
// ("+39") non basta a renderla innocua.
const SCARTO_KCAL_MAX = 0.08;   // 8% delle calorie da pareggiare...
const SCARTO_KCAL_MIN = 2;      // ...ma mai meno di 2 kcal, sulle voci minime.

function porzioneVicina(valore) {
  if (!(valore > 0)) return null;
  return PORZIONI.reduce((migliore, p) =>
    Math.abs(p - valore) < Math.abs(migliore - valore) ? p : migliore, PORZIONI[0]);
}

// Le misure casalinghe hanno già la loro grana, scritta in MISURE: mezzo
// cucchiaio è una quantità che si sa fare, 0,7 cucchiai no.
function quantitaUsabile(valore, unita) {
  if (unita === "g" || unita === "ml") return porzioneVicina(valore);
  const passo = (MISURE[unita] || MISURE.g).passo;
  return Math.max(passo, Math.round(valore / passo) * passo);
}

let sostituzioneInCorso = null;

function candidatiSostituzione(chiaveOriginale, kcalDaPareggiare, per100Originale, per100Voce) {
  const categoria = categoriaDi.get(chiaveOriginale) || null;
  const candidati = [];
  // «Bevande alcoliche, analcoliche» è una categoria sola, quindi senza questo
  // al posto di un succo di frutta arrivava del whisky: stesse calorie, stessi
  // (zero) macronutrienti, scarto perfetto su ogni riga del confronto. Un
  // alcolico si propone solo al posto di un altro alcolico, dove il cambio è
  // quello che si sta davvero cercando — il vino al posto della birra.
  const partiamoDaUnAlcolico = eAlcolico(per100Voce);

  foodMap.forEach((per100, chiave) => {
    if (chiave === chiaveOriginale) return;
    if (!partiamoDaUnAlcolico && eAlcolico(per100)) return;
    // Senza categoria (alimenti personalizzati, o voce non riconosciuta) si
    // cerca fra tutti: meglio qualche proposta in più che nessuna.
    if (categoria && !stessoGruppo(categoria, categoriaDi.get(chiave))) return;
    if (!(per100.kcal > 0)) return;

    const grammiEsatti = (kcalDaPareggiare * 100) / per100.kcal;
    if (grammiEsatti < 1 || grammiEsatti > MAX_GRAMMI_SOSTITUTO) return;

    // Un candidato liquido si propone in millilitri: sono l'unità con cui lo si
    // misurerà davvero.
    const densitaCand = densitaDi.get(chiave) || null;
    const cucchiaioCand = cucchiaioDi.get(chiave) || null;
    const misuraCand = misuraProposta(grammiEsatti, densitaCand, cucchiaioCand);

    // Si arrotonda NELL'UNITÀ con cui l'alimento verrà misurato, non in grammi:
    // arrotondare i grammi e convertirli dopo riporterebbe a galla i «1,4
    // cucchiai» che la scala delle porzioni serve proprio a togliere.
    const valoreEsatto = misuraCand === "g"
      ? grammiEsatti
      : misuraDaGrammi(grammiEsatti, misuraCand, densitaCand, cucchiaioCand);
    const valore = quantitaUsabile(valoreEsatto, misuraCand);
    if (!(valore > 0)) return;
    const grammi = misuraCand === "g"
      ? valore
      : Math.max(1, Math.round(grammiDaMisura(valore, misuraCand, densitaCand, cucchiaioCand)));
    if (grammi > MAX_GRAMMI_SOSTITUTO) return;

    // I valori sono quelli della quantità arrotondata: è la porzione vera, ed è
    // su quella che vanno letti lo scarto di calorie e quelli dei macro.
    const v = calcolaVoce(per100, grammi);
    const scarto = v.kcal - kcalDaPareggiare;
    if (Math.abs(scarto) > Math.max(SCARTO_KCAL_MIN, kcalDaPareggiare * SCARTO_KCAL_MAX)) return;
    candidati.push({
      chiave, grammi, valore, unita: misuraCand,
      quantita: `${fmtNumero(valore)} ${etichettaMisura(misuraCand, valore)}`,
      categoria: categoriaDi.get(chiave) || "",
      valori: v,
      dKcal: Math.round(scarto),
      dProt: round1(v.proteine - per100Originale.proteine),
      dFat: round1(v.grassi - per100Originale.grassi),
      dCarb: round1(v.carboidrati - per100Originale.carboidrati)
    });
  });

  return selezioneVaria(candidati.sort(piuVicino));
}

// Fra due alternative con le stesse calorie, quella con proteine simili cambia
// meno il piano; a parità di proteine decidono i carboidrati.
function piuVicino(a, b) {
  return (Math.abs(a.dProt) - Math.abs(b.dProt)) || (Math.abs(a.dCarb) - Math.abs(b.dCarb));
}

// Quante ne porta al massimo una sola categoria: le righe disponibili divise
// per le categorie che hanno qualcosa da proporre. Un numero fisso non regge al
// variare del gruppo — con tre era giusto per le quattro categorie di allora, e
// diventato sei il gruppo proteico ne sarebbero servite diciotto per quindici
// righe, lasciando fuori del tutto le ultime categorie (i formaggi, per come
// sono ordinati nella tabella).
function quotaPerCategoria(quanteCategorie) {
  return Math.max(1, Math.floor(MAX_SOSTITUZIONI / quanteCategorie));
}

// Le prime quindici per vicinanza sarebbero quasi tutte carne e pesce: sono le
// categorie più numerose e le più somiglianti, e i legumi — l'alternativa
// vegetale che si cerca proprio quando si cambia un secondo — finirebbero
// sempre sotto il taglio, perché a parità di calorie portano carboidrati e
// quindi meno proteine. Allargare il gruppo senza questo passaggio non
// servirebbe a niente: l'elenco resterebbe quello di prima.
//
// Così ogni categoria del gruppo porta le sue migliori, i posti che restano
// vanno alle migliori in assoluto, e lo scarto scritto su ogni riga dice a che
// prezzo.
function selezioneVaria(ordinati) {
  const quota = quotaPerCategoria(new Set(ordinati.map(c => c.categoria)).size);
  const scelti = [];
  const quante = new Map();
  ordinati.forEach(c => {
    const n = quante.get(c.categoria) || 0;
    if (n >= quota || scelti.length >= MAX_SOSTITUZIONI) return;
    quante.set(c.categoria, n + 1);
    scelti.push(c);
  });
  ordinati.forEach(c => {
    if (scelti.length >= MAX_SOSTITUZIONI || scelti.includes(c)) return;
    scelti.push(c);
  });
  return scelti.sort(piuVicino);
}

// Numeri all'italiana anche qui: la riga di una proposta affiancava "152 kcal"
// alla virgola dei totali e al punto di "-0.4 P".
function segno(n) {
  return n > 0 ? `+${fmtNumero(n)}` : fmtNumero(n);
}

function apriSostituzione(pasto, indice) {
  const voce = vocePer(pasto, indice);
  if (!voce) return;
  const v = calcolaVoce(voce.per100, voce.grammi);
  // La chiave del database si ricava dal nome mostrato: le voci salvate
  // portano il nome già formattato, non la chiave originale.
  const chiave = risolviChiave(voce.nome);
  const candidati = candidatiSostituzione(chiave, v.kcal, v, voce.per100);

  sostituzioneInCorso = { pasto, indice };
  sostituisciTitolo.textContent = `Al posto di ${voce.nome} (${testoQuantitaVoce(voce)}, ${v.kcal} kcal)`;

  if (!candidati.length) {
    const categoria = categoriaDi.get(chiave);
    const dove = categoria
      ? ` fra ${categorieCompatibili(categoria).map(c => `«${escapeHtml(c)}»`).join(", ")}`
      : "";
    sostituisciElenco.innerHTML = `<p class="hint">Nessuna alternativa utile${dove}: servirebbero quantità troppo grandi per pareggiare le calorie.</p>`;
  } else {
    sostituisciElenco.innerHTML = candidati.map((c, i) => `
      <button type="button" class="sostituisci-riga" data-sost="${i}">
        <span class="sostituisci-nome">${escapeHtml(formattaNome(c.chiave))}</span>
        <span class="sostituisci-quantita">${c.quantita}</span>
        <span class="sostituisci-categoria">${escapeHtml(c.categoria)}</span>
        <span class="sostituisci-delta">${arrotonda(c.valori.kcal)} kcal${c.dKcal ? ` (${segno(c.dKcal)})` : ""} · ${segno(c.dProt)} P · ${segno(c.dFat)} G · ${segno(c.dCarb)} C</span>
      </button>`).join("");
    // Si porta appresso anche l'unità scelta: la quantità applicata dev'essere
    // quella letta nell'elenco, non una riconversione dai grammi che rimetterebbe
    // in pagina i decimali appena tolti.
    sostituisciElenco.dataset.candidati = JSON.stringify(
      candidati.map(c => ({ chiave: c.chiave, grammi: c.grammi, unita: c.unita, valore: c.valore })));
  }

  apriDialogo(sostituisciOverlay);
}

function chiudiSostituzione() {
  sostituzioneInCorso = null;
  chiudiDialogo(sostituisciOverlay);
  sostituisciElenco.dataset.candidati = "[]";
}

function applicaSostituzione(indiceCandidato) {
  if (!sostituzioneInCorso) return;
  const candidati = JSON.parse(sostituisciElenco.dataset.candidati || "[]");
  const scelto = candidati[indiceCandidato];
  const { pasto, indice } = sostituzioneInCorso;
  const voce = vocePer(pasto, indice);
  if (!scelto || !voce || !foodMap.has(scelto.chiave)) return;

  const nuovoNome = formattaNome(scelto.chiave);
  const notaPersa = voce.nota;
  registraAnnulla(conNomeGiornata(`sostituzione di ${voce.nome} con ${nuovoNome}`));
  voce.nome = nuovoNome;
  voce.grammi = scelto.grammi;
  voce.per100 = copiaPer100(foodMap.get(scelto.chiave));
  // L'unità segue il nuovo alimento: sostituendo un olio con del pane i
  // millilitri non vogliono più dire nulla, e viceversa un liquido va espresso
  // in millilitri anche se prima c'era un solido pesato.
  const densitaNuova = densitaDi.get(scelto.chiave) || null;
  const cucchiaioNuovo = cucchiaioDi.get(scelto.chiave) || null;
  delete voce.densita; delete voce.gCucchiaio; delete voce.unita;
  delete voce.quantita; delete voce.ml;
  // La voce ora viene da un altro alimento: il timbro di prima la legherebbe a
  // un personalizzato che non c'entra più, e una sua correzione la seguirebbe.
  delete voce.idAlimento;
  const idNuovo = idCustomDi.get(scelto.chiave);
  if (idNuovo) voce.idAlimento = idNuovo;
  if (densitaNuova) voce.densita = densitaNuova;
  if (cucchiaioNuovo) voce.gCucchiaio = cucchiaioNuovo;
  const misuraNuova = misureDisponibili(densitaNuova, cucchiaioNuovo).includes(scelto.unita)
    ? scelto.unita
    : misuraProposta(voce.grammi, densitaNuova, cucchiaioNuovo);
  if (misuraNuova !== "g") {
    voce.unita = misuraNuova;
    voce.quantita = misuraNuova === scelto.unita && scelto.valore > 0
      ? round1(scelto.valore)
      : round1(misuraDaGrammi(voce.grammi, misuraNuova, densitaNuova, cucchiaioNuovo));
  }
  // La nota descriveva l'alimento di prima ("cotta al dente" su una pasta):
  // portarla sul sostituto scriverebbe una sciocchezza, che finirebbe anche sul
  // foglio del paziente. Si toglie, e lo si dice.
  voce.nota = "";

  chiudiSostituzione();
  salvaStato();
  renderGiornata();
  mostraToast(notaPersa
    ? `Sostituito con ${nuovoNome}: la nota «${notaPersa}» è stata rimossa`
    : `Sostituito con ${nuovoNome}`);
}

// ---------- Copia di un pasto in altre giornate ----------
// Il pasto viene AGGIUNTO a quello di destinazione, non lo sostituisce: se la
// destinazione è vuota (il caso normale) l'effetto è una copia pulita, e se
// contiene già qualcosa non si distrugge lavoro fatto.

let pastoDaCopiare = null;

function apriCopiaPasto(pasto) {
  const voci = pastiCorrenti()[pasto];
  if (!voci || !voci.length || state.giornate.length < 2) return;
  pastoDaCopiare = pasto;

  const t = totaliVoci(voci);
  copiaPastoTitolo.textContent = `Copia «${pasto}» (${voci.length} ${voci.length === 1 ? "alimento" : "alimenti"}, ${arrotonda(t.kcal)} kcal) in…`;

  copiaPastoElenco.innerHTML = state.giornate.map((g, i) => {
    if (i === state.attiva) return "";
    const esistenti = g.pasti[pasto] || [];
    const stato = esistenti.length
      ? `${esistenti.length} ${esistenti.length === 1 ? "alimento" : "alimenti"} già presenti (${arrotonda(totaliVoci(esistenti).kcal)} kcal)`
      : "pasto vuoto";
    return `
      <label class="copia-pasto-riga">
        <input type="checkbox" value="${i}">
        <span class="copia-pasto-nome">${escapeHtml(g.nome)}</span>
        <span class="copia-pasto-stato">${stato}</span>
      </label>`;
  }).join("");

  copiaPastoErrore.classList.add("hidden");
  apriDialogo(copiaPastoOverlay);
}

function chiudiCopiaPasto() {
  pastoDaCopiare = null;
  chiudiDialogo(copiaPastoOverlay);
}

function confermaCopiaPasto() {
  if (!pastoDaCopiare) return;
  const scelte = Array.from(copiaPastoElenco.querySelectorAll("input:checked")).map(c => Number(c.value));
  if (!scelte.length) {
    copiaPastoErrore.classList.remove("hidden");
    return;
  }
  const voci = pastiCorrenti()[pastoDaCopiare] || [];
  const nomi = scelte.map(i => state.giornate[i].nome);
  registraAnnulla(`copia di ${pastoDaCopiare} in ${nomi.join(", ")}`);

  scelte.forEach(i => {
    // Copia profonda: le due giornate non devono condividere gli stessi
    // oggetti, altrimenti correggere un peso di qua lo cambierebbe di là.
    const copie = JSON.parse(JSON.stringify(voci));
    state.giornate[i].pasti[pastoDaCopiare].push(...copie);
  });

  const pasto = pastoDaCopiare;
  chiudiCopiaPasto();
  salvaStato();
  renderGiornata();
  mostraToast(`${pasto} copiato in ${nomi.length} ${nomi.length === 1 ? "giornata" : "giornate"}`);
}

// ---------- Spostamento e scambio di un pasto ----------
// Un pasto composto nella casella sbagliata — la colazione che doveva essere
// la merenda — non va rifatto: si porta dov'era destinato. La destinazione può
// stare nella stessa giornata o in un'altra, e con «Scambia» le due posizioni
// fanno il baratto: il pranzo del giorno 1 e quello del giorno 2 si invertono
// in un colpo solo.
//
// Qui le voci vengono SPOSTATE, non copiate come in apriCopiaPasto: gli stessi
// oggetti cambiano casella e nessuno resta in due posti, quindi non serve la
// copia profonda che là evitava di legare fra loro due giornate.

let pastoDaSpostare = null;
// Finché la destinazione non è stata scelta a mano, segue la giornata: dentro
// la stessa giornata propone un altro pasto, su un'altra giornata lo stesso
// pasto (il caso normale, il pranzo del giorno dopo). Dopo una scelta esplicita
// non la si tocca più, tranne quando resterebbe il pasto di partenza.
let spostaPastoScelto = false;

function apriSpostaPasto(pasto) {
  const voci = pastiCorrenti()[pasto];
  if (!voci || !voci.length) return;
  pastoDaSpostare = pasto;
  spostaPastoScelto = false;

  const t = totaliVoci(voci);
  // Da dove parte, non solo che cosa parte: con più schede il dialogo si apre
  // uguale da qualunque giornata, e chi sposta il pranzo del Giorno 3 deve
  // leggere nero su bianco che sta svuotando quello, non un altro.
  const da = state.giornate.length > 1
    ? `«${pasto}» di ${giornataCorrente().nome}`
    : `«${pasto}»`;
  spostaPastoTitolo.textContent = `Sposta o scambia ${da} (${voci.length} ${voci.length === 1 ? "alimento" : "alimenti"}, ${arrotonda(t.kcal)} kcal) in…`;

  spostaPastoGiornata.innerHTML = state.giornate.map((g, i) =>
    `<option value="${i}"${i === state.attiva ? " selected" : ""}>${escapeHtml(g.nome)}${i === state.attiva ? " (questa)" : ""}</option>`
  ).join("");
  // Con una giornata sola la scelta non esiste: resta il pasto di destinazione.
  spostaPastoCampoGiornata.classList.toggle("hidden", state.giornate.length < 2);

  spostaPastoPasto.innerHTML = PASTI.map(p => `<option value="${escapeHtml(p)}">${p}</option>`).join("");
  spostaPastoPasto.value = PASTI.find(p => p !== pasto);

  aggiornaSpostaPasto();
  apriDialogo(spostaPastoOverlay);
}

function chiudiSpostaPasto() {
  pastoDaSpostare = null;
  spostaPastoScelto = false;
  chiudiDialogo(spostaPastoOverlay);
}

function spostaPastoCambiaGiornata() {
  if (!pastoDaSpostare) return;
  const stessaGiornata = Number(spostaPastoGiornata.value) === state.attiva;
  if (!spostaPastoScelto) {
    spostaPastoPasto.value = stessaGiornata ? PASTI.find(p => p !== pastoDaSpostare) : pastoDaSpostare;
  } else if (stessaGiornata && spostaPastoPasto.value === pastoDaSpostare) {
    spostaPastoPasto.value = PASTI.find(p => p !== pastoDaSpostare);
  }
  aggiornaSpostaPasto();
}

// Dice per esteso che cosa succede ai due pasti, perché con la destinazione
// piena «Sposta» e «Scambia» danno risultati diversi e la differenza non si
// indovina dal nome del bottone.
function aggiornaSpostaPasto() {
  if (!pastoDaSpostare) return;
  const indice = Number(spostaPastoGiornata.value);
  const giornata = state.giornate[indice];
  const destinazione = spostaPastoPasto.value;
  if (!giornata || !PASTI.includes(destinazione)) return;

  const stessaCasella = indice === state.attiva && destinazione === pastoDaSpostare;
  const esistenti = giornata.pasti[destinazione] || [];
  const dove = indice === state.attiva ? destinazione : `${destinazione} di ${giornata.nome}`;

  spostaPastoScambiaBtn.disabled = stessaCasella;
  spostaPastoSpostaBtn.disabled = stessaCasella;

  if (stessaCasella) {
    spostaPastoEsito.textContent = "È il pasto di partenza: scegli un'altra destinazione.";
  } else if (!esistenti.length) {
    spostaPastoEsito.textContent = `${dove} è vuoto: «Sposta» e «Scambia» qui fanno la stessa cosa.`;
  } else {
    spostaPastoEsito.textContent = `${dove} ha già ${esistenti.length} ${esistenti.length === 1 ? "alimento" : "alimenti"} (${arrotonda(totaliVoci(esistenti).kcal)} kcal): «Scambia» li porta qui in ${pastoDaSpostare}, «Sposta» ve li lascia e vi aggiunge i tuoi.`;
  }
}

function eseguiSpostaPasto(modo) {
  if (!pastoDaSpostare) return;
  const indice = Number(spostaPastoGiornata.value);
  const giornata = state.giornate[indice];
  const destinazione = spostaPastoPasto.value;
  if (!giornata || !PASTI.includes(destinazione)) return;
  if (indice === state.attiva && destinazione === pastoDaSpostare) return;

  // Con la destinazione nella giornata aperta questi due sono lo stesso
  // oggetto: gli array vanno letti prima di riscriverli, o il secondo
  // assegnamento leggerebbe il risultato del primo.
  const partenza = pastiCorrenti();
  const voci = partenza[pastoDaSpostare] || [];
  const arrivo = giornata.pasti[destinazione] || [];
  if (!voci.length) return;

  const nome = pastoDaSpostare;
  const dove = indice === state.attiva ? destinazione : `${destinazione} di ${giornata.nome}`;
  registraAnnulla(conNomeGiornata(modo === "scambia"
    ? `scambio di ${nome} con ${dove}`
    : `spostamento di ${nome} in ${dove}`));

  if (modo === "scambia") {
    giornata.pasti[destinazione] = voci;
    partenza[nome] = arrivo;
  } else {
    giornata.pasti[destinazione] = arrivo.concat(voci);
    partenza[nome] = [];
  }

  chiudiSpostaPasto();
  salvaStato();
  renderGiornata();
  mostraToast(modo === "scambia" ? `${nome} scambiato con ${dove}` : `${nome} spostato in ${dove}`);
}

function rinominaGiornata(indice, nome) {
  const giornata = state.giornate[indice];
  const pulito = String(nome || "").trim().slice(0, 40);
  if (!giornata || !pulito || pulito === giornata.nome) return;
  registraAnnulla(`rinomina di ${giornata.nome}`);
  giornata.nome = pulito;
  salvaStato();
  renderGiornata();
}

// ---------- Copia negli appunti ----------

function testoPasto(pasto, pasti) {
  const voci = (pasti || pastiCorrenti())[pasto];
  if (!voci || !voci.length) return "";
  const t = totaliVoci(voci);
  const righe = voci.map(voce => {
    const nota = voce.nota ? ` (${voce.nota})` : "";
    return `- ${voce.nome}: ${testoQuantitaVoce(voce)}${nota}`;
  });
  const meta = obiettivoPasto(pasto);
  const kcalPasto = meta ? `${arrotonda(t.kcal)} / ${arrotonda(meta)} kcal` : `${arrotonda(t.kcal)} kcal`;
  return `${pasto.toUpperCase()} — ${kcalPasto}\n${righe.join("\n")}`;
}

// Riga dei macronutrienti, con l'obiettivo scritto come "93,3/109 g" per i
// macronutrienti che ne hanno uno.
// Le percentuali tra parentesi restano quelle della ripartizione energetica.
function rigaMacroTesto(t) {
  const macro = ripartizioneMacro(t);
  const conMeta = (valore, meta) => meta > 0
    ? `${round1(valore)}/${round1(meta)} g`
    : `${round1(valore)} g`;
  return `Proteine ${conMeta(t.proteine, state.obiettivoProteine)} (${macro.prot}%)` +
    ` · Grassi ${conMeta(t.grassi, state.obiettivoGrassi)} (${macro.fat}%)` +
    ` · Carboidrati ${conMeta(t.carboidrati, state.obiettivoCarboidrati)} (${macro.carb}%)`;
}

function testoDiGiornata(giornata, conNome) {
  const blocchi = PASTI.map(p => testoPasto(p, giornata.pasti)).filter(Boolean);
  if (!blocchi.length) return "";
  const t = totaliDi(giornata.pasti);
  const obiettivo = state.obiettivo > 0 ? ` (obiettivo ${arrotonda(state.obiettivo)} kcal)` : "";
  const intestazione = conNome ? `${giornata.nome.toUpperCase()}\n\n` : "";
  return intestazione + blocchi.join("\n\n") +
    `\n\nTOTALE GIORNATA: ${arrotonda(t.kcal)} kcal${obiettivo}` +
    `\n${rigaMacroTesto(t)}`;
}

// Con più diete aperte il testo incollato dice da quale arriva: incollato in
// una cartella clinica, "Giorno 1" da solo non direbbe di chi è.
function conIntestazioneDieta(testo) {
  if (!testo || archivio.diete.length <= 1) return testo;
  return `DIETA: ${state.nome.toUpperCase()}\n${"═".repeat(28)}\n\n${testo}`;
}

function testoGiornata() {
  // Con più schede aperte il testo incollato dice a quale giornata si riferisce.
  return conIntestazioneDieta(testoDiGiornata(giornataCorrente(), state.giornate.length > 1));
}

// Media dei valori sulle giornate che contengono qualcosa: le schede vuote
// abbasserebbero la media senza dire nulla di utile.
function mediaGiornate(giornate) {
  const piene = giornate.filter(g => !pastiVuoti(g.pasti));
  if (!piene.length) return null;
  const somma = piene.reduce((acc, g) => {
    const t = totaliDi(g.pasti);
    acc.kcal += t.kcal; acc.proteine += t.proteine; acc.grassi += t.grassi; acc.carboidrati += t.carboidrati;
    return acc;
  }, { kcal: 0, proteine: 0, grassi: 0, carboidrati: 0 });
  return {
    numero: piene.length,
    media: {
      kcal: somma.kcal / piene.length,
      proteine: somma.proteine / piene.length,
      grassi: somma.grassi / piene.length,
      carboidrati: somma.carboidrati / piene.length
    }
  };
}

function testoTutteLeGiornate() {
  const blocchi = state.giornate.map(g => testoDiGiornata(g, true)).filter(Boolean);
  if (!blocchi.length) return "";
  const riepilogo = mediaGiornate(state.giornate);
  let coda = "";
  if (riepilogo && riepilogo.numero > 1) {
    coda = `\n\n${"─".repeat(28)}\nRIEPILOGO — ${riepilogo.numero} giornate` +
      `\nMedia giornaliera: ${arrotonda(riepilogo.media.kcal)} kcal` +
      `\n${rigaMacroTesto(riepilogo.media)}`;
  }
  return conIntestazioneDieta(blocchi.join(`\n\n${"─".repeat(28)}\n\n`) + coda);
}

async function copiaTesto(testo, messaggio) {
  if (!testo) {
    mostraToast("Non c'è ancora nulla da copiare");
    return;
  }
  try {
    await navigator.clipboard.writeText(testo);
    mostraToast(messaggio);
  } catch (e) {
    // Fallback per browser/contesti in cui l'API Clipboard non è disponibile.
    const area = document.createElement("textarea");
    area.value = testo;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    let riuscito = false;
    try { riuscito = document.execCommand("copy"); } catch (err) { riuscito = false; }
    area.remove();
    mostraToast(riuscito ? messaggio : "Copia non riuscita: seleziona il testo a mano");
  }
}

// ---------- Menù «questa giornata / tutte» ----------

function chiudiMenuAzioni() {
  [copiaMenu, stampaMenu].forEach(m => m.classList.add("hidden"));
  [copiaMenuBtn, stampaMenuBtn].forEach(b => b.setAttribute("aria-expanded", "false"));
}

function apriMenuAzione(menu, bottone, tipo) {
  const giaAperto = !menu.classList.contains("hidden");
  chiudiMenuAzioni();
  if (giaAperto) return;

  const piene = state.giornate.filter(g => !pastiVuoti(g.pasti)).length;
  const multipla = state.giornate.length > 1;
  const verbo = tipo === "copia" ? "Copia" : "Stampa";
  const nome = escapeHtml(giornataCorrente().nome);

  const voci = [`<button type="button" role="menuitem" data-ambito="giornata">${verbo} «${nome}»</button>`];
  if (multipla) {
    voci.push(`<button type="button" role="menuitem" data-ambito="tutte">${verbo} tutte le giornate (${piene})</button>`);
  }
  // Il foglio per il paziente esiste solo in stampa: negli appunti si incolla
  // il testo di lavoro, con i numeri.
  if (tipo === "stampa") {
    voci.push(`<div class="menu-separatore" role="separator"></div>`);
    voci.push(`<button type="button" role="menuitem" data-ambito="giornata" data-paziente="1">Per il paziente — «${nome}»</button>`);
    if (multipla) {
      voci.push(`<button type="button" role="menuitem" data-ambito="tutte" data-paziente="1">Per il paziente — tutte (${piene})</button>`);
    }
  }

  menu.innerHTML = voci.join("");
  menu.classList.remove("hidden");
  bottone.setAttribute("aria-expanded", "true");
}

function aggiornaMenuAzioni() {
  // Con una giornata sola la copia non ha scelte da offrire e la freccetta
  // sparisce. La stampa invece resta: il foglio per il paziente si sceglie da
  // lì anche quando la giornata è una sola.
  const multipla = state.giornate.length > 1;
  copiaMenuBtn.classList.toggle("hidden", !multipla);
  if (!multipla) copiaMenu.classList.add("hidden");
}

function copiaGiornataAperta() {
  copiaTesto(testoGiornata(), "Giornata copiata negli appunti");
}

function stampa(ambito, perPaziente) {
  ambitoStampa = ambito;
  stampaPerPaziente = !!perPaziente;
  if (!costruisciAreaStampa()) {
    mostraToast(ambito === "tutte" ? "Non c'è ancora nulla da stampare" : "La giornata è vuota");
    return;
  }
  window.print();
}

// ---------- Stampa ----------

// Ricostruisce il foglio da stampare. Va richiamata anche da "beforeprint":
// in stampa il resto della pagina è nascosto, quindi se si usa Ctrl+P (o
// Condividi → Stampa su iPad) senza passare dal pulsante, senza questo si
// stamperebbe il contenuto vecchio o un foglio bianco.
function intestazioneStampa(titolo) {
  const obiettivi = [
    state.obiettivo > 0 ? `${arrotonda(state.obiettivo)} kcal` : "",
    state.obiettivoProteine > 0 ? `${round1(state.obiettivoProteine)} g di proteine` : "",
    state.obiettivoGrassi > 0 ? `${round1(state.obiettivoGrassi)} g di grassi` : "",
    state.obiettivoCarboidrati > 0 ? `${round1(state.obiettivoCarboidrati)} g di carboidrati` : ""
  ].filter(Boolean).join(", ");
  const obiettivo = obiettivi ? ` · Obiettivo: ${obiettivi}` : "";
  // Con più diete in archivio il foglio stampato deve dire di quale si tratta.
  const dieta = archivio.diete.length > 1 ? `Dieta: ${escapeHtml(state.nome)} · ` : "";
  return `
    <h1 class="stampa-titolo">${titolo}</h1>
    <p class="stampa-meta">${dieta}Calcolo rapido del ${new Date().toLocaleDateString("it-IT")}${obiettivo}</p>`;
}

// Intestazione del foglio per il paziente: niente obiettivi calorici, che sul
// suo foglio non hanno posto. Resta il nome della dieta, che serve a non
// confondere due piani, e la data.
function intestazionePaziente(titolo) {
  const dieta = archivio.diete.length > 1 ? `${escapeHtml(state.nome)} · ` : "";
  return `
    <h1 class="stampa-titolo">${titolo}</h1>
    <p class="stampa-meta">${dieta}${new Date().toLocaleDateString("it-IT")}</p>`;
}

// Foglio per il paziente: che cosa mangiare e quanto, e basta. Niente calorie,
// niente macronutrienti, niente obiettivi — sono numeri che servono a chi
// scrive la dieta e che sul foglio di chi la segue creano solo ansia o
// discussioni. Restano le note, perché dicono come preparare il piatto.
function bloccoPazienteGiornata(giornata, conNome) {
  const pasti = PASTI.filter(p => giornata.pasti[p].length > 0).map(pasto => {
    const righe = giornata.pasti[pasto].map(voce => {
      const v = calcolaVoce(voce.per100, voce.grammi);
      const nota = voce.nota ? ` <em>(${escapeHtml(voce.nota)})</em>` : "";
      return `<tr>
        <td>${escapeHtml(voce.nome)}${nota}</td>
        <td class="num">${testoQuantitaVoce(voce)}</td>
      </tr>`;
    }).join("");
    return `
      <div class="stampa-pasto">
        <h3><span>${pasto}</span></h3>
        <table class="stampa-tabella stampa-tabella-paziente">
          <tbody>${righe}</tbody>
        </table>
      </div>`;
  }).join("");

  return `
    <div class="stampa-giornata">
      ${conNome ? `<h2 class="stampa-giornata-titolo">${escapeHtml(giornata.nome)}</h2>` : ""}
      ${pasti}
    </div>`;
}

// Blocco stampabile di una giornata: i pasti con i loro alimenti e il totale.
function bloccoStampaGiornata(giornata, conNome) {
  const t = totaliDi(giornata.pasti);
  const macro = ripartizioneMacro(t);

  const pasti = PASTI.filter(p => giornata.pasti[p].length > 0).map(pasto => {
    const voci = giornata.pasti[pasto];
    const tp = totaliVoci(voci);
    const righe = voci.map(voce => {
      const v = calcolaVoce(voce.per100, voce.grammi);
      return `<tr>
        <td>${escapeHtml(voce.nome)}${voce.nota ? ` <em>(${escapeHtml(voce.nota)})</em>` : ""}</td>
        <td class="num">${testoQuantitaVoce(voce)}</td>
        <td class="num">${v.kcal}</td>
        <td class="num">${v.proteine}</td>
        <td class="num">${v.grassi}</td>
        <td class="num">${v.carboidrati}</td>
      </tr>`;
    }).join("");
    // Con la ripartizione attiva il foglio di lavoro riporta anche l'obiettivo
    // del pasto: era impostato a schermo ma sulla carta non compariva, e chi lo
    // legge non aveva con cosa confrontare le calorie.
    const meta = obiettivoPasto(pasto);
    const kcalPasto = meta
      ? `${arrotonda(tp.kcal)} / ${arrotonda(meta)} kcal`
      : `${arrotonda(tp.kcal)} kcal`;
    return `
      <div class="stampa-pasto">
        <h3><span>${pasto}</span><span>${kcalPasto}</span></h3>
        <table class="stampa-tabella">
          <thead><tr><th>Alimento</th><th class="num">Quantità</th><th class="num">kcal</th><th class="num">Prot.</th><th class="num">Grassi</th><th class="num">Carb.</th></tr></thead>
          <tbody>${righe}</tbody>
        </table>
      </div>`;
  }).join("");

  return `
    <div class="stampa-giornata">
      ${conNome ? `<h2 class="stampa-giornata-titolo">${escapeHtml(giornata.nome)}</h2>` : ""}
      ${pasti}
      <div class="stampa-totali">
        Totale giornata: ${arrotonda(t.kcal)} kcal
        <div class="dettaglio">Proteine ${round1(t.proteine)} g (${macro.prot}%) · Grassi ${round1(t.grassi)} g (${macro.fat}%) · Carboidrati ${round1(t.carboidrati)} g (${macro.carb}%)</div>
      </div>
    </div>`;
}

// Ambito dell'ultima stampa richiesta: serve anche a "beforeprint", così
// ristampando con Ctrl+P si riottiene quello che si era scelto.
let ambitoStampa = "giornata";
// Foglio per il paziente invece di quello di lavoro. È una variabile a parte e
// non un terzo ambito, così le due scelte (quali giornate, e per chi) restano
// indipendenti.
let stampaPerPaziente = false;

function costruisciAreaStampa() {
  const tutte = ambitoStampa === "tutte";
  const giornate = tutte ? state.giornate.filter(g => !pastiVuoti(g.pasti)) : [giornataCorrente()];

  if (!giornate.length || (!tutte && giornataVuota())) {
    areaStampa.innerHTML = intestazioneStampa("Giornata alimentare") + "<p>Nessun alimento inserito.</p>";
    return false;
  }

  const conNome = tutte || state.giornate.length > 1;
  const titolo = tutte
    ? `Piano alimentare — ${giornate.length} giornate`
    : `Giornata alimentare${conNome ? " — " + escapeHtml(giornataCorrente().nome) : ""}`;

  if (stampaPerPaziente) {
    // Come per il foglio di lavoro qui sotto: il nome della giornata va nei
    // blocchi solo quando se ne stampa più di una. Stampandone una sola il
    // titolo lo porta già ("Giornata alimentare — Giorno 2"), e ripeterlo nel
    // blocco lo scriveva due volte di fila sul foglio che va al paziente.
    areaStampa.innerHTML = intestazionePaziente(titolo) +
      giornate.map(g => bloccoPazienteGiornata(g, tutte)).join("");
    return true;
  }

  let riepilogo = "";
  if (tutte) {
    const r = mediaGiornate(giornate);
    if (r && r.numero > 1) {
      const macro = ripartizioneMacro(r.media);
      riepilogo = `
        <div class="stampa-riepilogo">
          Media giornaliera su ${r.numero} giornate: ${arrotonda(r.media.kcal)} kcal
          <div class="dettaglio">Proteine ${round1(r.media.proteine)} g (${macro.prot}%) · Grassi ${round1(r.media.grassi)} g (${macro.fat}%) · Carboidrati ${round1(r.media.carboidrati)} g (${macro.carb}%)</div>
        </div>`;
    }
  }

  areaStampa.innerHTML = intestazioneStampa(titolo) +
    giornate.map(g => bloccoStampaGiornata(g, tutte)).join("") +
    riepilogo;
  return true;
}

// ---------- Fabbisogno calorico ----------

function leggiProfiloDaiCampi() {
  state.profilo.eta = etaInput.value;
  state.profilo.peso = pesoInput.value;
  state.profilo.altezza = altezzaInput.value;
  state.profilo.attivita = attivitaSelect.value;
  state.profilo.correzione = correzioneInput.value;
  state.profilo.gPerKg = gkgInput.value;
  state.profilo.percGrassi = percGrassiInput.value;
}

// Grammi di proteine per kg usati nel calcolo: quelli digitati, altrimenti il
// valore suggerito per il livello di attività scelto.
function gPerKgEffettivo(p) {
  const digitato = parseFloat(String(p.gPerKg).replace(",", "."));
  if (digitato > 0) return digitato;
  return G_PER_KG_SUGGERITO[attivitaValida(p.attivita)];
}

// Quota di calorie dai grassi usata nel calcolo: quella digitata (tenuta dentro
// un intervallo ragionevole, perché un 5% o un 90% battuti per errore darebbero
// una ripartizione senza senso), altrimenti quella suggerita.
function percGrassiEffettiva(p) {
  const digitata = parseFloat(String(p.percGrassi).replace(",", "."));
  if (!(digitata > 0)) return PERC_GRASSI_SUGGERITA;
  return Math.min(PERC_GRASSI_MAX, Math.max(PERC_GRASSI_MIN, digitata));
}

function calcolaFabbisogno(p) {
  const eta = Number(p.eta);
  const peso = Number(p.peso);
  const altezza = Number(p.altezza);
  const mancanti = [];
  const fuoriScala = [];
  if (!p.sesso) mancanti.push("sesso");
  // Un campo vuoto e un campo sbagliato sono due cose diverse e vanno dette in
  // due modi diversi. Prima bastava `!eta`: uno zero veniva preso per un campo
  // da riempire, ma -50 era truthy e passava, e il foglio mostrava un
  // metabolismo basale negativo prima che qualcosa lo fermasse più a valle.
  Object.keys(LIMITI_PROFILO).forEach(campo => {
    const limite = LIMITI_PROFILO[campo];
    const valore = Number(p[campo]);
    if (String(p[campo] == null ? "" : p[campo]).trim() === "" || !isFinite(valore)) {
      mancanti.push(limite.nome);
    } else if (valore < limite.min || valore > limite.max) {
      fuoriScala.push(`${limite.nome} fra ${limite.min} e ${limite.max} ${limite.unita}`);
    }
  });
  if (mancanti.length || fuoriScala.length) return { mancanti, fuoriScala };

  // Mifflin-St Jeor: BMR = 10·peso + 6,25·altezza − 5·età + c
  const costante = p.sesso === "M" ? 5 : -161;
  const bmr = Math.round(10 * peso + 6.25 * altezza - 5 * eta + costante);
  const fattore = FATTORI_ATTIVITA[attivitaValida(p.attivita)];
  const tdee = Math.round(bmr * fattore);
  const correzione = Math.round(Number(p.correzione) || 0);
  const obiettivo = Math.max(0, tdee + correzione);

  // Proteine: grammi per kg di peso corporeo. Ne riportiamo anche la quota
  // sull'obiettivo calorico (4 kcal per grammo), utile per capire subito se la
  // ripartizione richiesta è sostenibile.
  const gPerKg = gPerKgEffettivo(p);
  const proteine = Math.round(peso * gPerKg);

  // Grassi: quota delle calorie totali, convertita in grammi a 9 kcal/g.
  const percGrassi = percGrassiEffettiva(p);
  const grassi = Math.round((obiettivo * percGrassi / 100) / KCAL_PER_G.grassi);

  // Carboidrati: quello che avanza. Con proteine molto alte e un obiettivo
  // calorico basso l'avanzo può essere negativo — succede quando le due quote
  // richieste da sole superano le calorie disponibili. In quel caso i grammi
  // vanno a zero e chi calcola viene avvisato, invece di leggere un numero
  // negativo o una ripartizione che non torna.
  const kcalResidue = obiettivo - proteine * KCAL_PER_G.proteine - grassi * KCAL_PER_G.grassi;
  const carboidrati = Math.max(0, Math.round(kcalResidue / KCAL_PER_G.carboidrati));
  const ripartizioneImpossibile = kcalResidue < 0;

  // Le quote sono ricalcolate sui grammi arrotondati (non sulle percentuali di
  // partenza), così i tre numeri mostrati corrispondono davvero ai grammi
  // proposti e la loro somma sfiora il 100%.
  const quota = (grammi, kcalG) => obiettivo > 0 ? Math.round(((grammi * kcalG) / obiettivo) * 100) : 0;

  return {
    bmr, fattore, tdee, correzione, obiettivo, peso,
    gPerKg, proteine, quotaProteine: quota(proteine, KCAL_PER_G.proteine),
    percGrassi, grassi, quotaGrassi: quota(grassi, KCAL_PER_G.grassi),
    carboidrati, quotaCarboidrati: quota(carboidrati, KCAL_PER_G.carboidrati),
    ripartizioneImpossibile
  };
}

// Nota sotto il campo g/kg: chiarisce quale valore si sta usando quando il
// campo è lasciato vuoto, e ricorda gli intervalli di riferimento.
function renderNotaGkg() {
  const suggerito = G_PER_KG_SUGGERITO[attivitaValida(state.profilo.attivita)];
  gkgInput.placeholder = String(suggerito).replace(".", ",");
  const digitato = parseFloat(String(state.profilo.gPerKg).replace(",", "."));
  const testoBase = "Riferimenti: 0,8–1 g/kg adulto sedentario · 1,2–1,6 attivo · 1,6–2,2 sportivo.";
  gkgNota.textContent = digitato > 0
    ? testoBase
    : `Vuoto: usiamo ${String(suggerito).replace(".", ",")} g/kg, il valore tipico per il livello di attività scelto. ${testoBase}`;
}

// Nota sotto il campo della quota di grassi: come quella del g/kg, dice quale
// valore si sta usando e segnala se quello digitato è stato riportato dentro
// l'intervallo ammesso.
function renderNotaPercGrassi() {
  const digitata = parseFloat(String(state.profilo.percGrassi).replace(",", "."));
  const usata = percGrassiEffettiva(state.profilo);
  const testoBase = `Riferimento LARN: 20–35% delle calorie. I carboidrati sono la parte che resta.`;
  if (!(digitata > 0)) {
    percGrassiNota.textContent = `Vuoto: usiamo ${PERC_GRASSI_SUGGERITA}%. ${testoBase}`;
  } else if (digitata !== usata) {
    percGrassiNota.textContent = `Valore riportato a ${usata}%: sono ammesse quote fra ${PERC_GRASSI_MIN}% e ${PERC_GRASSI_MAX}%. ${testoBase}`;
  } else {
    percGrassiNota.textContent = testoBase;
  }
}

function renderFabbisogno() {
  renderNotaGkg();
  renderNotaPercGrassi();
  const r = calcolaFabbisogno(state.profilo);
  if (r.mancanti) {
    // Il campo vuoto è una riga di servizio, il valore fuori scala un errore da
    // correggere: il secondo prende lo stile dell'avviso, come la ripartizione
    // impossibile più in basso.
    const righe = [];
    if (r.mancanti.length) {
      righe.push(`<div class="passaggio">Per la stima servono ancora: ${r.mancanti.join(", ")}.</div>`);
    }
    if (r.fuoriScala.length) {
      righe.push(`<div class="fabbisogno-avviso">Valori fuori scala: serve ${r.fuoriScala.join(" · ")}.</div>`);
    }
    fabbisognoEsito.innerHTML = righe.join("");
    return;
  }
  const fattoreTxt = String(r.fattore).replace(".", ",");
  const gkgTxt = String(round1(r.gPerKg)).replace(".", ",");
  const correzioneTxt = r.correzione
    ? ` ${r.correzione > 0 ? "+" : "−"} ${Math.abs(r.correzione)} kcal di correzione`
    : "";
  const avviso = r.ripartizioneImpossibile
    ? `<div class="fabbisogno-avviso">Proteine e grassi richiesti superano da soli le calorie disponibili: i carboidrati restano a 0. Abbassa i g/kg di proteine o la quota di grassi.</div>`
    : "";
  fabbisognoEsito.innerHTML = `
    <div class="passaggio">Metabolismo basale ${r.bmr.toLocaleString("it-IT")} kcal × ${fattoreTxt} (attività)${correzioneTxt}</div>
    <div class="risultato">${r.obiettivo.toLocaleString("it-IT")} kcal al giorno</div>
    <div class="passaggio">Proteine: ${fmtPeso(r.peso)} kg × ${gkgTxt} g/kg · Grassi: ${r.percGrassi}% delle calorie ÷ 9 kcal/g · Carboidrati: le calorie che restano ÷ 4 kcal/g</div>
    <div class="risultato risultato-macro"><i class="punto p-prot"></i>${r.proteine.toLocaleString("it-IT")} g di proteine <span class="risultato-quota">(${r.quotaProteine}% delle calorie)</span></div>
    <div class="risultato risultato-macro"><i class="punto p-fat"></i>${r.grassi.toLocaleString("it-IT")} g di grassi <span class="risultato-quota">(${r.quotaGrassi}% delle calorie)</span></div>
    <div class="risultato risultato-macro"><i class="punto p-carb"></i>${r.carboidrati.toLocaleString("it-IT")} g di carboidrati <span class="risultato-quota">(${r.quotaCarboidrati}% delle calorie)</span></div>
    ${avviso}
    <button type="button" id="usa-fabbisogno-btn">Usa questi obiettivi</button>
  `;
  el("usa-fabbisogno-btn").addEventListener("click", () => {
    // Un obiettivo a 0 (correzione più grande del fabbisogno) vale "nessun
    // obiettivo": scriverlo nel campo mostrerebbe uno "0" che poi non produce
    // né barra né residuo, e sparirebbe comunque alla ricarica. Vale anche per
    // i carboidrati azzerati da una ripartizione impossibile.
    state.obiettivo = r.obiettivo > 0 ? r.obiettivo : null;
    state.obiettivoProteine = r.proteine > 0 ? r.proteine : null;
    state.obiettivoGrassi = r.grassi > 0 ? r.grassi : null;
    state.obiettivoCarboidrati = r.carboidrati > 0 ? r.carboidrati : null;
    obiettivoInput.value = state.obiettivo || "";
    obiettivoProtInput.value = state.obiettivoProteine || "";
    obiettivoFatInput.value = state.obiettivoGrassi || "";
    obiettivoCarbInput.value = state.obiettivoCarboidrati || "";
    salvaStato();
    renderGiornata();
    mostraToast(state.obiettivo ? "Obiettivi impostati" : "Fabbisogno azzerato dalla correzione: nessun obiettivo impostato");
  });
}

// Peso all'italiana, senza decimali inutili: 68 kg, non "68,0 kg".
function fmtPeso(n) {
  return round1(n).toLocaleString("it-IT");
}

// ---------- Installazione come app ----------
// La pagina è installabile come PWA (manifest.json). Chrome/Edge/Android
// avvisano quando è installabile e permettono di aprire l'invito dal codice;
// su iPhone/iPad quell'invito non esiste e l'unica strada è Condividi →
// «Aggiungi a Home», quindi il pulsante mostra le istruzioni.

let promptInstallazione = null;

function appGiaInstallata() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function eApple() {
  const ua = navigator.userAgent;
  // Gli iPad recenti si presentano come Mac: si riconoscono dal touch.
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function testoIstruzioniInstallazione() {
  if (eApple()) {
    return "Su iPhone e iPad si aggiunge dal browser: tocca <strong>Condividi</strong> " +
      "(il quadrato con la freccia in su) e scegli <strong>Aggiungi a Home</strong>. " +
      "Se non vedi la voce, scorri l'elenco verso il basso.";
  }
  return "Nel browser apri il <strong>menù</strong> (i tre puntini in alto a destra) e scegli " +
    "<strong>Installa applicazione</strong> o <strong>Aggiungi a schermata Home</strong>. " +
    "Su computer puoi anche usare l'icona di installazione che compare nella barra degli indirizzi.";
}

function apriIstruzioniInstallazione() {
  installaIstruzioni.innerHTML = testoIstruzioniInstallazione();
  apriDialogo(installaOverlay);
}

function chiudiIstruzioniInstallazione() {
  chiudiDialogo(installaOverlay);
}

async function avviaInstallazione() {
  if (!promptInstallazione) {
    apriIstruzioniInstallazione();
    return;
  }
  promptInstallazione.prompt();
  const scelta = await promptInstallazione.userChoice;
  // L'invito è usa e getta: se viene rifiutato il browser ne manderà un altro
  // più avanti, e fino ad allora resta la strada manuale.
  promptInstallazione = null;
  if (scelta && scelta.outcome === "accepted") installaBtn.classList.add("hidden");
}

function inizializzaInstallazione() {
  if (appGiaInstallata()) return; // già in uso come app: il pulsante non serve
  installaBtn.classList.remove("hidden");
  installaBtn.addEventListener("click", avviaInstallazione);
  installaChiudiBtn.addEventListener("click", chiudiIstruzioniInstallazione);
  installaOverlay.addEventListener("click", (e) => {
    if (e.target === installaOverlay) chiudiIstruzioniInstallazione();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") chiudiIstruzioniInstallazione();
  });

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    promptInstallazione = e;
  });
  window.addEventListener("appinstalled", () => {
    promptInstallazione = null;
    installaBtn.classList.add("hidden");
    mostraToast("Installata: la trovi tra le tue app");
  });
}

// ---------- Funzionamento offline ----------
// Il service worker (sw.js) mette in cache la pagina, il foglio di stile, lo
// script e la tabella degli alimenti: dopo la prima apertura l'applicazione
// funziona anche senza rete.

// L'avviso di versione nuova è quello che sw.js dà per scontato nel commento in
// testa, e che finora non esisteva: la strategia è network-first, ma vale al
// momento del caricamento. Una scheda rimasta aperta — ed è il caso normale,
// una dieta si scrive in mezza giornata — continua a eseguire il codice di
// prima finché qualcuno non ricarica, senza un modo per saperlo.
//
// Non si ricarica da soli: sotto le mani di chi sta scrivendo una dieta, una
// pagina che si ricarica per conto suo è un piccolo disastro. Si offre e basta.
function mostraAvvisoAggiornamento() {
  if (!avvisoAggiornamento) return;
  avvisoAggiornamento.classList.remove("hidden");
}

function registraServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  if (aggiornaBtn) {
    aggiornaBtn.addEventListener("click", () => window.location.reload());
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").then(registrazione => {
      // Un worker già in attesa: la versione nuova è arrivata in un caricamento
      // precedente e sta lì da allora.
      if (registrazione.waiting && navigator.serviceWorker.controller) {
        mostraAvvisoAggiornamento();
      }
      registrazione.addEventListener("updatefound", () => {
        const nuovo = registrazione.installing;
        if (!nuovo) return;
        nuovo.addEventListener("statechange", () => {
          // `controller` distingue l'aggiornamento dalla prima installazione:
          // senza, l'avviso comparirebbe a chi apre l'app per la prima volta.
          if (nuovo.state === "installed" && navigator.serviceWorker.controller) {
            mostraAvvisoAggiornamento();
          }
        });
      });
    }).catch(errore => {
      console.warn("Registrazione service worker non riuscita:", errore);
    });
  });
}

// ---------- Avvio ----------

function collegaEventi() {
  // Obiettivo
  obiettivoInput.addEventListener("input", () => {
    const v = parseFloat(obiettivoInput.value);
    state.obiettivo = v > 0 ? v : null;
    salvaStato();
    renderGiornata();
  });

  obiettivoProtInput.addEventListener("input", () => {
    const v = parseFloat(obiettivoProtInput.value);
    state.obiettivoProteine = v > 0 ? v : null;
    salvaStato();
    renderGiornata();
  });

  obiettivoFatInput.addEventListener("input", () => {
    const v = parseFloat(obiettivoFatInput.value);
    state.obiettivoGrassi = v > 0 ? v : null;
    salvaStato();
    renderGiornata();
  });

  obiettivoCarbInput.addEventListener("input", () => {
    const v = parseFloat(obiettivoCarbInput.value);
    state.obiettivoCarboidrati = v > 0 ? v : null;
    salvaStato();
    renderGiornata();
  });

  // Ripartizione per pasto
  ripartizioneToggle.addEventListener("click", () => {
    const aperto = !ripartizioneBox.classList.contains("hidden");
    ripartizioneBox.classList.toggle("hidden", aperto);
    // Aprendola la prima volta la si accende con i valori tipici: un pannello
    // di caselle vuote non direbbe da dove cominciare.
    if (!aperto && !state.ripartizione) attivaRipartizione();
    else renderRipartizione();
  });

  ripartizioneTipicaBtn.addEventListener("click", () => {
    attivaRipartizione();
    mostraToast("Ripartizione riportata ai valori tipici");
  });

  ripartizioneSpegniBtn.addEventListener("click", spegniRipartizione);

  // Delega: i campi vengono ricreati a ogni render.
  ripartizioneCampi.addEventListener("input", (e) => {
    const campo = e.target.closest("[data-pasto-perc]");
    if (!campo || !state.ripartizione) return;
    const pasto = campo.dataset.pastoPerc;
    const v = Number(campo.value);
    state.ripartizione[pasto] = v >= 0 && v <= 100 ? v : 0;
    salvaStato();
    // Solo i numeri: ridisegnare i campi mentre si scrive perderebbe il fuoco.
    aggiornaEtichetteRipartizione();
    aggiornaCalcoliUI();
  });

  fabbisognoToggle.addEventListener("click", () => {
    const aperto = !fabbisognoBox.classList.contains("hidden");
    fabbisognoBox.classList.toggle("hidden", aperto);
    fabbisognoToggle.textContent = aperto ? "🧮 Calcolalo" : "Chiudi";
    if (!aperto) renderFabbisogno();
  });

  Array.from(sessoGruppo.children).forEach(btn => {
    btn.addEventListener("click", () => {
      state.profilo.sesso = btn.dataset.sesso;
      Array.from(sessoGruppo.children).forEach(b => b.classList.toggle("attivo", b === btn));
      salvaStato();
      renderFabbisogno();
    });
  });

  [etaInput, pesoInput, altezzaInput, attivitaSelect, correzioneInput, gkgInput, percGrassiInput].forEach(campo => {
    campo.addEventListener("input", () => {
      leggiProfiloDaiCampi();
      salvaStato();
      renderFabbisogno();
    });
  });

  // Ricerca alimento
  foodInput.addEventListener("input", () => {
    aggiornaSuggerimenti();
    selezionaAlimento(risolviChiave(foodInput.value));
  });

  foodInput.addEventListener("keydown", (e) => {
    const items = suggestions.querySelectorAll(".suggestion-item");
    if (e.key === "ArrowDown" && items.length) {
      e.preventDefault();
      indiceSuggerimento = Math.min(indiceSuggerimento + 1, items.length - 1);
      evidenziaSuggerimento();
    } else if (e.key === "ArrowUp" && items.length) {
      e.preventDefault();
      indiceSuggerimento = Math.max(indiceSuggerimento - 1, 0);
      evidenziaSuggerimento();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (indiceSuggerimento >= 0) scegliSuggerimento(indiceSuggerimento);
      else if (items.length === 1) scegliSuggerimento(0);
      else if (alimentoSelezionato) {
        nascondiSuggerimenti();
        quantitaInput.focus();
      }
    } else if (e.key === "Escape") {
      nascondiSuggerimenti();
    }
  });

  suggestions.addEventListener("click", (e) => {
    // La matita sta dentro la riga: va intercettata prima, o il clic
    // selezionerebbe l'alimento invece di aprirne la correzione.
    const correggi = e.target.closest("[data-modifica-alimento]");
    if (correggi) {
      apriModificaAlimento(correggi.dataset.modificaAlimento);
      return;
    }
    const item = e.target.closest(".suggestion-item");
    if (item) scegliSuggerimento(Number(item.dataset.index));
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".autocomplete-wrapper")) nascondiSuggerimenti();
  });

  // Alimenti personalizzati
  nuovoAlimentoBtn.addEventListener("click", apriFormNuovoAlimento);
  salvaAlimentoBtn.addEventListener("click", salvaNuovoAlimento);
  annullaAlimentoBtn.addEventListener("click", chiudiFormNuovoAlimento);
  alimentoEliminaBtn.addEventListener("click", eliminaAlimentoPersonalizzato);

  modificaAlimentoAvantiBtn.addEventListener("click", () => {
    if (!modificaAlimento) return;
    const nuovo = leggiModuloModifica(modificaAlimento.originale);
    if (nuovo) avviaModificaAlimento(modificaAlimento.originale, nuovo, chiudiModificaAlimento);
  });
  modificaAlimentoPropagaBtn.addEventListener("click", () => concludiModificaAlimento(true));
  modificaAlimentoSoloBtn.addEventListener("click", () => concludiModificaAlimento(false));
  modificaAlimentoAnnullaBtn.addEventListener("click", chiudiModificaAlimento);
  modificaAlimentoIndietroBtn.addEventListener("click", chiudiModificaAlimento);
  modificaAlimentoOverlay.addEventListener("click", (e) => {
    if (e.target === modificaAlimentoOverlay) chiudiModificaAlimento();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") chiudiModificaAlimento();
  });

  // Quantità e modalità di calcolo
  Array.from(modoGruppo.children).forEach(btn => {
    btn.addEventListener("click", () => impostaModo(btn.dataset.modo));
  });
  quantitaInput.addEventListener("input", aggiornaAnteprima);
  quantitaInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !aggiungiBtn.disabled) aggiungiAlPasto();
  });
  aggiungiBtn.addEventListener("click", aggiungiAlPasto);

  unitaSelect.addEventListener("change", () => impostaUnita(unitaSelect.value));

  // Diete
  dietaSelect.addEventListener("change", () => cambiaDieta(Number(dietaSelect.value)));
  dietaNuovaBtn.addEventListener("click", nuovaDieta);
  dietaEliminaBtn.addEventListener("click", eliminaDieta);
  dietaRinominaBtn.addEventListener("click", apriRinominaDieta);

  dietaNomeInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      dietaNomeInput.blur();
    } else if (e.key === "Escape") {
      // Escape esce senza rinominare, come per le schede delle giornate.
      e.stopPropagation();
      annullaRinominaDieta();
    }
  });
  dietaNomeInput.addEventListener("blur", () => {
    if (!dietaInRinomina) return;
    confermaRinominaDieta(dietaNomeInput.value);
  });

  // Rete di sicurezza: la rinomina si chiude col "blur" del campo, e se quel
  // blur non arrivasse (è successo nei test) resterebbe aperta per sempre, col
  // menù delle diete nascosto e nessun modo di cambiare dieta. Un clic fuori
  // dalla barra della dieta la chiude comunque. Nel caso normale il blur ha già
  // fatto il suo lavoro e qui non resta niente da fare.
  document.addEventListener("click", (e) => {
    if (!dietaInRinomina || e.target.closest(".card-dieta")) return;
    confermaRinominaDieta(dietaNomeInput.value);
  });

  dietaColoreBtn.addEventListener("click", () => {
    const aperto = !dietaColori.classList.contains("hidden");
    dietaColori.classList.toggle("hidden", aperto);
    dietaColoreBtn.setAttribute("aria-expanded", String(!aperto));
  });
  dietaColori.addEventListener("click", (e) => {
    const scelta = e.target.closest("[data-colore]");
    if (scelta) impostaColoreDieta(scelta.dataset.colore);
  });

  // Schede delle giornate
  giornataNuovaBtn.addEventListener("click", nuovaGiornata);

  giornateSchede.addEventListener("click", (e) => {
    const chiudi = e.target.closest(".scheda-chiudi");
    if (chiudi) {
      chiudiGiornata(Number(chiudi.dataset.chiudi));
      return;
    }
    const apri = e.target.closest(".scheda-apri");
    if (!apri) return;
    const indice = Number(apri.dataset.indice);
    // Clic sulla scheda già aperta: si passa alla rinomina, come per il nome
    // di un file. Sulle altre si cambia soltanto giornata.
    if (indice === state.attiva) {
      schedaInRinomina = indice;
      renderSchede();
    } else {
      cambiaGiornata(indice);
    }
  });

  giornateSchede.addEventListener("keydown", (e) => {
    const campo = e.target.closest(".scheda-nome-input");
    if (!campo) return;
    if (e.key === "Enter") {
      e.preventDefault();
      campo.blur();
    } else if (e.key === "Escape") {
      chiudiRinominaScheda();
      renderSchede();
    }
  });

  giornateSchede.addEventListener("focusout", (e) => {
    const campo = e.target.closest(".scheda-nome-input");
    if (!campo || schedaInRinomina === null) return;
    const indice = schedaInRinomina;
    const nome = campo.value;
    chiudiRinominaScheda();
    rinominaGiornata(indice, nome);
    renderSchede();
  });

  // Giornata (delega: le righe vengono ricreate a ogni render)

  // Copia della giornata prima che si cominci a correggere un peso: servirà
  // per l'annulla, ma solo se il valore cambia davvero (vedi handler "change").
  giornataContenuto.addEventListener("focusin", (e) => {
    const campo = e.target.closest(".riga-grammi");
    if (!campo) return;
    const voce = vocePer(campo.dataset.pasto, Number(campo.dataset.indice));
    if (!voce) return;
    modificaPesoInCorso = {
      stato: clonaGiornate(),
      valore: campo.value,
      descrizione: conNomeGiornata(`peso di ${voce.nome} (${testoQuantitaVoce(voce)})`)
    };
  });

  // Mentre si digita: aggiorniamo solo i numeri a video. Il campo vuoto viene
  // ignorato, altrimenti cancellare "150" per riscrivere "200" farebbe sparire
  // la riga.
  //
  // NON si salva a ogni tasto. Correggendo 150 in 200 si passa per "2", e
  // salvarlo significherebbe lasciare 2 g nella dieta se in quel momento la
  // pagina viene chiusa o messa in secondo piano — senza nemmeno un passo di
  // «Annulla», che viene registrato solo alla conferma. Il valore in memoria
  // serve a mostrare i totali aggiornati; su disco ci va alla conferma, dove
  // c'è anche l'annullamento.
  giornataContenuto.addEventListener("input", (e) => {
    const campo = e.target.closest(".riga-grammi");
    if (!campo) return;
    const voce = vocePer(campo.dataset.pasto, Number(campo.dataset.indice));
    if (!voce) return;
    if (!scriviQuantitaVoce(voce, Number(campo.value) || 0)) return;
    aggiornaCalcoliUI();
  });

  // A conferma (uscita dal campo o Invio): 0 o campo vuoto tolgono la voce.
  giornataContenuto.addEventListener("change", (e) => {
    const campo = e.target.closest(".riga-grammi");
    if (!campo) return;
    const pasto = campo.dataset.pasto;
    const indice = Number(campo.dataset.indice);
    const voce = vocePer(pasto, indice);
    if (!voce) return;
    const testo = campo.value.trim();
    // Lo zero si riconosce sul numero digitato, qualunque sia l'unità.
    const valore = Number(testo);
    // Solo uno 0 scritto apposta toglie la voce. Campo lasciato vuoto, numero
    // negativo o testo incomprensibile (che nei campi numerici arriva qui come
    // stringa vuota) sono quasi sempre errori di battitura: si rimette il
    // valore di prima. Per togliere una voce c'è la ✕ su ogni riga.
    if (valore === 0 && testo !== "") {
      // La rimozione registra da sé il proprio passo di annullamento.
      modificaPesoInCorso = null;
      rimuoviVoce(pasto, indice);
      return;
    }
    // Numero inutilizzabile (vuoto, negativo) oppure oltre il tetto di una
    // voce: in tutti e due i casi la riga torna com'era. "Tornare com'era" va
    // fatto davvero: l'handler "input" ha già cambiato il peso in memoria per
    // tenere aggiornati i totali mentre si digitava, quindi ridisegnare e basta
    // lascerebbe a video l'ultima cifra battuta invece del peso di partenza.
    // Il rifiuto per eccesso va però detto, altrimenti il numero sparisce e
    // basta: sotto zero l'errore di battitura si vede da sé, a 9000 no.
    const troppoGrande = valore > 0 && !scriviQuantitaVoce(voce, valore);
    if (!(valore > 0) || troppoGrande) {
      const originale = modificaPesoInCorso ? Number(modificaPesoInCorso.valore) : NaN;
      if (originale > 0) scriviQuantitaVoce(voce, originale);
      modificaPesoInCorso = null;
      if (troppoGrande) mostraToast(`Quantità troppo grande: al massimo ${MAX_GRAMMI_VOCE} g per voce`);
      renderGiornata();
      return;
    }
    // Un solo passo di annullamento per correzione, non uno per cifra digitata.
    if (modificaPesoInCorso && modificaPesoInCorso.valore !== testo) {
      pilaAnnulla.push({ ...modificaPesoInCorso.stato, descrizione: modificaPesoInCorso.descrizione });
      if (pilaAnnulla.length > MAX_ANNULLA) pilaAnnulla.shift();
      aggiornaBottoneAnnulla();
    }
    // Il peso è già stato scritto qui sopra, nel controllo del tetto.
    modificaPesoInCorso = null;
    salvaStato();
    renderGiornata();
  });

  giornataContenuto.addEventListener("click", (e) => {
    const elimina = e.target.closest(".riga-elimina");
    if (elimina) {
      rimuoviVoce(elimina.dataset.pasto, Number(elimina.dataset.indice));
      return;
    }
    const sostituisci = e.target.closest("[data-sostituisci-pasto]");
    if (sostituisci) {
      apriSostituzione(sostituisci.dataset.sostituisciPasto, Number(sostituisci.dataset.indice));
      return;
    }
    const copia = e.target.closest("[data-copia-pasto]");
    if (copia) {
      copiaTesto(testoPasto(copia.dataset.copiaPasto), "Pasto copiato");
      return;
    }
    const porta = e.target.closest("[data-porta-pasto]");
    if (porta) {
      apriCopiaPasto(porta.dataset.portaPasto);
      return;
    }
    const sposta = e.target.closest("[data-sposta-pasto]");
    if (sposta) {
      apriSpostaPasto(sposta.dataset.spostaPasto);
      return;
    }
    const svuota = e.target.closest("[data-svuota-pasto]");
    if (svuota) svuotaPasto(svuota.dataset.svuotaPasto);
  });

  // Azioni sulla giornata: il clic diretto agisce sulla giornata aperta, la
  // freccetta lascia scegliere "tutte" (compare solo con più schede).
  copiaBtn.addEventListener("click", () => copiaGiornataAperta());
  stampaBtn.addEventListener("click", () => stampa("giornata", false));
  window.addEventListener("beforeprint", costruisciAreaStampa);

  copiaMenuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    apriMenuAzione(copiaMenu, copiaMenuBtn, "copia");
  });
  stampaMenuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    apriMenuAzione(stampaMenu, stampaMenuBtn, "stampa");
  });

  [copiaMenu, stampaMenu].forEach(menu => {
    menu.addEventListener("click", (e) => {
      const voce = e.target.closest("[data-ambito]");
      if (!voce) return;
      const tutte = voce.dataset.ambito === "tutte";
      chiudiMenuAzioni();
      if (menu === copiaMenu) {
        if (tutte) copiaTesto(testoTutteLeGiornate(), "Tutte le giornate copiate negli appunti");
        else copiaGiornataAperta();
      } else {
        stampa(tutte ? "tutte" : "giornata", voce.dataset.paziente === "1");
      }
    });
  });

  document.addEventListener("click", chiudiMenuAzioni);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") chiudiMenuAzioni();
  });

  // Copia di un pasto in altre giornate
  copiaPastoConfermaBtn.addEventListener("click", confermaCopiaPasto);
  copiaPastoAnnullaBtn.addEventListener("click", chiudiCopiaPasto);
  copiaPastoOverlay.addEventListener("click", (e) => {
    if (e.target === copiaPastoOverlay) chiudiCopiaPasto();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") chiudiCopiaPasto();
  });

  // Spostamento o scambio di un pasto
  spostaPastoGiornata.addEventListener("change", spostaPastoCambiaGiornata);
  spostaPastoPasto.addEventListener("change", () => {
    spostaPastoScelto = true;
    aggiornaSpostaPasto();
  });
  spostaPastoScambiaBtn.addEventListener("click", () => eseguiSpostaPasto("scambia"));
  spostaPastoSpostaBtn.addEventListener("click", () => eseguiSpostaPasto("sposta"));
  spostaPastoAnnullaBtn.addEventListener("click", chiudiSpostaPasto);
  spostaPastoOverlay.addEventListener("click", (e) => {
    if (e.target === spostaPastoOverlay) chiudiSpostaPasto();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") chiudiSpostaPasto();
  });

  // Il fuoco non deve scappare dal dialogo aperto verso la pagina dietro.
  document.addEventListener("keydown", trattieniFuoco);

  // Copia di sicurezza su file
  esportaBtn.addEventListener("click", esportaDati);
  importaBtn.addEventListener("click", () => importaFile.click());
  importaFile.addEventListener("change", async () => {
    await importaDati(importaFile.files && importaFile.files[0]);
    // Azzerato per poter ricaricare due volte di seguito lo stesso file.
    importaFile.value = "";
  });
  cancellaTuttoBtn.addEventListener("click", cancellaTutto);

  // Sostituzioni equivalenti
  sostituisciAnnullaBtn.addEventListener("click", chiudiSostituzione);
  sostituisciOverlay.addEventListener("click", (e) => {
    if (e.target === sostituisciOverlay) chiudiSostituzione();
  });
  sostituisciElenco.addEventListener("click", (e) => {
    const riga = e.target.closest("[data-sost]");
    if (riga) applicaSostituzione(Number(riga.dataset.sost));
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") chiudiSostituzione();
  });
  svuotaBtn.addEventListener("click", svuotaGiornata);
  annullaBtn.addEventListener("click", annullaUltima);

  // Ctrl+Z / Cmd+Z. Se il fuoco è in un campo dove si sta scrivendo, la
  // scorciatoia resta quella del browser (annulla la digitazione). Se il campo
  // è vuoto l'annulla nativo non ha nulla da fare e la usiamo noi: è il caso
  // normale, perché dopo ogni inserimento il fuoco torna sulla ricerca vuota.
  //
  // I campi di rinomina (nome della dieta, nome della giornata) sono esclusi
  // anche da vuoti: lì Ctrl+Z vuol dire "rimetti il testo che ho cancellato",
  // e annullare invece l'ultima modifica alla giornata toglierebbe alimenti
  // sotto gli occhi di chi sta guardando tutt'altro.
  document.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.key.toLowerCase() !== "z") return;
    const attivo = document.activeElement;
    const inRinomina = attivo && attivo.dataset && attivo.dataset.rinomina !== undefined;
    const staScrivendo = attivo && ["INPUT", "TEXTAREA"].includes(attivo.tagName) && attivo.value !== "";
    if (inRinomina || staScrivendo || !pilaAnnulla.length) return;
    e.preventDefault();
    annullaUltima();
  });
}

function ripristinaCampiProfilo() {
  const p = state.profilo;
  etaInput.value = p.eta || "";
  pesoInput.value = p.peso || "";
  altezzaInput.value = p.altezza || "";
  attivitaSelect.value = attivitaValida(p.attivita);
  correzioneInput.value = p.correzione || "";
  gkgInput.value = p.gPerKg || "";
  percGrassiInput.value = p.percGrassi || "";
  Array.from(sessoGruppo.children).forEach(b => b.classList.toggle("attivo", b.dataset.sesso === p.sesso));
  obiettivoInput.value = state.obiettivo || "";
  obiettivoProtInput.value = state.obiettivoProteine || "";
  obiettivoFatInput.value = state.obiettivoGrassi || "";
  obiettivoCarbInput.value = state.obiettivoCarboidrati || "";
}

async function inizializza() {
  inizializzaTema();
  caricaAlimentiCustom();
  caricaStato();
  applicaColoreDieta();
  ripristinaCampiProfilo();
  impostaModo("grammi");
  collegaEventi();
  inizializzaInstallazione();
  registraServiceWorker();
  renderGiornata();
  aggiornaBottoneAnnulla();
  renderFabbisogno();
  await caricaAlimenti();
}

inizializza();
