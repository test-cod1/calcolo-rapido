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

## File

| File | Ruolo |
| --- | --- |
| `index.html` | la pagina, unica |
| `style.css` | tutto il foglio di stile |
| `app.js` | tutta la logica |
| `tema-init.js` | applica il tema salvato prima del rendering (evita il flash chiaro) |
| `foods.json` | tabella degli alimenti, in sola lettura |
| `manifest.json` | dati per l'installazione come app |
| `sw.js` | service worker: cache network-first per l'uso offline |
| `_headers` | header di sicurezza per Cloudflare Pages |
| `icons/` | icone dell'app |

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
