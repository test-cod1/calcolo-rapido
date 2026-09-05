// Service worker di "Calcolo rapido": rende l'applicazione installabile e
// utilizzabile senza rete.
//
// Strategia: network-first su tutti i file dell'app. Online si vede sempre la
// versione appena pubblicata; la copia in cache serve solo quando la rete non
// c'è. Per questo NON serve cambiare CACHE_VERSION a ogni pubblicazione: la
// versione va cambiata solo per svuotare le cache vecchie (per esempio se si
// rinomina un file), oppure per far comparire subito l'avviso di aggiornamento
// nelle schede già aperte.
//
// Vengono gestite solo le richieste GET di questa stessa origine: qui non ci
// sono chiamate di rete verso l'esterno né dati da proteggere, perché tutto
// quello che l'utente scrive resta nel localStorage del browser.

const CACHE_VERSION = "v1";
const SHELL_CACHE = `calcolo-rapido-${CACHE_VERSION}`;

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
    await Promise.all(
      nomi.filter(n => n !== SHELL_CACHE).map(n => caches.delete(n))
    );
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", evento => {
  const req = evento.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  evento.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE);
    try {
      const risposta = await fetch(req);
      // Solo le risposte valide finiscono in cache: una pagina di errore
      // salvata al posto dell'app la renderebbe inutilizzabile offline.
      if (risposta && risposta.ok && risposta.type === "basic") {
        cache.put(req, risposta.clone());
      }
      return risposta;
    } catch (e) {
      const salvata = await cache.match(req);
      if (salvata) return salvata;
      // Navigazione senza rete e senza copia esatta (per esempio un indirizzo
      // con parametri): si serve comunque la pagina dell'app.
      if (req.mode === "navigate") {
        const home = (await cache.match("index.html")) || (await cache.match("./"));
        if (home) return home;
      }
      throw e;
    }
  })());
});
