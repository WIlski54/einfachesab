/* Textfeld, Begriffskarten, Formeln. */
(function () {
  const GT = window.GT;
  const TEXT_TASTEN = ["₂", "₃", "₄", "⁺", "⁻", "²⁺", "³⁺", "²⁻", "→", "⇌", "↑", "↓", "Δ", "·", "°"];

  function einfuegen(feld, text) {
    const a = feld.selectionStart, b = feld.selectionEnd;
    feld.value = feld.value.slice(0, a) + text + feld.value.slice(b);
    feld.selectionStart = feld.selectionEnd = a + text.length;
    feld.focus();
    feld.dispatchEvent(new Event("input"));
  }

  function tastenLeiste(tasten, feld) {
    const div = document.createElement("div");
    div.className = "gt-tasten";
    tasten.forEach((t) => {
      const [anzeige, wert] = Array.isArray(t) ? t : [t, t];
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = anzeige;
      b.onmousedown = (e) => e.preventDefault();
      b.onclick = () => einfuegen(feld, wert);
      div.appendChild(b);
    });
    return div;
  }

  function farbeFuer(app, w) {
    return app.rolle !== "lehrer" && app.rechte.eigene_farbe != null ? app.rechte.eigene_farbe : app.opt[w].farbe;
  }

  // ---------- Textfeld ----------
  GT.textEditor = (app, obj, pos) => {
    app.status("text");
    const neu = !obj;
    const box = document.createElement("div");
    box.className = "gt-texteditor";
    const feld = document.createElement("textarea");
    feld.value = obj ? obj.text : "";
    feld.placeholder = "Text eingeben …";
    const theme = app.buehne.theme;
    const groesse = obj ? obj.groesse || 40 : app.opt.text.groesse;
    const skala = app.buehne.stage.scaleX();
    feld.style.fontSize = Math.max(14, groesse * skala) + "px";
    feld.style.color = GT.farbe(obj ? obj.farbe : farbeFuer(app, "text"), theme);
    feld.style.background = theme === "weiss" ? "rgba(255,255,255,0.95)" : "rgba(20,45,33,0.95)";
    const knoepfe = document.createElement("div");
    knoepfe.className = "gt-texteditor-knoepfe";
    knoepfe.innerHTML = '<button type="button" class="haupt">✓ Fertig</button><button type="button">✕</button>';
    box.append(tastenLeiste(TEXT_TASTEN, feld), feld, knoepfe);
    const ziel = obj ? { x: obj.x, y: obj.y } : pos;
    const bild = app.buehne.zuBildschirm(ziel);
    const f = app.flaeche.getBoundingClientRect(), b = app.el.getBoundingClientRect();
    box.style.left = Math.min(b.width - 380, Math.max(70, bild.x + f.left - b.left)) + "px";
    box.style.top = Math.min(b.height - 200, Math.max(10, bild.y + f.top - b.top - 44)) + "px";
    app.dialoge.appendChild(box);
    feld.focus(); // synchron, sonst öffnet iOS die Tastatur nicht
    const schliessen = () => { box.remove(); app.status(null); };
    knoepfe.lastChild.onclick = schliessen;
    knoepfe.firstChild.onclick = () => {
      const text = feld.value.trim();
      schliessen();
      if (neu && text) {
        app.sende({ op: "add", seite: app.z.aktuelle_seite, objekt: { id: GT.uid("t"), typ: "text", text,
          farbe: farbeFuer(app, "text"), groesse, x: Math.round(pos.x), y: Math.round(pos.y) } });
      } else if (!neu && text && text !== obj.text) {
        app.sende({ op: "update", seite: app.z.aktuelle_seite, id: obj.id, aenderungen: { text } });
      } else if (!neu && !text) {
        app.sende({ op: "delete", seite: app.z.aktuelle_seite, id: obj.id });
      }
    };
  };

  GT.registriere("text", {
    icon: "🔤", titel: "Textfeld (auf die Tafel tippen)", art: "zeiger", optionen: ["farbe", "groesse"],
    runter(app, p, ev, e) {
      if (!p || app.dialoge.querySelector(".gt-texteditor")) return;
      const g = app.buehne.gruppeVon(e.target);
      const obj = g && app.objekt(g.id());
      if (obj && obj.typ === "text" && app.darfInhalt(obj)) GT.textEditor(app, obj);
      else GT.textEditor(app, null, p);
    },
  });

  // ---------- Karten ----------
  GT.kartenDialog = (app, obj, pos) => {
    app.status("karte");
    const inhalt = document.createElement("div");
    const feld = document.createElement("textarea");
    feld.className = "gt-eingabe";
    feld.rows = 2;
    feld.value = obj ? obj.text : "";
    feld.placeholder = "Begriff, z. B. Säure";
    let farbe = obj ? obj.kartenfarbe : app.opt.karten.kartenfarbe;
    const farben = document.createElement("div");
    farben.className = "gt-opt-zeile";
    const zeichnen = () => {
      farben.innerHTML = Object.entries(GT.farben.karten).map(([k, f]) =>
        `<button type="button" data-k="${k}" class="gt-farbe eckig ${k === farbe ? "aktiv" : ""}" style="background:${f}"></button>`).join("");
    };
    farben.onclick = (e) => { if (e.target.dataset.k) { farbe = e.target.dataset.k; app.opt.karten.kartenfarbe = farbe; zeichnen(); } };
    zeichnen();
    inhalt.append(feld, farben);
    const d = app.dialog({
      titel: obj ? "Karte bearbeiten" : "Neue Karte", inhalt, beimSchliessen: () => app.status(null),
      knoepfe: [{ text: obj ? "Speichern" : "Auf die Tafel", haupt: true, aktion: (api) => {
        const text = feld.value.trim();
        if (!text) { feld.focus(); return; }
        api.schliessen();
        if (obj) app.sende({ op: "update", seite: app.z.aktuelle_seite, id: obj.id, aenderungen: { text, kartenfarbe: farbe } });
        else {
          const objekt = { id: GT.uid("k"), typ: "karte", text, kartenfarbe: farbe, breite: 240 };
          if (pos) app.sende({ op: "add", seite: app.z.aktuelle_seite, objekt: Object.assign(objekt, { x: Math.round(pos.x - 120), y: Math.round(pos.y - 30) }) });
          else app.einfuegenMitte(objekt, 240, 64);
        }
      } }],
    });
    feld.focus();
    return d;
  };

  GT.registriere("karten", {
    icon: "🟨", titel: "Begriffskarte (auf die Tafel tippen)", art: "zeiger", optionen: ["kartenfarbe"],
    runter(app, p) { if (p && !app.dialoge.children.length) GT.kartenDialog(app, null, p); },
  });

  // ---------- Formel ----------
  const CHEMIE_TASTEN = [["→", " -> "], ["⇌", " <=> "], ["↑", " ^ "], ["↓", " v "], ["⁺", "^+"], ["⁻", "^-"],
    ["²⁺", "^2+"], ["²⁻", "^2-"], ["(aq)", "(aq)"], ["(s)", "(s)"], ["(l)", "(l)"], ["(g)", "(g)"], ["e⁻", "e-"],
    ["Δ →", " ->[\\Delta] "], ["·", " * "]];
  const MATHE_TASTEN = [["a/b", "\\frac{}{}"], ["√", "\\sqrt{}"], ["x²", "^{}"], ["x₂", "_{}"], ["·", "\\cdot "],
    ["≈", "\\approx "], ["Δ", "\\Delta "], ["→", "\\rightarrow "], ["±", "\\pm "], ["°", "^\\circ "]];

  GT.formelDialog = (app, obj) => {
    app.status("formel");
    let modus = obj ? obj.modus : "chemie";
    let farbe = obj ? obj.farbe : farbeFuer(app, "formel");
    const inhalt = document.createElement("div");
    inhalt.innerHTML = `<div class="gt-reiter"><button type="button" data-m="chemie">Chemie</button><button type="button" data-m="mathe">Mathe / LaTeX</button></div>
      <input class="gt-eingabe gt-mono" autocomplete="off" autocapitalize="off" spellcheck="false">
      <div class="gt-vorschau"><span class="gt-leer">Vorschau</span></div>
      <div class="gt-fehler"></div><div class="gt-tasten-platz"></div><div class="gt-opt-zeile gt-formelfarben"></div>
      <div class="gt-hinweis gt-formelhilfe"></div>`;
    const feld = inhalt.querySelector("input");
    const vorschau = inhalt.querySelector(".gt-vorschau");
    const fehler = inhalt.querySelector(".gt-fehler");
    feld.value = obj ? obj.quelle : "";
    let aktuell = null;
    const d = app.dialog({
      titel: obj ? "Formel bearbeiten" : "Formel einfügen", inhalt, breit: true, beimSchliessen: () => app.status(null),
      knoepfe: [{ text: obj ? "Speichern" : "Auf die Tafel", name: "ok", haupt: true, aktion: async (api) => {
        if (!aktuell) return;
        api.schliessen();
        const quelle = feld.value.trim();
        if (obj) app.sende({ op: "update", seite: app.z.aktuelle_seite, id: obj.id, aenderungen: { quelle, modus, farbe } });
        else app.einfuegenMitte({ id: GT.uid("m"), typ: "formel", quelle, modus, farbe, groesse: 48 }, aktuell.breite, aktuell.hoehe);
      } }],
    });
    const ok = d.knopf("ok");
    const reiter = () => {
      inhalt.querySelectorAll("[data-m]").forEach((b) => b.classList.toggle("aktiv", b.dataset.m === modus));
      const platz = inhalt.querySelector(".gt-tasten-platz");
      platz.innerHTML = "";
      platz.appendChild(tastenLeiste(modus === "chemie" ? CHEMIE_TASTEN : MATHE_TASTEN, feld));
      feld.placeholder = modus === "chemie" ? "z. B. 2Na + Cl2 -> 2NaCl" : "z. B. c = \\frac{n}{V}";
      inhalt.querySelector(".gt-formelhilfe").innerHTML = modus === "chemie"
        ? "Einfach tippen: <code>H2O</code>, <code>SO4^2-</code>, <code>Na+</code>, Pfeil <code>-&gt;</code>, Gleichgewicht <code>&lt;=&gt;</code>"
        : "LaTeX: <code>\\frac{a}{b}</code>, <code>x^2</code>, <code>\\sqrt{x}</code>";
    };
    const farbenZeichnen = () => {
      const zeile = inhalt.querySelector(".gt-formelfarben");
      if (app.rolle !== "lehrer" && app.rechte.eigene_farbe != null) { zeile.innerHTML = ""; return; }
      zeile.innerHTML = [0, 1, 2, 3, 4, 5].map((i) => `<button type="button" data-f="${i}" class="gt-farbe ${i === farbe ? "aktiv" : ""}" style="background:${GT.farbe(i, app.buehne.theme)}"></button>`).join("");
    };
    inhalt.querySelector(".gt-formelfarben").onclick = (e) => {
      if (e.target.dataset.f !== undefined) { farbe = Number(e.target.dataset.f); app.opt.formel.farbe = farbe; farbenZeichnen(); aktualisieren(); }
    };
    inhalt.querySelector(".gt-reiter").onclick = (e) => {
      if (e.target.dataset.m) { modus = e.target.dataset.m; reiter(); aktualisieren(); }
    };
    let lauf = 0;
    const aktualisieren = async () => {
      const nr = ++lauf;
      const quelle = feld.value.trim();
      aktuell = null;
      ok.disabled = true;
      if (!quelle) { vorschau.innerHTML = '<span class="gt-leer">Vorschau</span>'; vorschau.classList.remove("fehlerhaft"); fehler.textContent = ""; return; }
      try {
        const b = await GT.formelBild(quelle, modus, GT.farbe(farbe, app.buehne.theme), 48);
        if (nr !== lauf) return;
        vorschau.innerHTML = `<img src="${b.url}" style="width:${Math.min(b.breite, 640)}px">`;
        vorschau.style.background = GT.farben.tafel[app.buehne.theme];
        vorschau.classList.remove("fehlerhaft");
        fehler.textContent = "";
        aktuell = b;
        ok.disabled = false;
      } catch (e) {
        if (nr !== lauf) return;
        vorschau.classList.add("fehlerhaft");
        fehler.textContent = "⚠ " + e.message;
      }
    };
    feld.addEventListener("input", aktualisieren);
    feld.addEventListener("keydown", (e) => { if (e.key === "Enter" && !ok.disabled) ok.click(); });
    reiter();
    farbenZeichnen();
    aktualisieren();
    feld.focus();
  };

  GT.registriere("formel", { icon: "🧪", titel: "Formel (Chemie oder Mathe)", art: "aktion", klick: (app) => GT.formelDialog(app) });
})();
