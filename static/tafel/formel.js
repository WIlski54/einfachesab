/* Formeln: MathJax (SVG) mit mhchem. Chemie-Modus = \ce{…}, Mathe-Modus = LaTeX. */
(function () {
  const GT = (window.GT = window.GT || {});

  // Konfiguration muss vor dem Laden von MathJax stehen (siehe _tafel.html).
  window.MathJax = {
    loader: { load: ["[tex]/mhchem"] },
    tex: {
      packages: { "[+]": ["mhchem"] },
      formatError: (jax, err) => { throw err; },
    },
    svg: { fontCache: "none" },
    startup: {
      typeset: false,
      // erst wenn MathJax wirklich bereit ist (nicht schon beim Laden der Datei)
      ready: () => { window.MathJax.startup.defaultReady(); window.MathJax.startup.promise.then(() => bereitMelden()); },
    },
  };
  let bereitMelden;
  const bereit = new Promise((ok) => { bereitMelden = ok; });

  const cache = new Map();

  /** MathJax erst beim ersten Formel-Bedarf laden (2 MB – die meisten Seitenaufrufe brauchen es nie). */
  let ladevorgang = null;
  GT.mathjaxLaden = () => ladevorgang || (ladevorgang = new Promise((ok, fehler) => {
    const s = document.createElement("script");
    s.src = GT.mathjaxUrl || "/static/vendor/mathjax-tex-svg-full.js";
    s.async = true;
    s.onerror = () => { ladevorgang = null; fehler(new Error("Formel-Bibliothek konnte nicht geladen werden.")); };
    document.head.appendChild(s);
    bereit.then(ok);
  }));

  function quelleTex(quelle, modus) {
    return modus === "mathe" ? quelle : "\\ce{" + quelle + "}";
  }

  /** Liefert {url, breite, hoehe} in Tafelpunkten oder wirft einen Fehler mit verständlicher Meldung. */
  GT.formelBild = async (quelle, modus, farbe, groesse) => {
    await GT.mathjaxLaden();
    const schluessel = [quelle, modus, farbe, groesse].join("|");
    if (cache.has(schluessel)) return cache.get(schluessel);
    if (!String(quelle).trim()) throw new Error("Die Formel ist leer.");
    let knoten;
    try {
      knoten = window.MathJax.tex2svg(quelleTex(quelle, modus), { display: true });
    } catch (e) {
      throw new Error("Tippfehler in der Formel: " + (e.message || e));
    }
    const svg = knoten.querySelector("svg");
    if (!svg || svg.querySelector("[data-mjx-error]") || knoten.querySelector("merror")) {
      throw new Error("Tippfehler in der Formel.");
    }
    const pxProEx = (groesse || 48) * 0.45;
    const exWert = (a) => parseFloat(String(svg.getAttribute(a) || "1").replace("ex", "")) || 1;
    const breite = Math.max(4, exWert("width") * pxProEx);
    const hoehe = Math.max(4, exWert("height") * pxProEx);
    svg.setAttribute("width", breite * 2);
    svg.setAttribute("height", hoehe * 2);
    svg.setAttribute("style", "color:" + farbe);
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    const text = new XMLSerializer().serializeToString(svg).replace(/currentColor/g, farbe);
    const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(text);
    const ergebnis = { url, breite, hoehe };
    cache.set(schluessel, ergebnis);
    return ergebnis;
  };

  GT.ladeBild = (url) => new Promise((ok, fehler) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => fehler(new Error("Bild konnte nicht geladen werden"));
    img.src = url;
  });
})();
