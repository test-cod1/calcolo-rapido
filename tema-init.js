// Applica il tema salvato (o quello di sistema) prima del rendering, così non
// c'è "flash" di tema chiaro all'avvio. È un file a parte, e non uno <script>
// inline, per poter applicare una Content-Security-Policy senza 'unsafe-inline'.
// La chiave deve restare uguale a TEMA_KEY in app.js.
(function () {
  try {
    var t = localStorage.getItem("calcolo-rapido-tema");
    if (t !== "chiaro" && t !== "notte") {
      t = (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "notte" : "chiaro";
    }
    if (t === "notte") document.documentElement.classList.add("tema-notte");
  } catch (e) {}
})();
