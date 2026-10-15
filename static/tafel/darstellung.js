/* Objekt → Konva-Knoten. Jedes Objekt ist eine Gruppe an (x, y) mit Drehung und Skala;
   der Inhalt liegt in lokalen Koordinaten. */
(function () {
  const GT = (window.GT = window.GT || {});
  const SCHRIFT = "'Trebuchet MS', 'Segoe UI', Arial, sans-serif";
  const PAPIER = "#fbfaf5";

  GT.strichUmriss = (punkte, { groesse, marker, druck }) => {
    const pf = window.PerfectFreehand;
    const umriss = pf.getStroke(punkte, {
      size: groesse,
      thinning: marker ? 0 : druck ? 0.6 : 0.45,
      smoothing: 0.5,
      streamline: 0.4,
      simulatePressure: !druck && !marker,
      last: true,
    });
    const flach = [];
    for (const p of umriss) flach.push(p[0], p[1]);
    return flach;
  };

  function strich(g, o, theme) {
    const staerken = o.marker ? GT.staerken.marker : GT.staerken.stift;
    const groesse = staerken[(o.staerke || 2) - 1] || staerken[1];
    g.add(new Konva.Line({
      points: GT.strichUmriss(o.punkte || [], { groesse, marker: o.marker, druck: o.druck }),
      closed: true, fill: GT.farbe(o.farbe, theme), opacity: o.marker ? GT.markerDeckkraft(theme) : 1,
      strokeEnabled: false, perfectDrawEnabled: false,
    }));
  }

  function form(g, o, theme) {
    const farbe = GT.farbe(o.farbe, theme);
    const breite = GT.staerken.form[(o.staerke || 2) - 1] || 5;
    const dx = o.dx || 0, dy = o.dy || 0;
    const basis = { stroke: farbe, strokeWidth: breite, lineCap: "round", lineJoin: "round", hitStrokeWidth: 24 };
    if (o.art === "pfeil") {
      g.add(new Konva.Arrow(Object.assign({ points: [0, 0, dx, dy], fill: farbe, pointerLength: 14 + breite * 2,
        pointerWidth: 12 + breite * 2 }, basis)));
    } else if (o.art === "rechteck") {
      g.add(new Konva.Rect(Object.assign({ x: Math.min(0, dx), y: Math.min(0, dy), width: Math.abs(dx),
        height: Math.abs(dy), cornerRadius: 4 }, basis)));
    } else if (o.art === "kreis") {
      g.add(new Konva.Ellipse(Object.assign({ x: dx / 2, y: dy / 2, radiusX: Math.abs(dx / 2),
        radiusY: Math.abs(dy / 2) }, basis)));
    } else {
      g.add(new Konva.Line(Object.assign({ points: [0, 0, dx, dy] }, basis)));
    }
  }

  function text(g, o, theme) {
    g.add(new Konva.Text({ text: o.text || "", fontSize: o.groesse || 36, fontFamily: SCHRIFT,
      fill: GT.farbe(o.farbe, theme), lineHeight: 1.2 }));
  }

  function formel(g, o, theme) {
    const groesse = o.groesse || 48;
    const platzhalter = new Konva.Text({ text: "…", fontSize: groesse, fill: GT.farbe(o.farbe, theme) });
    g.add(platzhalter);
    GT.formelBild(o.quelle, o.modus, GT.farbe(o.farbe, theme), groesse)
      .then((b) => GT.ladeBild(b.url).then((img) => {
        platzhalter.destroy();
        g.add(new Konva.Image({ image: img, width: b.breite, height: b.hoehe }));
        g.getLayer() && g.getLayer().batchDraw();
      }))
      .catch(() => { platzhalter.text("⚠ " + o.quelle); g.getLayer() && g.getLayer().batchDraw(); });
  }

  function karte(g, o) {
    const breite = o.breite || 240;
    const t = new Konva.Text({ text: o.text || "", width: breite - 28, x: 14, y: 14, fontSize: 28,
      fontFamily: SCHRIFT, fill: "#222", align: "center", lineHeight: 1.15 });
    const hoehe = Math.max(64, t.height() + 28);
    g.add(new Konva.Rect({ width: breite, height: hoehe, fill: GT.farben.karten[o.kartenfarbe] || GT.farben.karten.gelb,
      cornerRadius: 6, shadowColor: "#000", shadowBlur: 10, shadowOpacity: 0.35, shadowOffset: { x: 2, y: 3 } }));
    g.add(t);
  }

  function bild(g, o) {
    const platz = new Konva.Rect({ width: o.breite || 400, height: o.hoehe || 300, fill: "rgba(255,255,255,0.15)",
      stroke: "rgba(255,255,255,0.4)", dash: [8, 6] });
    g.add(platz);
    GT.ladeBild(o.url).then((img) => {
      platz.destroy();
      g.add(new Konva.Image({ image: img, width: o.breite || img.width, height: o.hoehe || img.height,
        shadowColor: "#000", shadowBlur: 8, shadowOpacity: 0.3 }));
      g.getLayer() && g.getLayer().batchDraw();
    }).catch(() => {});
  }

  /** Fließtext mit hervorgehobenen Lücken; liefert die Höhe. */
  function fliesstext(g, segmente, x, y, breite, fontSize) {
    const messer = new Konva.Text({ fontSize, fontFamily: SCHRIFT });
    const mess = (s, fett) => { messer.fontStyle(fett ? "bold" : "normal"); messer.text(s); return messer.width(); };
    const token = [];
    for (const seg of segmente) {
      if (seg.luecke !== undefined) token.push({ t: seg.luecke, luecke: true });
      else String(seg.text || "").split(/(\s+)/).forEach((w) => w && token.push({ t: w }));
    }
    const zeile = fontSize * 1.45;
    let cx = 0, cy = 0;
    for (const tok of token) {
      if (!tok.luecke && /^\s+$/.test(tok.t)) { if (cx > 0) cx += mess(" "); continue; }
      const w = mess(tok.t, tok.luecke) + (tok.luecke ? 12 : 0);
      if (cx + w > breite && cx > 0) { cx = 0; cy += zeile; }
      if (tok.luecke) {
        g.add(new Konva.Rect({ x: x + cx, y: y + cy - 3, width: w, height: fontSize + 8, fill: "#ffe98a", cornerRadius: 4 }));
        g.add(new Konva.Text({ x: x + cx + 6, y: y + cy, text: tok.t, fontSize, fontStyle: "bold", fontFamily: SCHRIFT, fill: "#1b3a6b" }));
      } else {
        g.add(new Konva.Text({ x: x + cx, y: y + cy, text: tok.t, fontSize, fontFamily: SCHRIFT, fill: "#2a2a2a" }));
      }
      cx += w;
    }
    return cy + zeile;
  }

  function abKarte(g, o) {
    const B = 580, P = 22, fs = 24;
    const inhalt = new Konva.Group();
    const titel = new Konva.Text({ x: P + 6, y: P, width: B - 2 * P - 6, wrap: "word", lineHeight: 1.15, text: o.titel || "Aufgabe",
      fontSize: 26, fontStyle: "bold", fontFamily: SCHRIFT, fill: "#1b3a6b" });
    const metaY = P + titel.height() + 4;
    const meta = new Konva.Text({ x: P + 6, y: metaY, width: B - 2 * P - 6, fontSize: 18, fontFamily: SCHRIFT, fill: "#777",
      text: [o.anzeige_name, o.niveau ? "Niveau " + o.niveau : null].filter(Boolean).join(" · ") });
    inhalt.add(titel, meta);
    const linieY = metaY + 30;
    inhalt.add(new Konva.Line({ points: [P + 6, linieY, B - P, linieY], stroke: "#ddd", strokeWidth: 2 }));
    let y = linieY + 16, h = 0;
    const d = o.inhalt || {};
    if (o.aufgabentyp === "lueckentext" && d.segmente) {
      h = fliesstext(inhalt, d.segmente, P + 6, y, B - 2 * P - 6, fs);
    } else if (o.aufgabentyp === "zuordnung" && d.paare) {
      d.paare.forEach(([links, rechts]) => {
        const l = new Konva.Text({ x: P + 6, y: y + h, text: links, fontSize: fs + 2, fontFamily: SCHRIFT, fill: "#2a2a2a", width: 220, wrap: "word" });
        const r = new Konva.Text({ x: P + 270, y: y + h, text: rechts, fontSize: fs + 2, fontStyle: "bold", fontFamily: SCHRIFT, fill: "#1b3a6b",
          width: B - P - 280, wrap: "word" });
        inhalt.add(l, r, new Konva.Text({ x: P + 230, y: y + h, text: "→", fontSize: fs + 2, fill: "#999" }));
        h += Math.max(l.height(), r.height()) + 10;
      });
    } else {
      const t = new Konva.Text({ x: P + 6, y, width: B - 2 * P - 6, text: d.text || "", fontSize: fs,
        fontFamily: SCHRIFT, fill: "#2a2a2a", lineHeight: 1.4 });
      inhalt.add(t);
      h = t.height();
    }
    const hoehe = y + h + P;
    g.add(new Konva.Rect({ width: B, height: hoehe, fill: PAPIER, cornerRadius: 6, shadowColor: "#000",
      shadowBlur: 14, shadowOpacity: 0.4, shadowOffset: { x: 3, y: 4 } }));
    g.add(new Konva.Rect({ width: 8, height: hoehe, fill: "#4a6fa5", cornerRadius: [6, 0, 0, 6] }));
    g.add(inhalt);
  }

  const ZEICHNER = { strich, form, text, formel, karte, bild, ab_karte: abKarte };

  GT.darstellung = {
    erzeuge(o, theme) {
      const g = new Konva.Group({ id: o.id, name: "obj" });
      g.setAttr("daten", o);
      GT.darstellung.geometrie(g, o);
      (ZEICHNER[o.typ] || (GT.zeichner && GT.zeichner[o.typ]) || text)(g, o, theme);
      return g;
    },
    geometrie(g, o) {
      g.setAttrs({ x: o.x || 0, y: o.y || 0, rotation: o.rotation || 0, scaleX: o.skala || 1, scaleY: o.skala || 1 });
    },
  };
})();
