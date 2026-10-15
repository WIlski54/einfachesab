/* Werkzeugleiste links + ausklappbare Optionen (Farbe, Stärke, Form …). */
(function () {
  const GT = (window.GT = window.GT || {});
  const REIHENFOLGE = ["auswahl", "stift", "marker", "radierer", "text", "formel", "formen", "karten",
    "lineal", "kamera", "ab_antwort", "laser"];

  GT.leisteInit = (app) => {
    app.leiste.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.w) app.werkzeugWaehlen(b.dataset.w);
      if (b.dataset.cmd === "undo" || b.dataset.cmd === "redo") {
        app.emit("tafel:" + b.dataset.cmd).then((a) => { if (a.ok && a.leer) GT.toast("Nichts mehr " + (b.dataset.cmd === "undo" ? "rückgängig zu machen." : "zu wiederholen.")); });
      }
    });
    app.optionen.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      const o = app.opt[app.werkzeug];
      if (!o) return;
      const wert = b.dataset.wert;
      o[b.dataset.opt] = isNaN(Number(wert)) ? wert : Number(wert);
      GT.optionenZeigen(app, true);
      GT.leisteZeichnen(app, true);
    });
  };

  GT.leisteZeichnen = (app, sichtbar) => {
    app.leiste.hidden = !sichtbar;
    if (!sichtbar) return;
    const knoepfe = REIHENFOLGE.filter((w) => GT.werkzeuge[w] && app.hat(w)).map((w) => {
      const def = GT.werkzeuge[w];
      const aktiv = w === app.werkzeug || (def.art === "schalter" && def.aktiv && def.aktiv(app));
      let punkt = "";
      const o = app.opt[w];
      if (o && o.farbe !== undefined && w !== "formel") {
        const farbe = app.rechte.eigene_farbe != null && app.rolle !== "lehrer" ? app.rechte.eigene_farbe : o.farbe;
        punkt = `<i class="gt-punkt" style="background:${GT.farbe(farbe, app.buehne.theme)}"></i>`;
      }
      return `<button data-w="${w}" class="${aktiv ? "aktiv" : ""}" title="${def.titel}">${def.icon}${punkt}</button>`;
    });
    if (app.hat("radierer")) {
      knoepfe.push('<hr>', '<button data-cmd="undo" title="Rückgängig">↩️</button>', '<button data-cmd="redo" title="Wiederholen">↪️</button>');
    }
    app.leiste.innerHTML = knoepfe.join("");
  };

  GT.optionenZeigen = (app, zeigen) => {
    const def = GT.werkzeuge[app.werkzeug];
    const o = app.opt[app.werkzeug];
    if (!zeigen || !def || !def.optionen || !o) { app.optionen.hidden = true; return; }
    const theme = app.buehne.theme;
    const teile = [];
    const eigen = app.rolle !== "lehrer" && app.rechte.eigene_farbe != null;
    for (const opt of def.optionen) {
      if (opt === "farbe") {
        if (eigen) { teile.push(`<div class="gt-opt-zeile"><span class="gt-hinweis">Deine Farbe:</span><i class="gt-farbe" style="background:${GT.farbe(app.rechte.eigene_farbe, theme)}"></i></div>`); continue; }
        teile.push('<div class="gt-opt-zeile">' + [0, 1, 2, 3, 4, 5].map((i) =>
          `<button data-opt="farbe" data-wert="${i}" class="gt-farbe ${o.farbe === i ? "aktiv" : ""}" style="background:${GT.farbe(i, theme)}"></button>`).join("") + "</div>");
      } else if (opt === "staerke") {
        teile.push('<div class="gt-opt-zeile">' + [1, 2, 3].map((i) =>
          `<button data-opt="staerke" data-wert="${i}" class="gt-staerke ${o.staerke === i ? "aktiv" : ""}"><i style="width:${4 + i * 5}px;height:${4 + i * 5}px"></i></button>`).join("") + "</div>");
      } else if (opt === "art") {
        const arten = { linie: "╱", pfeil: "➚", rechteck: "▭", kreis: "◯" };
        teile.push('<div class="gt-opt-zeile">' + Object.entries(arten).map(([k, s]) =>
          `<button data-opt="art" data-wert="${k}" class="gt-art ${o.art === k ? "aktiv" : ""}" title="${k}">${s}</button>`).join("") + "</div>");
      } else if (opt === "kartenfarbe") {
        teile.push('<div class="gt-opt-zeile">' + Object.entries(GT.farben.karten).map(([k, f]) =>
          `<button data-opt="kartenfarbe" data-wert="${k}" class="gt-farbe eckig ${o.kartenfarbe === k ? "aktiv" : ""}" style="background:${f}"></button>`).join("") + "</div>");
      } else if (opt === "groesse") {
        teile.push('<div class="gt-opt-zeile">' + [[28, "S"], [40, "M"], [58, "L"]].map(([g, s]) =>
          `<button data-opt="groesse" data-wert="${g}" class="gt-art ${o.groesse === g ? "aktiv" : ""}">${s}</button>`).join("") + "</div>");
      }
    }
    app.optionen.innerHTML = teile.join("");
    const knopf = app.leiste.querySelector(`[data-w="${app.werkzeug}"]`);
    if (knopf) {
      const r = knopf.getBoundingClientRect(), basis = app.el.getBoundingClientRect();
      app.optionen.style.top = Math.max(8, r.top - basis.top - 4) + "px";
    }
    app.optionen.hidden = false;
  };
})();
