/* Erweiterung der Tafel-Aufgaben um zwei Typen, die zum Arbeitsblatt passen:
     tabelle  – Zeilen/Spalten mit festen Texten, Eingabefeldern (Tastatur, optional Zifferntastatur) und Ankreuzfeldern
     schalen  – antippbares Schalenmodell (Schale antippen = Elektron setzen, Elektron antippen = entfernen)
   Hängt sich über GT.aufgabenZeichner / GT.aufgabenAntippen / GT.feldEingabeart in aufgabe.js ein.
   Muss NACH aufgabe.js geladen werden. */
(function () {
  const GT = (window.GT = window.GT || {});
  const H = GT.aufgabeHelfer;
  if (!H) return;
  const { SCHRIFT, STIL, messen, textHoehe, feldKasten } = H;
  GT.aufgabenZeichner = GT.aufgabenZeichner || {};
  GT.aufgabenAntippen = GT.aufgabenAntippen || {};

  const zelleVon = (o, feld) => {
    for (const zeile of o.zeilen || []) for (const z of zeile) if (z.feld === feld) return z;
    return {};
  };
  GT.feldEingabeart = (o, feld) => (o.aufgabentyp === "tabelle" && zelleVon(o, feld).zahl ? "numeric" : null);

  function frageText(g, o, x0, y0, B, fs) {
    if (!o.frage) return 0;
    const t = new Konva.Text({ x: x0, y: y0, width: B, text: o.frage, fontSize: fs, fontFamily: SCHRIFT, fill: "#2a2a2a", lineHeight: 1.35 });
    g.add(t);
    return t.height() + 16;
  }

  // ---------- Ankreuzfeld ----------
  function haken(g, o, feld, x, y, gr) {
    const f = (o.felder || {})[feld];
    const gesetzt = !!(f && f.wert === "true");
    const st = STIL[f && f.status ? f.status : gesetzt ? "offen" : "leer"];
    const k = new Konva.Group({ x, y, name: "feld" });
    k.setAttr("feld", feld);
    if (GT.hervorhebenPerson && (!f || f.von_id !== GT.hervorhebenPerson)) k.opacity(0.3);
    k.add(new Konva.Rect({ width: gr, height: gr, cornerRadius: 6, fill: st.fill, stroke: st.stroke, strokeWidth: 2.5, dash: gesetzt || (f && f.status) ? undefined : st.dash }));
    if (gesetzt) k.add(new Konva.Text({ width: gr, height: gr, align: "center", verticalAlign: "middle", text: "✓", fontSize: gr * 0.8, fontStyle: "bold", fontFamily: SCHRIFT, fill: st.text }));
    g.add(k);
  }

  // ---------- Tabelle ----------
  GT.aufgabenZeichner.tabelle = (g, o, x0, y0, B) => {
    const fs = o.schrift || 20, kopf = fs * 0.7, hFeld = fs + 16, luft = 6;
    let y = y0 + frageText(g, o, x0, y0, B, 21);
    const n = Math.max((o.spalten || []).length, ...(o.zeilen || []).map((z) => z.length));
    const gew = (o.breiten && o.breiten.length === n ? o.breiten : Array(n).fill(1));
    const summe = gew.reduce((a, b) => a + b, 0);
    const breite = gew.map((w) => (w / summe) * B);
    const spaltenX = breite.map((_, i) => breite.slice(0, i).reduce((a, b) => a + b, 0));
    if ((o.spalten || []).some(Boolean)) {
      let hk = 0;
      o.spalten.forEach((s, i) => {
        const t = new Konva.Text({ x: x0 + spaltenX[i] + 4, y, width: breite[i] - 8, align: i === 0 ? "left" : "center", wrap: "word",
          text: s, fontSize: kopf, fontStyle: "bold", fontFamily: SCHRIFT, fill: "#7a4a00", lineHeight: 1.15 });
        g.add(t);
        hk = Math.max(hk, t.height());
      });
      y += hk + 6;
      g.add(new Konva.Line({ points: [x0, y, x0 + B, y], stroke: "#c9b98f", strokeWidth: 2 }));
      y += 10;
    }
    (o.zeilen || []).forEach((zeile) => {
      let zh = hFeld;
      const texte = [];
      zeile.forEach((z, i) => {
        if (z.feld) return;
        const t = new Konva.Text({ x: x0 + spaltenX[i] + 4, y, width: breite[i] - 8, align: i === 0 ? "left" : "center", wrap: "word",
          text: z.text || "", fontSize: fs, fontStyle: i === 0 ? "bold" : "normal", fontFamily: SCHRIFT, fill: "#2a2a2a", lineHeight: 1.15 });
        texte.push(t);
        zh = Math.max(zh, t.height());
      });
      texte.forEach((t) => { t.y(y + (zh - t.height()) / 2); g.add(t); });
      zeile.forEach((z, i) => {
        if (!z.feld) return;
        const bx = x0 + spaltenX[i] + luft, bb = breite[i] - 2 * luft;
        if (z.art === "haken") haken(g, o, z.feld, bx + (bb - hFeld) / 2, y + (zh - hFeld) / 2, hFeld);
        else feldKasten(g, o, z.feld, bx, y + (zh - hFeld) / 2, bb, hFeld, fs, { keinAlt: true });
      });
      y += zh + 12;
    });
    return y - y0;
  };

  GT.aufgabenAntippen.tabelle = async (app, knoten, obj, feld) => {
    if (zelleVon(obj, feld).art !== "haken") return undefined;      // Textfelder: normaler Tastatur-Editor
    const seite = app.z.aktuelle_seite;
    const a = await app.emit("tafel:feld_fokus", { seite, id: obj.id, feld, an: true });
    if (!a.ok) { GT.toast(a.grund, "fehler"); return true; }
    const jetzt = ((obj.felder || {})[feld] || {}).wert === "true";
    await H.senden(app, obj, feld, jetzt ? "false" : "true");
    app.socket.emit("tafel:feld_fokus", { seite, id: obj.id, feld, an: false });
    return true;
  };

  // ---------- Schalenmodell ----------
  const RADIEN = [50, 88, 124], MAX = 18;
  const anzahl = (o, k) => parseInt(((o.felder || {})["s" + k] || {}).wert, 10) || 0;

  GT.aufgabenZeichner.schalen = (g, o, x0, y0, B) => {
    const fs = 20;
    const y = y0 + frageText(g, o, x0, y0, B, fs);
    const D = 250, cx = x0 + D / 2 + 6, cy = y + D / 2 + 4, sk = (D / 2 - 6) / RADIEN[2];
    const gesamt = [0, 1, 2].reduce((a, k) => a + anzahl(o, k), 0);
    RADIEN.forEach((r, k) => {                                   // Schale antippen = Elektron setzen
      const f = (o.felder || {})["s" + k];
      const ring = new Konva.Group({ name: "feld" });
      ring.setAttr("feld", "s" + k);
      ring.setAttr("aktion", "plus");
      if (GT.hervorhebenPerson && (!f || f.von_id !== GT.hervorhebenPerson)) ring.opacity(0.3);
      const st = f && f.status ? STIL[f.status] : null;
      ring.add(new Konva.Circle({ x: cx, y: cy, radius: r * sk, fillEnabled: false, stroke: st ? st.stroke : "#9fb3cc", strokeWidth: st ? 3.5 : 2.5, hitStrokeWidth: 34 * sk }));
      g.add(ring);
    });
    g.add(new Konva.Circle({ x: cx, y: cy, radius: 22 * sk, fill: "#ffe39a", stroke: "#c9a23a", strokeWidth: 2 }));
    g.add(new Konva.Text({ x: cx - 30, y: cy - 8, width: 60, align: "center", text: o.kern || "", fontSize: 15, fontStyle: "bold", fontFamily: SCHRIFT, fill: "#1e293b" }));
    RADIEN.forEach((r, k) => {                                   // Elektron antippen = entfernen
      const n = anzahl(o, k), f = (o.felder || {})["s" + k];
      const st = f && f.status ? STIL[f.status] : null;
      for (let i = 0; i < n; i++) {
        const w = -Math.PI / 2 + (i * 2 * Math.PI) / n + k * 0.4;
        const e = new Konva.Group({ name: "feld" });
        e.setAttr("feld", "s" + k);
        e.setAttr("aktion", "minus");
        if (GT.hervorhebenPerson && (!f || f.von_id !== GT.hervorhebenPerson)) e.opacity(0.3);
        e.add(new Konva.Circle({ x: cx + r * sk * Math.cos(w), y: cy + r * sk * Math.sin(w), radius: 10, fill: st ? st.stroke : "#2563eb", stroke: "#fff", strokeWidth: 2, hitStrokeWidth: 16 }));
        g.add(e);
      }
    });
    const tx = x0 + D + 40, tw = B - D - 40;
    const sperre = GT.feldSperren[o.id] || {};
    g.add(new Konva.Text({ x: tx, y: cy - 70, width: tw, text: "Gesetzte Elektronen", fontSize: 20, fontFamily: SCHRIFT, fill: "#555" }));
    g.add(new Konva.Text({ x: tx, y: cy - 42, width: tw, text: String(gesamt), fontSize: 44, fontStyle: "bold", fontFamily: SCHRIFT, fill: "#1b3a6b" }));
    g.add(new Konva.Text({ x: tx, y: cy + 14, width: tw, lineHeight: 1.5, fontSize: 20, fontFamily: SCHRIFT, fill: "#2a2a2a",
      text: ["K", "L", "M"].map((n, k) => `${n}-Schale: ${anzahl(o, k)}${((o.felder || {})["s" + k] || {}).status === "richtig" ? " ✓" : ""}`).join("\n") }));
    const wer = Object.values(sperre)[0];
    if (wer) g.add(new Konva.Text({ x: tx, y: cy + 100, width: tw, text: "✏️ " + wer + " tippt …", fontSize: 16, fontFamily: SCHRIFT, fill: "#1f6fbf" }));
    return D + 20 + (y - y0);
  };

  GT.aufgabenAntippen.schalen = async (app, knoten, obj, feld) => {
    const seite = app.z.aktuelle_seite;
    const k = parseInt(feld.slice(1), 10), jetzt = anzahl(obj, k);
    const neu = knoten.getAttr("aktion") === "minus" ? jetzt - 1 : jetzt + 1;
    if (neu < 0) return true;
    if (neu > MAX) { GT.toast("Auf diese Schale passen nicht mehr Elektronen.", "fehler"); return true; }
    const a = await app.emit("tafel:feld_fokus", { seite, id: obj.id, feld, an: true });
    if (!a.ok) { GT.toast(a.grund, "fehler"); return true; }
    await H.senden(app, obj, feld, String(neu));
    app.socket.emit("tafel:feld_fokus", { seite, id: obj.id, feld, an: false });
    return true;
  };
})();
