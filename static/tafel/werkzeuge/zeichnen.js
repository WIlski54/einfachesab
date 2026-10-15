/* Stift, Textmarker, Radierer, Laserpointer, Formen, Lineal. */
(function () {
  const GT = window.GT;

  /** Alle (auch zusammengefassten) Zeigerpositionen eines Ereignisses in Tafelkoordinaten. */
  function punkteAus(app, ev) {
    const rect = app.flaeche.getBoundingClientRect();
    const liste = ev.getCoalescedEvents ? ev.getCoalescedEvents() : [];
    const quelle = liste.length ? liste : [ev];
    return quelle.map((c) => {
      const t = app.buehne.zuTafel({ x: c.clientX - rect.left, y: c.clientY - rect.top });
      const druck = c.pointerType === "pen" ? Math.max(0.05, c.pressure || 0.5) : 0.5;
      return [Math.round(t.x * 10) / 10, Math.round(t.y * 10) / 10, Math.round(druck * 100) / 100];
    });
  }

  function farbeFuer(app, werkzeug) {
    if (app.rolle !== "lehrer" && app.rechte.eigene_farbe != null) return app.rechte.eigene_farbe;
    return app.opt[werkzeug].farbe;
  }

  function zeichenWerkzeug(id, marker) {
    return {
      icon: marker ? "🖍️" : "✏️",
      titel: marker ? "Textmarker" : "Stift",
      art: "zeiger",
      optionen: ["farbe", "staerke"],
      runter(app, p, ev) {
        const farbe = farbeFuer(app, id), staerke = app.opt[id].staerke;
        const s = (this.s = { id: GT.uid("s"), punkte: punkteAus(app, ev), gesendet: 0, farbe, staerke,
          druck: ev.pointerType === "pen" });
        s.knoten = new Konva.Line({ closed: true, strokeEnabled: false, listening: false,
          fill: GT.farbe(farbe, app.buehne.theme), opacity: marker ? GT.markerDeckkraft(app.buehne.theme) : 1 });
        app.buehne.live.add(s.knoten);
        this.zeichnen(app);
        s.timer = setInterval(() => this.senden(app), 33);
      },
      bewegen(app, p, ev) {
        if (!this.s) return;
        this.s.punkte.push(...punkteAus(app, ev));
        this.zeichnen(app);
      },
      zeichnen(app) {
        const s = this.s;
        const staerken = marker ? GT.staerken.marker : GT.staerken.stift;
        s.knoten.points(GT.strichUmriss(app.linealEinrasten(s.punkte), { groesse: staerken[s.staerke - 1], marker, druck: s.druck }));
        app.buehne.live.batchDraw();
      },
      senden(app) {
        const s = this.s;
        if (!s || s.gesendet >= s.punkte.length) return;
        app.socket.emit("tafel:live_strich", { strich_id: s.id, punkte: s.punkte.slice(s.gesendet), farbe: s.farbe,
          staerke: s.staerke, marker, druck: s.druck, seite: app.z.aktuelle_seite });
        s.gesendet = s.punkte.length;
      },
      hoch(app) {
        const s = this.s;
        if (!s) return;
        clearInterval(s.timer);
        this.s = null;
        const punkte = app.linealEinrasten(s.punkte);
        const minX = Math.min(...punkte.map((q) => q[0])), minY = Math.min(...punkte.map((q) => q[1]));
        const objekt = { id: s.id, typ: "strich", x: minX, y: minY, farbe: s.farbe, staerke: s.staerke, marker,
          druck: s.druck, punkte: punkte.map((q) => [Math.round((q[0] - minX) * 10) / 10, Math.round((q[1] - minY) * 10) / 10, q[2]]) };
        app.sende({ op: "add", seite: app.z.aktuelle_seite, objekt });
        s.knoten.destroy();
        app.buehne.live.batchDraw();
      },
      abbrechen(app) {
        if (!this.s) return;
        clearInterval(this.s.timer);
        this.s.knoten.destroy();
        this.s = null;
        app.buehne.live.batchDraw();
      },
    };
  }

  GT.registriere("stift", zeichenWerkzeug("stift", false));
  GT.registriere("marker", zeichenWerkzeug("marker", true));

  GT.registriere("radierer", {
    icon: "🧽", titel: "Radierer (ganze Striche und Objekte)", art: "zeiger",
    runter(app) { this.weg = new Set(); this.treffen(app); },
    bewegen(app) { if (this.weg) this.treffen(app); },
    hoch() { this.weg = null; },
    abbrechen() { this.weg = null; },
    treffen(app) {
      const pos = app.buehne.stage.getPointerPosition();
      if (!pos) return;
      // kleiner Radius: mehrere Punkte um den Finger prüfen
      for (const [dx, dy] of [[0, 0], [8, 0], [-8, 0], [0, 8], [0, -8]]) {
        const knoten = app.buehne.obj.getIntersection({ x: pos.x + dx, y: pos.y + dy });
        const g = app.buehne.gruppeVon(knoten);
        if (!g || this.weg.has(g.id())) continue;
        const obj = app.objekt(g.id());
        if (!obj) continue;
        if (!app.darfBearbeiten(obj)) { GT.toast("Das hat die Lehrkraft angelegt."); this.weg.add(obj.id); continue; }
        if (app.z.sperren[obj.id]) continue;
        this.weg.add(obj.id);
        app.sende({ op: "delete", seite: app.z.aktuelle_seite, id: obj.id });
      }
    },
  });

  GT.registriere("laser", {
    icon: "🔴", titel: "Laserpointer", art: "zeiger",
    runter(app, p) { this.puffer = []; this.punkt(app, p); this.timer = setInterval(() => this.senden(app), 40); },
    bewegen(app, p) { if (this.puffer) this.punkt(app, p); },
    punkt(app, p) { if (!p) return; app.laserPunkt(p.x, p.y); this.puffer.push([Math.round(p.x), Math.round(p.y)]); },
    senden(app) {
      if (!this.puffer || !this.puffer.length) return;
      const letzter = this.puffer[this.puffer.length - 1];
      app.socket.emit("tafel:laser", { punkte: this.puffer, x: letzter[0], y: letzter[1] });
      this.puffer = [];
    },
    hoch(app) { this.senden(app); clearInterval(this.timer); this.puffer = null; },
    abbrechen() { clearInterval(this.timer); this.puffer = null; },
  });

  GT.registriere("formen", {
    icon: "➡️", titel: "Formen: Linie, Pfeil, Rechteck, Kreis", art: "zeiger", optionen: ["art", "farbe", "staerke"],
    runter(app, p) { if (p) this.f = { start: p, id: GT.uid("f") }; },
    objekt(app, p) {
      const o = app.opt.formen;
      return { id: this.f.id, typ: "form", art: o.art, farbe: farbeFuer(app, "formen"), staerke: o.staerke,
        x: Math.round(this.f.start.x), y: Math.round(this.f.start.y),
        dx: Math.round(p.x - this.f.start.x), dy: Math.round(p.y - this.f.start.y) };
    },
    bewegen(app, p) {
      if (!this.f || !p) return;
      const o = this.objekt(app, p);
      if (this.vorschau) this.vorschau.destroy();
      this.vorschau = GT.darstellung.erzeuge(o, app.buehne.theme);
      app.buehne.live.add(this.vorschau);
      app.buehne.live.batchDraw();
      const jetzt = Date.now();
      if (jetzt - (this.zeit || 0) > 60) { this.zeit = jetzt; app.socket.emit("tafel:form_vorschau", { objekt: o }); }
    },
    hoch(app, p) {
      if (!this.f) return;
      const o = p ? this.objekt(app, p) : null;
      this.abbrechen(app);
      app.socket.emit("tafel:form_vorschau", { objekt: null });
      if (o && Math.hypot(o.dx, o.dy) > 8) app.sende({ op: "add", seite: app.z.aktuelle_seite, objekt: o });
    },
    abbrechen(app) {
      if (this.vorschau) { this.vorschau.destroy(); this.vorschau = null; app.buehne.live.batchDraw(); }
      this.f = null;
    },
  });

  GT.registriere("lineal", {
    icon: "📏", titel: "Lineal ein/aus (verschieben, am blauen Griff drehen)", art: "schalter",
    aktiv: (app) => !!app.lineal.sichtbar,
    klick(app) {
      if (!app.lineal.sichtbar) {
        const m = app.buehne.mitte();
        app.lineal = { sichtbar: true, x: m.x - 380, y: m.y, winkel: 0 };
      } else app.lineal.sichtbar = false;
      app.linealZeichnen();
      app.socket.emit("tafel:lineal", app.lineal);
    },
  });
})();
