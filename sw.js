// Service worker di "Calcolo rapido": rende l'applicazione installabile e
// utilizzabile senza rete.
//
// Strategia: network-first su tutti i file dell'app. Online si vede sempre la
// versione appena pubblicata; la copia in cache serve solo quando la rete non
// c'è (o quando la rete non risponde entro qualche secondo). Per questo NON
// serve cambiare CACHE_VERSION a ogni pubblicazione: la versione va cambiata
// solo per svuotare le cache vecchie, per esempio se si rinomina un file.
// L'avviso di versione nuova nelle schede già aperte non dipende più da qui:
// la pagina stessa controlla se i suoi file sono cambiati (app.js,
// controllaVersioneNuova).
//
// Vengono gestite solo le richieste GET di questa stessa origine: qui non ci
// sono chiamate di rete verso l'esterno né dati da proteggere, perché tutto
// quello che l'utente scrive resta nel localStorage del browser.

// Prefisso dei nomi delle nostre cache. Serve a riconoscerle: su GitHub Pages
// tutti i progetti dello stesso account stanno sullo stesso dominio, e lo
// spazio delle cache è per dominio, non per cartella. Senza questo prefisso la
// pulizia all'activate porterebbe via anche le cache degli altri siti.
const CACHE_PREFISSO = "calcolo-rapido-";
const CACHE_VERSION = "v3";
const SHELL_CACHE = `${CACHE_PREFISSO}${CACHE_VERSION}`;

// File indispensabili: precaricati all'installazione (addAll è atomico, se ne
// manca uno l'installazione fallisce e verrà ritentata).
const APP_SHELL = [
  "./",
  "index.html",
  "style.css",
  "app.js",
  "tema-init.js",
  "foods.json"
];

// File utili ma non vitali: se uno non è raggiungibile durante l'installazione
// non deve far fallire tutto il resto (verrà messo in cache al primo uso).
const APP_SHELL_OPZIONALE = [
  "manifest.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-180.png"
];

self.addEventListener("install", evento => {
  evento.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.addAll(APP_SHELL);
    await Promise.all(
      APP_SHELL_OPZIONALE.map(url => cache.add(url).catch(() => {}))
    );
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", evento => {
  evento.waitUntil((async () => {
    const nomi = await caches.keys();
    // Solo le NOSTRE cache vecchie: quelle che non cominciano col prefisso
    // appartengono ad altri siti dello stesso dominio e non vanno toccate.
    await Promise.all(
      nomi.filter(n => n.startsWith(CACHE_PREFISSO) && n !== SHELL_CACHE)
          .map(n => caches.delete(n))
    );
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", evento => {
  const req = evento.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // "no-cache": si chiede sempre al server se il file è cambiato. Senza, valeva
  // la cache HTTP del browser (GitHub Pages dà dieci minuti), e appena dopo una
  // pubblicazione si poteva ricevere l'index.html nuovo con l'app.js vecchio.
  let salvataggio = Promise.resolve();
  const rete = fetch(req, { cache: "no-cache" }).then(risposta => {
    // Solo le risposte valide finiscono in cache: una pagina di errore
    // salvata al posto dell'app la renderebbe inutilizzabile offline.
    if (risposta && risposta.ok && risposta.type === "basic") {
      // La copia si fa subito, prima che la pagina cominci a leggere il corpo.
      const copia = risposta.clone();
      salvataggio = caches.open(SHELL_CACHE).then(cache => cache.put(req, copia));
    }
    return risposta;
  });
  // Il worker resta vivo finché la copia non è scritta: prima la scrittura non
  // era attesa da nessuno, e il browser poteva fermarlo a metà.
  evento.waitUntil(rete.then(() => salvataggio).catch(() => {}));

  evento.respondWith((async () => {
    try {
      return await entro(rete, ATTESA_RETE_MS);
    } catch (e) {
      const salvata = await copiaInCache(req);
      if (salvata) return salvata;
      // Rete lenta e nessuna copia: non resta che aspettarla.
      if (e === TROPPO_LENTA) return rete;
      throw e;
    }
  })());
});

// Una rete che c'è ma non risponde (il wifi di un ospedale con la pagina di
// accesso, un segnale debole) teneva la pagina bianca fino al timeout del
// browser, che può durare decine di secondi: proprio quando la copia offline
// serviva. Oltre questa attesa si usa la copia, se c'è; la risposta della rete,
// quando arriva, aggiorna comunque la cache per la volta successiva.
const ATTESA_RETE_MS = 4000;
const TROPPO_LENTA = new Error("rete troppo lenta");

function entro(promessa, ms) {
  return new Promise((risolvi, rifiuta) => {
    const timer = setTimeout(() => rifiuta(TROPPO_LENTA), ms);
    promessa.then(
      v => { clearTimeout(timer); risolvi(v); },
      e => { clearTimeout(timer); rifiuta(e); }
    );
  });
}

async function copiaInCache(req) {
  const cache = await caches.open(SHELL_CACHE);
  const salvata = await cache.match(req);
  if (salvata) return salvata;
  // Navigazione senza copia esatta (per esempio un indirizzo con parametri):
  // si serve comunque la pagina dell'app.
  if (req.mode === "navigate") {
    return (await cache.match("index.html")) || (await cache.match("./")) || null;
  }
  return null;
}
