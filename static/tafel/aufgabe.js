/* Aufgaben an der Tafel lösen: Darstellung (Konva), Feld-Editor (Tastatur, Wortbank, Auswahl),
   Prüfen / Lösung einsetzen und die Warnung vor offenen roten Feldern. */
(function () {
  const GT = (window.GT = window.GT || {});
  const SCHRIFT = "'Trebuchet MS', 'Segoe UI', Arial, sans-serif";
  const STIL = {
    leer: { fill: "#eef3fb", stroke: "#9fb3cc", text: "#1b3a6b", dash: [7, 5] },
    offen: { fill: "#ffffff", stroke: "#4a6fa5", text: "#1b3a6b" },
    richtig: { fill: "#eaf3de", stroke: "#639922", text: "#27500a" },
    falsch: { fill: "#fcebeb", stroke: "#e24b4a", text: "#791f1f" },
  };
  GT.feldSperren = {}; // objekt_id -> { feld: Name }

  GT.feldSperrenSetzen = (liste) => {
    GT.feldSperren = {};
    (liste || []).forEach((s) => { (GT.feldSperren[s.id] = GT.feldSperren[s.id] || {})[s.feld] = s.name; });
  };

  const zustand = (f) => (!f || !f.wert ? (f && f.status === "falsch" ? "falsch" : "leer") : f.status || "offen");

  function messen(text, fs, fett) {
    const t = new Konva.Text({ text, fontSize: fs, fontFamily: SCHRIFT, fontStyle: fett ? "bold" : "normal" });
    const w = t.width();
    t.destroy();
    return w;
  }

  /** Ein Feld (Kasten + Wert, davor ggf. die durchgestrichene Erstantwort). Liefert die Breite. */
  function feldKasten(g, o, feld, x, y, breite, hoehe, fs, extra) {
    const f = (o.felder || {})[feld];
    const st = STIL[zustand(f)];
    const k = new Konva.Group({ x, y, name: "feld" });
    k.setAttr("feld", feld);
    if (GT.hervorhebenPerson && (!f || f.von_id !== GT.hervorhebenPerson)) k.opacity(0.3);
    if (extra && extra.wert !== undefined) k.setAttr("wert", extra.wert);
    let dx = 0;
    if (f && f.alt && !(extra && extra.keinAlt)) {
      const w = Math.min(messen(f.alt, fs * 0.9), (extra && extra.altMax) || Infinity);
      k.add(new Konva.Text({ x: 0, y: (Math.min(hoehe, fs + 16) - fs * 0.9) / 2, width: w, wrap: "none", ellipsis: true,
        text: f.alt, fontSize: fs * 0.9, fontFamily: SCHRIFT, fill: "#e24b4a" }));
      k.add(new Konva.Line({ points: [0, Math.min(hoehe, fs + 16) / 2, w, Math.min(hoehe, fs + 16) / 2], stroke: "#e24b4a", strokeWidth: 2 }));
      dx = w + 8;
    }
    const sperre = (GT.feldSperren[o.id] || {})[feld];
    k.add(new Konva.Rect({ x: dx, width: breite, height: hoehe, cornerRadius: 6, fill: st.fill,
      stroke: sperre ? "#4aa3ff" : st.stroke, strokeWidth: sperre ? 3 : 2.5, dash: sperre ? [6, 4] : st.dash }));
    const text = (f && f.wert ? f.wert : "") + (f && f.status === "richtig" && f.wert ? "  ✓" : "");
    if (extra && extra.mehrzeilig) {
      k.add(new Konva.Text({ x: dx + 10, y: 8, width: breite - 20, text, fontSize: fs, fontFamily: SCHRIFT, fill: st.text, lineHeight: 1.35 }));
    } else if (!(extra && extra.ohneText)) {
      k.add(new Konva.Text({ x: dx + 10, y: (hoehe - fs) / 2, width: Math.max(10, breite - 20), wrap: "none", ellipsis: true,
        text, fontSize: fs, fontFamily: SCHRIFT, fontStyle: "bold", fill: st.text }));
    }
    if (sperre) {
      k.add(new Konva.Text({ x: dx, y: -fs * 0.75 - 4, text: "✏️ " + sperre + " tippt …", fontSize: fs * 0.7, fill: "#1f6fbf", fontFamily: SCHRIFT }));
    }
    g.add(k);
    return dx + breite;
  }

  /** Höhe eines umbrochenen Textes bei gegebener Breite. */
  function textHoehe(text, fs, breite, fett, zeilenhoehe) {
    const t = new Konva.Text({ text: text || " ", fontSize: fs, fontFamily: SCHRIFT, width: breite, wrap: "word",
      fontStyle: fett ? "bold" : "normal", lineHeight: zeilenhoehe || 1.3 });
    const h = t.height();
    t.destroy();
    return h;
  }

  /** Breite, die eine durchgestrichene Erstantwort vor dem Kasten braucht. */
  const altBreite = (f, fs) => (f && f.alt ? messen(f.alt, fs * 0.9) + 8 : 0);

  /** Kasten für ein Feld mit gegebener Gesamtbreite: Höhe wächst mit dem (umbrochenen) Wert. */
  function feldZeile(g, o, feld, x, y, gesamt, fs, mindestHoehe) {
    const f = (o.felder || {})[feld];
    const altB = Math.min(altBreite(f, fs), gesamt * 0.4);
    const breite = Math.max(80, gesamt - altB);
    const wert = (f && f.wert ? f.wert : "") + (f && f.status === "richtig" && f.wert ? "  ✓" : "");
    const einzeilig = messen(wert, fs, true) <= breite - 20;
    const hoehe = einzeilig ? mindestHoehe : Math.max(mindestHoehe, textHoehe(wert, fs, breite - 20, false, 1.35) + 16);
    feldKasten(g, o, feld, x, y, breite, hoehe, fs, { mehrzeilig: !einzeilig, altMax: Math.max(0, altB - 8) });
    return hoehe;
  }

  function lueckentext(g, o, x0, y0, B, fs) {
    const zeile = fs * 1.9;
    let cx = 0, cy = 0;
    for (const teil of o.teile || []) {
      if (teil.feld) {
        const f = (o.felder || {})[teil.feld];
        const altB = Math.min(altBreite(f, fs), B * 0.4);
        const wunsch = Math.max(120, messen((f && f.wert) || "", fs, true) + 44);
        if (wunsch > B - altB) {  // zu lang für eine Zeile: eigener, umbrochener Kasten über die ganze Breite
          if (cx > 0) { cx = 0; cy += zeile; }
          const h = feldZeile(g, o, teil.feld, x0, y0 + cy - 6, B, fs, fs + 14);
          cy += h - (fs + 14) + zeile;
          cx = 0;
          continue;
        }
        if (cx + wunsch + altB > B && cx > 0) { cx = 0; cy += zeile; }
        cx += feldKasten(g, o, teil.feld, x0 + cx, y0 + cy - 6, wunsch, fs + 14, fs, { altMax: Math.max(0, altB - 8) }) + 6;
        continue;
      }
      for (const wort of String(teil.text).split(/(\s+)/)) {
        if (!wort) continue;
        if (/^\s+$/.test(wort)) { if (cx > 0) cx += messen(" ", fs); continue; }
        const w = messen(wort, fs);
        if (cx + w > B && cx > 0) { cx = 0; cy += zeile; }
        if (w > B) {  // ein einzelnes überlanges Wort: innerhalb der Karte umbrechen
          const t = new Konva.Text({ x: x0, y: y0 + cy, width: B, wrap: "char", text: wort, fontSize: fs, fontFamily: SCHRIFT, fill: "#2a2a2a" });
          g.add(t);
          cy += t.height() - fs;
          cx = B;
          continue;
        }
        g.add(new Konva.Text({ x: x0 + cx, y: y0 + cy, text: wort, fontSize: fs, fontFamily: SCHRIFT, fill: "#2a2a2a" }));
        cx += w;
      }
    }
    return cy + zeile;
  }

  function zuordnung(g, o, x0, y0, B, fs) {
    const h = fs + 18, L = Math.round(B * 0.42), pfeil = 40, feldX = L + pfeil;
    let y = y0;
    (o.zeilen || []).forEach((z) => {
      const links = new Konva.Text({ x: x0, y, width: L, wrap: "word", text: z.text, fontSize: fs, fontStyle: "bold",
        fontFamily: SCHRIFT, fill: "#2a2a2a", lineHeight: 1.2 });
      const feldH = feldZeile(g, o, z.feld, x0 + feldX, y, B - feldX, fs, h);
      const zeilenH = Math.max(links.height(), feldH);
      links.y(y + (zeilenH - links.height()) / 2);
      g.add(links);
      g.add(new Konva.Text({ x: x0 + L + 6, y: y + (zeilenH - fs) / 2, text: "→", fontSize: fs + 2, fill: "#888" }));
      y += zeilenH + 14;
    });
    return y - y0;
  }

  function mc(g, o, x0, y0, B, fs) {
    const frage = new Konva.Text({ x: x0, y: y0, width: B, text: o.frage || "", fontSize: fs, fontFamily: SCHRIFT, fill: "#2a2a2a", lineHeight: 1.35 });
    g.add(frage);
    let y = y0 + frage.height() + 14;
    const f = (o.felder || {}).wahl;
    const teile = (s) => (o.mehrfach ? String(s || "").split("|") : [s]);
    if (o.mehrfach) {
      g.add(new Konva.Text({ x: x0, y: y - 6, text: "Mehrere Antworten möglich", fontSize: fs * 0.7, fontStyle: "italic", fill: "#888", fontFamily: SCHRIFT }));
      y += fs * 0.9;
    }
    const sperre = (GT.feldSperren[o.id] || {}).wahl;
    (o.optionen || []).forEach((opt) => {
      const gewaehlt = !!(f && f.wert && teile(f.wert).includes(opt));
      const warFalsch = !!(f && f.alt && teile(f.alt).includes(opt) && !gewaehlt);
      const st = gewaehlt ? STIL[zustand(f)] : { fill: "#ffffff", stroke: "#c4cbd6", text: "#2a2a2a" };
      const textB = B - 60 - (sperre && gewaehlt ? 150 : 0);
      const t = new Konva.Text({ x: 44, width: textB, wrap: "word", lineHeight: 1.25, text: opt + (gewaehlt && f.status === "richtig" ? "  ✓" : ""),
        fontSize: fs, fontFamily: SCHRIFT, fill: warFalsch ? "#e24b4a" : st.text });
      const h = Math.max(fs + 20, t.height() + 16);
      t.y((h - t.height()) / 2);
      const k = new Konva.Group({ x: x0, y, name: "feld" });
      k.setAttr("feld", "wahl");
      k.setAttr("wert", opt);
      if (GT.hervorhebenPerson && gewaehlt && f.von_id !== GT.hervorhebenPerson) k.opacity(0.3);
      k.add(new Konva.Rect({ width: B, height: h, cornerRadius: 8, fill: st.fill, stroke: st.stroke, strokeWidth: gewaehlt ? 2.5 : 1.5 }));
      k.add(new Konva.Circle({ x: 22, y: h / 2, radius: 10, stroke: st.stroke, strokeWidth: 2.5, fill: gewaehlt ? st.stroke : "#fff" }));
      k.add(t);
      if (warFalsch) k.add(new Konva.Line({ points: [44, h / 2, 44 + Math.min(messen(opt, fs), textB), h / 2], stroke: "#e24b4a", strokeWidth: 2 }));
      if (sperre && gewaehlt) k.add(new Konva.Text({ x: B - 150, y: (h - fs * 0.7) / 2, width: 140, text: "✏️ " + sperre, fontSize: fs * 0.7, fill: "#1f6fbf" }));
      g.add(k);
      y += h + 10;
    });
    return y - y0;
  }

  function sortieren(g, o, x0, y0, B, fs) {
    const frage = new Konva.Text({ x: x0, y: y0, width: B, text: o.frage || "", fontSize: fs, fontFamily: SCHRIFT, fill: "#2a2a2a", lineHeight: 1.35 });
    g.add(frage);
    let y = y0 + frage.height() + 12;
    const benutzt = new Set(Object.values(o.felder || {}).map((f) => f && f.wert).filter(Boolean));
    const cfs = fs * 0.85;
    let cx = 0, zeilenH = 0;
    (o.elemente || []).forEach((el) => {
      const w = Math.min(B, messen(el, cfs) + 24);
      const t = new Konva.Text({ width: w - 24, wrap: "word", text: el, fontSize: cfs, fontFamily: SCHRIFT, lineHeight: 1.2 });
      const h = t.height() + 14;
      if (cx + w > B && cx > 0) { cx = 0; y += zeilenH + 8; zeilenH = 0; }
      const weg = benutzt.has(el);
      g.add(new Konva.Rect({ x: x0 + cx, y, width: w, height: h, cornerRadius: 12, fill: weg ? "#eeeeee" : "#fff3c4", stroke: weg ? "#d0d0d0" : "#d9b44a" }));
      t.setAttrs({ x: x0 + cx + 12, y: y + 7, fill: weg ? "#aaa" : "#633806" });
      g.add(t);
      cx += w + 8;
      zeilenH = Math.max(zeilenH, h);
    });
    y += zeilenH + 18;
    (o.elemente || []).forEach((_, i) => {
      const h = feldZeile(g, o, "p" + i, x0 + 44, y, B - 44, fs, fs + 16);
      g.add(new Konva.Text({ x: x0, y: y + (fs + 16) / 2 - fs / 2, text: i + 1 + ".", fontSize: fs, fontStyle: "bold", fontFamily: SCHRIFT, fill: "#7a4a00" }));
      y += h + 10;
    });
    return y - y0;
  }

  function richtigfalsch(g, o, x0, y0, B, fs) {
    let y = y0;
    (o.aussagen || []).forEach((a) => {
      const text = new Konva.Text({ x: x0, y, width: B - 250, wrap: "word", text: a.text, fontSize: fs, fontFamily: SCHRIFT, fill: "#2a2a2a", lineHeight: 1.3 });
      g.add(text);
      const f = (o.felder || {})[a.feld];
      const h = fs + 16;
      ["richtig", "falsch"].forEach((wert, j) => {
        const gewaehlt = f && f.wert === wert, warFalsch = f && f.alt === wert;
        const st = gewaehlt ? STIL[zustand(f)] : { fill: "#ffffff", stroke: "#c4cbd6", text: "#2a2a2a" };
        const k = new Konva.Group({ x: x0 + B - 240 + j * 122, y, name: "feld" });
        k.setAttr("feld", a.feld);
        k.setAttr("wert", wert);
        if (GT.hervorhebenPerson && gewaehlt && f.von_id !== GT.hervorhebenPerson) k.opacity(0.3);
        k.add(new Konva.Rect({ width: 112, height: h, cornerRadius: 8, fill: st.fill, stroke: st.stroke, strokeWidth: gewaehlt ? 2.5 : 1.5 }));
        k.add(new Konva.Text({ x: 0, y: (h - fs * 0.85) / 2, width: 112, align: "center", fontSize: fs * 0.85, fontFamily: SCHRIFT,
          text: wert + (gewaehlt && f.status === "richtig" ? " ✓" : ""), fill: warFalsch ? "#e24b4a" : st.text, fontStyle: gewaehlt ? "bold" : "normal" }));
        if (warFalsch) k.add(new Konva.Line({ points: [22, h / 2, 90, h / 2], stroke: "#e24b4a", strokeWidth: 2 }));
        g.add(k);
      });
      y += Math.max(text.height(), h) + 14;
    });
    return y - y0;
  }

  function freitext(g, o, x0, y0, B, fs) {
    const frage = new Konva.Text({ x: x0, y: y0, width: B, text: o.frage || "", fontSize: fs, fontFamily: SCHRIFT, fill: "#2a2a2a", lineHeight: 1.35 });
    g.add(frage);
    const f = (o.felder || {}).text;
    const h = Math.max(120, textHoehe((f && f.wert) || "", fs, B - 20, false, 1.35) + 20);
    feldKasten(g, o, "text", x0, y0 + frage.height() + 14, B, h, fs, { mehrzeilig: true, keinAlt: true });
    return frage.height() + 14 + h;
  }

  GT.aufgabeHelfer = { SCHRIFT, STIL, zustand, messen, textHoehe, feldKasten, senden: (...a) => senden(...a) };
  GT.zeichner = GT.zeichner || {};
  GT.zeichner.aufgabe = (g, o) => {
    const B = o.kartenbreite || 640, P = 22, fs = 24, breite = B - 2 * P - 6;
    const inhalt = new Konva.Group();
    // Titel umbricht innerhalb der Karte – egal wie lang er ist
    const titel = new Konva.Text({ x: P + 6, y: P, width: breite, wrap: "word", lineHeight: 1.15, text: "📋 " + (o.titel || "Aufgabe"),
      fontSize: 26, fontStyle: "bold", fontFamily: SCHRIFT, fill: "#7a4a00" });
    inhalt.add(titel);
    const metaY = P + titel.height() + 4;
    inhalt.add(new Konva.Text({ x: P + 6, y: metaY, width: breite, fontSize: 18, fontFamily: SCHRIFT, fill: "#777",
      text: (o.niveau ? "Niveau " + o.niveau : "") + (o.geprueft ? (o.niveau ? " · " : "") + "geprüft" : "") }));
    const linieY = metaY + 30;
    inhalt.add(new Konva.Line({ points: [P + 6, linieY, B - P, linieY], stroke: "#e2d7c2", strokeWidth: 2 }));
    const y = linieY + 24;
    const h = (GT.aufgabenZeichner && GT.aufgabenZeichner[o.aufgabentyp]) ||
      { lueckentext, zuordnung, mc, freitext, sortieren, richtigfalsch }[o.aufgabentyp] || freitext;
    const hoehe = y + h(inhalt, o, P + 6, y, breite, fs) + P;
    g.add(new Konva.Rect({ width: B, height: hoehe, fill: "#fbfaf5", cornerRadius: 6, shadowColor: "#000", shadowBlur: 14, shadowOpacity: 0.4, shadowOffset: { x: 3, y: 4 } }));
    g.add(new Konva.Rect({ width: 8, height: hoehe, fill: "#e8a33d", cornerRadius: [6, 0, 0, 6] }));
    g.add(inhalt);
  };

  // ---------- Bedienung ----------
  GT.feldVon = (knoten) => {
    while (knoten && knoten.getParent) {
      if (knoten.name && knoten.name() === "feld") return knoten;
      knoten = knoten.getParent();
    }
    return null;
  };

  GT.darfFelder = (app) => app.rolle === "lehrer"
    || (app.rolle === "schueler" && app.z.modus === "live" && app.rechte.am_brett && !app.rechte.eingefroren && app.verbunden);

  async function senden(app, obj, feld, wert) {
    const a = await app.emit("tafel:feld", { seite: app.z.aktuelle_seite, id: obj.id, feld, wert });
    if (!a.ok) { GT.toast(a.grund || "Das ging nicht.", "fehler"); return false; }
    app.version = Math.max(app.version, a.version);
    app._lokal({ op: "update", seite: app.z.aktuelle_seite, id: obj.id, aenderungen: { felder: a.felder } });
    return true;
  }

  function panel(app, knoten, klasse) {
    const box = document.createElement("div");
    box.className = "gt-feldeditor " + (klasse || "");
    const r = knoten.getClientRect({ relativeTo: app.buehne.stage });
    const unten = app.buehne.zuBildschirm({ x: r.x, y: r.y + r.height });
    const f = app.flaeche.getBoundingClientRect(), b = app.el.getBoundingClientRect();
    app.dialoge.appendChild(box);
    const links = Math.min(b.width - box.offsetWidth - 10, Math.max(70, unten.x + f.left - b.left));
    const oben = unten.y + f.top - b.top + 8;
    box.style.left = Math.max(8, links) + "px";
    box.style.top = Math.min(oben, b.height - 60) + "px";
    return box;
  }

  function nachPlatzieren(app, box) {
    const b = app.el.getBoundingClientRect();
    const r = box.getBoundingClientRect();
    if (r.bottom > b.bottom - 8) box.style.top = Math.max(8, r.top - b.top - (r.bottom - b.bottom) - 16) + "px";
    if (r.right > b.right - 8) box.style.left = Math.max(8, b.width - r.width - 12) + "px";
  }

  /** Feld antippen: je nach Aufgabentyp und Eingabeart den passenden Editor öffnen. */
  GT.feldAntippen = async (app, knoten) => {
    const gruppe = app.buehne.gruppeVon(knoten);
    const obj = gruppe && app.objekt(gruppe.id());
    if (!obj || obj.typ !== "aufgabe" || !GT.darfFelder(app)) return false;
    if (app.dialoge.querySelector(".gt-feldeditor")) return true;
    const feld = knoten.getAttr("feld");
    const seite = app.z.aktuelle_seite;
    const eigene = GT.aufgabenAntippen && GT.aufgabenAntippen[obj.aufgabentyp];  // Erweiterung (aufgabe_ab.js)
    if (eigene) { const r = await eigene(app, knoten, obj, feld); if (r !== undefined) return r; }
    if (obj.aufgabentyp === "mc" || obj.aufgabentyp === "richtigfalsch") {
      const a = await app.emit("tafel:feld_fokus", { seite, id: obj.id, feld, an: true });
      if (!a.ok) { GT.toast(a.grund, "fehler"); return true; }
      let wert = knoten.getAttr("wert");
      if (obj.mehrfach) {  // Antippen schaltet die Option in der Auswahl an/aus
        const jetzt = new Set(String(((obj.felder || {})[feld] || {}).wert || "").split("|").filter(Boolean));
        jetzt.has(wert) ? jetzt.delete(wert) : jetzt.add(wert);
        wert = obj.optionen.filter((o) => jetzt.has(o)).join("|");
      }
      await senden(app, obj, feld, wert);
      app.socket.emit("tafel:feld_fokus", { seite, id: obj.id, feld, an: false });
      return true;
    }
    const a = await app.emit("tafel:feld_fokus", { seite, id: obj.id, feld, an: true });
    if (!a.ok) { GT.toast(a.grund, "fehler"); return true; }
    const f = (obj.felder || {})[feld] || {};
    const schliessen = (box) => { box.remove(); app.socket.emit("tafel:feld_fokus", { seite, id: obj.id, feld, an: false }); };
    const wortbank = obj.aufgabentyp === "lueckentext" && app.rolle !== "lehrer" && app.rechte.eingabe === "wortbank";
    let box;
    if (obj.aufgabentyp === "zuordnung" || obj.aufgabentyp === "sortieren" || wortbank) {
      box = panel(app, knoten, "auswahl");
      let optionen = obj.aufgabentyp === "zuordnung" ? obj.optionen : obj.aufgabentyp === "sortieren" ? obj.elemente : obj.wortbank;
      if (obj.aufgabentyp === "sortieren") {
        const vergeben = new Set(Object.entries(obj.felder || {}).filter(([k, f]) => k !== feld && f && f.wert).map(([, f]) => f.wert));
        optionen = optionen.filter((x) => !vergeben.has(x));
      }
      box.innerHTML = `<div class="gt-wortbank">${(optionen || []).map((w) =>
        `<button type="button" data-w="${GT.esc(w)}" class="${w === f.wert ? "aktiv" : ""}">${GT.esc(w)}</button>`).join("")}</div>
        <div class="gt-feldeditor-fuss"><button type="button" data-a="leer">Leeren</button><button type="button" data-a="zu">✕</button></div>`;
      box.onclick = async (e) => {
        const b = e.target.closest("button");
        if (!b) return;
        if (b.dataset.a === "zu") return schliessen(box);
        const wert = b.dataset.a === "leer" ? "" : b.dataset.w;
        schliessen(box);
        await senden(app, obj, feld, wert);
      };
    } else {
      const mehrzeilig = obj.aufgabentyp === "freitext";
      box = panel(app, knoten, mehrzeilig ? "gross" : "");
      const eingabe = document.createElement(mehrzeilig ? "textarea" : "input");
      eingabe.className = "gt-eingabe";
      eingabe.value = f.wert || "";
      const art = GT.feldEingabeart && GT.feldEingabeart(obj, feld);
      if (art) eingabe.setAttribute("inputmode", art);
      eingabe.setAttribute("autocomplete", "off");
      eingabe.setAttribute("autocapitalize", "off");
      eingabe.setAttribute("spellcheck", "false");
      box.appendChild(eingabe);
      const fuss = document.createElement("div");
      fuss.className = "gt-feldeditor-fuss";
      fuss.innerHTML = '<button type="button" class="haupt" data-a="ok">✓ Fertig</button><button type="button" data-a="zu">✕</button>';
      box.appendChild(fuss);
      let timer, letzter = f.wert || "";
      const live = () => {
        clearTimeout(timer);
        timer = setTimeout(() => { if (eingabe.value !== letzter) { letzter = eingabe.value; senden(app, obj, feld, eingabe.value); } }, 350);
      };
      eingabe.addEventListener("input", live);
      eingabe.addEventListener("keydown", (e) => { if (e.key === "Enter" && !mehrzeilig) fuss.querySelector("[data-a=ok]").click(); });
      fuss.onclick = async (e) => {
        const b = e.target.closest("button");
        if (!b) return;
        clearTimeout(timer);
        if (b.dataset.a === "ok" && eingabe.value !== letzter) await senden(app, obj, feld, eingabe.value);
        schliessen(box);
      };
      eingabe.focus(); // synchron, damit iOS die Tastatur öffnet
    }
    if (app.rolle === "lehrer" && obj.aufgabentyp !== "freitext") {
      const extra = document.createElement("button");
      extra.type = "button";
      extra.textContent = "✓ Lösung einsetzen";
      extra.className = "gt-loesungknopf";
      extra.onclick = async () => {
        schliessen(box);
        const r = await app.emit("lehrer:loesung_einsetzen", { seite, id: obj.id, feld });
        if (!r.ok) GT.toast(r.grund, "fehler");
      };
      (box.querySelector(".gt-feldeditor-fuss") || box).prepend(extra);
    }
    nachPlatzieren(app, box);
    return true;
  };

  // ---------- Lehrkraft: prüfen, Lösung, Warnung ----------
  GT.aufgabePruefen = async (app, obj, seite) => {
    const r = await app.emit("lehrer:pruefen", { seite: seite === undefined ? app.z.aktuelle_seite : seite, id: obj.id });
    if (!r.ok) GT.toast(r.grund, "fehler");
    else GT.toast(`Geprüft: ${r.richtig} richtig, ${r.falsch} noch offen`);
    return r;
  };

  GT.alleLoesungenEinsetzen = async (app, seite) => {
    const s = app.z.seiten[seite === undefined ? app.z.aktuelle_seite : seite];
    for (const o of s.objekte.filter((x) => x.typ === "aufgabe" && x.aufgabentyp !== "freitext")) {
      await app.emit("lehrer:loesung_einsetzen", { seite: seite === undefined ? app.z.aktuelle_seite : seite, id: o.id });
    }
  };

  /** Rote (falsche) Felder auf den gegebenen Seiten zählen. */
  GT.offeneFehler = (z, nurAktuelle) => {
    let n = 0;
    (z.seiten || []).forEach((s, i) => {
      if (nurAktuelle && i !== z.aktuelle_seite) return;
      s.objekte.filter((o) => o.typ === "aufgabe").forEach((o) =>
        Object.values(o.felder || {}).forEach((f) => { if (f && f.status === "falsch") n++; }));
    });
    return n;
  };

  /** Sicherheitsnetz: „Am Ende steht nichts Falsches an der Tafel.“ Liefert true = weitermachen. */
  GT.fehlerWarnung = (app, wobei, nurAktuelle) => new Promise((ok) => {
    if (app.rolle !== "lehrer") return ok(true);
    const n = GT.offeneFehler(app.z, nurAktuelle);
    if (!n) return ok(true);
    app.dialog({
      titel: "Noch rote Felder an der Tafel",
      inhalt: `<p>${n === 1 ? "1 Feld ist" : n + " Felder sind"} noch nicht korrigiert.</p>
        <p class="gt-hinweis">Fehler sind gut – aber am Ende sollte nichts Falsches an der Tafel stehen.</p>`,
      beimSchliessen: () => ok(false),
      knoepfe: [
        { text: "Zurück und korrigieren", aktion: (api) => api.schliessen() },
        { text: "Trotzdem " + wobei, aktion: (api) => { api.el.remove(); ok(true); } },
        { text: "Lösung einsetzen und " + wobei, haupt: true, aktion: async (api) => {
          api.el.remove();
          const seiten = nurAktuelle ? [app.z.aktuelle_seite] : app.z.seiten.map((_, i) => i);
          for (const i of seiten) await GT.alleLoesungenEinsetzen(app, i);
          ok(true);
        } },
      ],
    });
  });
})();
