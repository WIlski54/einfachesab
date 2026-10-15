/* Auswählen, Verschieben, Skalieren, Drehen, Löschen, Bearbeiten (Doppeltippen). */
(function () {
  const GT = window.GT;
  const BEARBEITBAR = { text: "text", formel: "formel", karte: "karten" };

  function transformer(app) {
    if (!app.tr) {
      app.tr = new Konva.Transformer({
        rotateEnabled: true, keepRatio: true, enabledAnchors: ["top-left", "top-right", "bottom-left", "bottom-right"],
        anchorSize: 22, anchorCornerRadius: 11, borderStroke: "#4aa3ff", borderStrokeWidth: 2, anchorStroke: "#4aa3ff",
        rotateAnchorOffset: 44, padding: 8, ignoreStroke: true,
      });
      app.buehne.ui.add(app.tr);
      app.tr.on("transformstart", () => app.emit("tafel:greifen", { id: app.auswahlId }));
      app.tr.on("transformend", () => {
        const g = app.buehne.knoten.get(app.auswahlId);
        if (!g) return;
        const skala = Math.round(g.scaleX() * 1000) / 1000;
        g.scaleY(g.scaleX());
        app.sende({ op: "update", seite: app.z.aktuelle_seite, id: app.auswahlId,
          aenderungen: { x: Math.round(g.x()), y: Math.round(g.y()), rotation: Math.round(g.rotation() * 10) / 10, skala } });
        app.socket.emit("tafel:loslassen", { id: app.auswahlId });
        GT.auswahl.menue(app);
      });
      app.tr.on("transform", () => GT.auswahl.menue(app));
    }
    return app.tr;
  }

  GT.auswahl = {
    waehlen(app, id) {
      const g = app.buehne.knoten.get(id);
      const obj = app.objekt(id);
      if (!g || !obj) return;
      app.auswahlId = id;
      const tr = transformer(app);
      const nurVerschieben = !app.darfBearbeiten(obj);
      tr.setAttrs({ resizeEnabled: !nurVerschieben, rotateEnabled: !nurVerschieben });
      tr.nodes([g]);
      app.buehne.ui.batchDraw();
      this.menue(app);
    },
    abwaehlen(app) {
      if (app.tr) { app.tr.nodes([]); app.buehne.ui.batchDraw(); }
      app.auswahlId = null;
      app.auswahlMenue.hidden = true;
    },
    auffrischen(app) {
      if (!app.auswahlId) return;
      const id = app.auswahlId;
      if (!app.buehne.knoten.get(id)) return this.abwaehlen(app);
      this.waehlen(app, id);
    },
    menue(app) {
      const g = app.auswahlId && app.buehne.knoten.get(app.auswahlId);
      const obj = app.auswahlId && app.objekt(app.auswahlId);
      if (!g || !obj) { app.auswahlMenue.hidden = true; return; }
      const r = g.getClientRect({ relativeTo: app.buehne.stage });
      const oben = app.buehne.zuBildschirm({ x: r.x + r.width / 2, y: r.y });
      const flaeche = app.flaeche.getBoundingClientRect(), basis = app.el.getBoundingClientRect();
      const knoepfe = [];
      if (obj.typ === "aufgabe" && app.rolle === "lehrer" && obj.aufgabentyp !== "freitext") {
        knoepfe.push('<button data-a="pruefen">✓ Prüfen</button><button data-a="loesung">Lösung einsetzen</button>');
      }
      const werkzeug = BEARBEITBAR[obj.typ];
      if (werkzeug && app.hat(werkzeug) && app.darfInhalt(obj)) knoepfe.push('<button data-a="bearbeiten">✎ Bearbeiten</button>');
      knoepfe.push('<button data-a="vorne" title="Nach vorne holen">⬆</button>');
      if (app.darfBearbeiten(obj)) knoepfe.push('<button data-a="loeschen">🗑 Löschen</button>');
      if (!knoepfe.length) { app.auswahlMenue.hidden = true; return; }
      app.auswahlMenue.innerHTML = knoepfe.join("");
      app.auswahlMenue.hidden = false;
      const x = oben.x + flaeche.left - basis.left, y = Math.max(8, oben.y + flaeche.top - basis.top - 70);
      app.auswahlMenue.style.left = Math.max(70, x - app.auswahlMenue.offsetWidth / 2) + "px";
      app.auswahlMenue.style.top = y + "px";
      app.auswahlMenue.onclick = (e) => {
        const a = e.target.dataset.a;
        if (a === "pruefen") GT.aufgabePruefen(app, obj);
        if (a === "loesung") app.emit("lehrer:loesung_einsetzen", { seite: app.z.aktuelle_seite, id: obj.id });
        if (a === "loeschen") app.sende({ op: "delete", seite: app.z.aktuelle_seite, id: obj.id });
        if (a === "bearbeiten") GT.bearbeiten(app, obj);
        if (a === "vorne") app.emit("tafel:vorne", { seite: app.z.aktuelle_seite, id: obj.id });
      };
    },
  };

  GT.bearbeiten = (app, obj) => {
    if (obj.typ === "text") GT.textEditor(app, obj);
    else if (obj.typ === "formel") GT.formelDialog(app, obj);
    else if (obj.typ === "karte") GT.kartenDialog(app, obj);
  };

  GT.registriere("auswahl", {
    icon: "✋", titel: "Auswählen und verschieben", art: "zeiger",
    ende(app) { app.abwaehlen(); },
    runter(app, p, ev, e) {
      if (e.target && e.target.getParent && e.target.getParent() === app.tr) return; // Transformer-Griff
      const g = app.buehne.gruppeVon(e.target);
      if (!g) { app.abwaehlen(); return; }
      const obj = app.objekt(g.id());
      if (!obj) return;
      if (app.z.sperren[obj.id]) { GT.toast("Wird gerade von " + app.z.sperren[obj.id] + " bewegt."); return; }
      const jetzt = Date.now();
      if (this.letzter && this.letzter.id === obj.id && jetzt - this.letzter.zeit < 380) {
        this.letzter = null;
        const w = BEARBEITBAR[obj.typ];
        if (w && app.hat(w) && app.darfInhalt(obj)) { GT.bearbeiten(app, obj); return; }
      }
      this.letzter = { id: obj.id, zeit: jetzt };
      if (app.auswahlId !== obj.id) app.waehlen(obj.id);
      this.zug = { id: obj.id, start: p, x: g.x(), y: g.y(), bewegt: false, gegriffen: false };
    },
    bewegen(app, p) {
      const z = this.zug;
      if (!z || !p) return;
      const dx = p.x - z.start.x, dy = p.y - z.start.y;
      if (!z.bewegt && Math.hypot(dx, dy) < 4) return;
      if (!z.bewegt) {
        z.bewegt = true;
        app.emit("tafel:greifen", { id: z.id }).then((a) => {
          if (!a.ok) { const g = app.buehne.knoten.get(z.id); g && g.position({ x: z.x, y: z.y }); this.zug = null; app.auswahlAuffrischen(); }
          else z.gegriffen = true;
        });
      }
      const g = app.buehne.knoten.get(z.id);
      if (!g) return;
      g.position({ x: z.x + dx, y: z.y + dy });
      app.buehne.obj.batchDraw();
      app.tr && app.tr.forceUpdate();
      GT.auswahl.menue(app);
      const jetzt = Date.now();
      if (jetzt - (z.zeit || 0) > 50) { z.zeit = jetzt; app.socket.emit("tafel:bewegen", { id: z.id, x: g.x(), y: g.y(), seite: app.z.aktuelle_seite }); }
    },
    hoch(app) {
      const z = this.zug;
      this.zug = null;
      if (!z || !z.bewegt) return;
      const g = app.buehne.knoten.get(z.id);
      if (!g) return;
      app.sende({ op: "update", seite: app.z.aktuelle_seite, id: z.id, aenderungen: { x: Math.round(g.x()), y: Math.round(g.y()) } })
        .then(() => app.socket.emit("tafel:loslassen", { id: z.id }));
    },
    abbrechen(app) {
      const z = this.zug;
      this.zug = null;
      if (z && z.bewegt) {
        const g = app.buehne.knoten.get(z.id);
        g && g.position({ x: z.x, y: z.y });
        app.socket && app.socket.emit("tafel:loslassen", { id: z.id });
      }
    },
  });
})();
