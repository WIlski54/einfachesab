/* Bausteine für Lehrer-Dashboard und ☰-Tafel-Steuerung. */
(function () {
  const GT = (window.GT = window.GT || {});

  GT.WERKZEUG_NAMEN = {
    auswahl: "✋ Auswählen", stift: "✏️ Stift", marker: "🖍️ Textmarker", radierer: "🧽 Radierer + Rückgängig",
    text: "🔤 Textfeld", formel: "🧪 Formel", formen: "➡️ Formen", karten: "🟨 Karten", lineal: "📏 Lineal",
    kamera: "📷 Kamera", ab_antwort: "📥 AB-Antwort", laser: "🔴 Laserpointer", zoom: "🔍 Zoomen", seiten: "📑 Blättern",
    melden: "🙋 Melden (Zuschauer)",
  };
  GT.EINSATZARTEN = { A: "✏️ A Freihand", B: "📷 B Foto", C: "📥 C AB-Antwort", D: "🟨 D Vorlage lösen" };
  GT.HINTERGRUENDE = { leer: "Kreidetafel", kariert: "kariert", liniert: "liniert", koordinaten: "Koordinaten", weiss: "Whiteboard" };

  /** Einsatzarten-Chips + Werkzeug-Schalter. `emit(ereignis, daten)` sendet an den Server. */
  GT.werkzeugSchalter = (el, z, emit) => {
    const arten = new Set(z.einsatzarten || []), werkzeuge = new Set(z.werkzeuge || []);
    el.innerHTML = `<div class="gt-chips">${Object.entries(GT.EINSATZARTEN).map(([k, t]) =>
      `<button type="button" data-art="${k}" class="gt-chip ${arten.has(k) ? "an" : ""}">${t}</button>`).join("")}</div>
      <div class="hinweis" style="margin:6px 0">Einsatzarten schalten passende Werkzeuge ein. Feinschliff:</div>
      <div class="gt-schalterliste">${Object.entries(GT.WERKZEUG_NAMEN).map(([k, t]) =>
      `<label class="schalter"><input type="checkbox" data-w="${k}" ${werkzeuge.has(k) ? "checked" : ""}>${t}</label>`).join("")}</div>`;
    el.onclick = (e) => {
      const art = e.target.dataset.art;
      if (!art) return;
      arten.has(art) ? arten.delete(art) : arten.add(art);
      emit("lehrer:einstellungen", { einsatzarten: [...arten] });
    };
    el.onchange = (e) => {
      const w = e.target.dataset.w;
      if (!w) return;
      e.target.checked ? werkzeuge.add(w) : werkzeuge.delete(w);
      emit("lehrer:einstellungen", { werkzeuge: [...werkzeuge] });
    };
  };

  GT.hintergrundWahl = (el, aktuell, beiWahl) => {
    el.innerHTML = Object.entries(GT.HINTERGRUENDE).map(([k, t]) =>
      `<button type="button" class="gt-hg gt-hg-${k} ${k === aktuell ? "an" : ""}" data-hg="${k}" title="${t}"><span>${t}</span></button>`).join("");
    el.onclick = (e) => { const b = e.target.closest("[data-hg]"); if (b) beiWahl(b.dataset.hg); };
  };

  // ---------- Sichern ----------
  function herunterladen(url, name) {
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  }

  function datum() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}_${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
  }

  GT.tafelbildPng = async (z) => {
    const url = await GT.Buehne.exportieren(z.seiten[z.aktuelle_seite], 1.4, undefined, undefined, z.datum, z.ueberschrift);
    herunterladen(url, `Tafelbild_${datum()}.png`);
    return url;
  };

  GT.tafelbildPdf = async (z, { speichern = true } = {}) => {
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: "landscape", unit: "px", format: [1500, 1000], hotfixes: ["px_scaling"] });
    for (let i = 0; i < z.seiten.length; i++) {
      if (i > 0) pdf.addPage([1500, 1000], "landscape");
      const url = await GT.Buehne.exportieren(z.seiten[i], 1.2, "image/jpeg", 0.82, z.datum, z.ueberschrift);
      pdf.addImage(url, "JPEG", 0, 0, 1500, 1000);
    }
    const blob = pdf.output("blob");
    if (speichern) herunterladen(URL.createObjectURL(blob), `Tafelbild_${datum()}.pdf`);
    return blob;
  };

  GT.tafelbildTeilen = async (blob) => {
    const fd = new FormData();
    fd.append("datei", blob, "tafelbild.pdf");
    return GT.api("POST", "/tafel/api/tafelbild", fd);
  };

  /** ⏹ Beenden mit Nachfrage „Tafelbild sichern?“ */
  GT.tafelBeenden = async (app, danach) => {
    if (GT.fehlerWarnung && !(await GT.fehlerWarnung(app, "beenden"))) return;
    const z = app.z;
    const beenden = async () => { await app.emit("lehrer:modus", { modus: "aus" }); danach && danach(); };
    app.dialog({
      titel: "Tafel beenden",
      inhalt: `<p>Alle Schüler-iPads kehren zum Arbeitsblatt zurück.</p><p><b>Tafelbild vorher sichern?</b></p>
        ${z.tafelbild_an_alle ? '<p class="gt-hinweis">📤 Das Tafelbild wird zusätzlich an alle Schüler geschickt (Einstellung im Dashboard).</p>' : ""}`,
      knoepfe: [
        { text: "Ohne Sichern beenden", aktion: async (api) => { api.schliessen(); await beenden(); } },
        { text: "💾 Sichern & beenden", haupt: true, aktion: async (api) => {
          api.knopf("💾 Sichern & beenden").textContent = "Sichert …";
          try {
            const blob = await GT.tafelbildPdf(z);
            if (z.tafelbild_an_alle) await GT.tafelbildTeilen(blob);
          } catch (e) { GT.toast("Sichern fehlgeschlagen: " + e.message, "fehler"); }
          api.schliessen();
          await beenden();
        } },
      ],
    });
  };

  /** Überblick je AB-Aufgabe: jetzt an der Tafel (aktuelle/andere Seite), geprüft, bearbeitet, war dran. */
  GT.aufgabenStatus = (z) => {
    const verlauf = z.aufgaben_verlauf || {};
    const jetzt = {};
    (z.seiten || []).forEach((s, i) => s.objekte.filter((o) => o.typ === "aufgabe").forEach((o) => {
      (jetzt[String(o.aufgabe_id)] = jetzt[String(o.aufgabe_id)] || []).push({ seite: i, o });
    }));
    const ids = new Set([...Object.keys(verlauf), ...Object.keys(jetzt)]);
    const ergebnis = {};
    ids.forEach((aid) => {
      const v = verlauf[aid] || {}, j = jetzt[aid] || [];
      const niveaus = [...new Set([...(v.niveaus || []), ...j.map((x) => x.o.niveau).filter(Boolean)])];
      const nv = niveaus.length ? " (" + niveaus.join(", ") + ")" : "";
      const bearbeitet = v.bearbeitet || j.some((x) => Object.values(x.o.felder || {}).some((f) => f && f.wert));
      const geprueft = v.geprueft || j.some((x) => x.o.geprueft);
      let text, klasse;
      if (j.some((x) => x.seite === z.aktuelle_seite)) { text = "🟢 an der Tafel" + nv; klasse = "jetzt"; }
      else if (j.length) { text = "📑 auf Seite " + (j[0].seite + 1) + nv; klasse = "jetzt anders"; }
      else if (geprueft) { text = "✔ geprüft" + nv; klasse = "fertig"; }
      else if (bearbeitet) { text = "✎ bearbeitet" + nv; klasse = "fertig"; }
      else { text = "↺ war dran" + nv; klasse = "war"; }
      ergebnis[aid] = { text, klasse, niveaus };
    });
    return ergebnis;
  };

  // ---------- Vorlage hochladen (Bild oder PDF mit Seitenauswahl) ----------
  function pdfjsLaden() {
    return new Promise((ok, fehler) => {
      if (window.pdfjsLib) return ok(window.pdfjsLib);
      const s = document.createElement("script");
      s.src = GT.pdfjsUrl || "/static/vendor/pdf.min.js";
      s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = GT.pdfjsWorkerUrl || "/static/vendor/pdf.worker.min.js"; ok(window.pdfjsLib); };
      s.onerror = fehler;
      document.head.appendChild(s);
    });
  }

  async function vorlageHochladen(canvas) {
    const blob = await new Promise((ok) => canvas.toBlob(ok, "image/jpeg", 0.88));
    const fd = new FormData();
    fd.append("datei", blob, "vorlage.jpg");
    return (await GT.api("POST", "/tafel/api/vorlage", fd)).url;
  }

  /** Erste Vorlage auf die aktuelle Seite (wenn leer), weitere als neue Seiten. */
  GT.vorlagenSetzen = async (emit, z, urls) => {
    const s = z.seiten[z.aktuelle_seite];
    let rest = urls;
    if (!s.vorlage_url && s.objekte.length === 0) { await emit("lehrer:vorlage", { seite: z.aktuelle_seite, url: urls[0] }); rest = urls.slice(1); }
    for (const url of rest) await emit("lehrer:seite_neu", { vorlage_url: url, wechseln: false });
    GT.toast(urls.length === 1 ? "Vorlage ist auf der Tafel." : urls.length + " Vorlagen-Seiten angelegt.");
  };

  GT.vorlageDialog = (app) => {
    const eingabe = document.createElement("input");
    eingabe.type = "file";
    eingabe.accept = "image/*,application/pdf";
    eingabe.onchange = async () => {
      const datei = eingabe.files[0];
      if (!datei) return;
      const emit = (e, d) => app.emit(e, d);
      try {
        if (datei.type === "application/pdf" || datei.name.toLowerCase().endsWith(".pdf")) {
          const pdf = await (await pdfjsLaden()).getDocument({ data: await datei.arrayBuffer() }).promise;
          const gewaehlt = new Set([1]);
          const inhalt = document.createElement("div");
          inhalt.innerHTML = `<div class="gt-hinweis">Welche Seiten? Jede wird eine eigene Tafelseite (${pdf.numPages} Seiten).</div><div class="gt-pdfseiten"></div>`;
          const d = app.dialog({ titel: "📄 PDF als Vorlage", inhalt, breit: true, knoepfe: [{ text: "Übernehmen", name: "ok", haupt: true, aktion: async (api) => {
            api.knopf("ok").disabled = true; api.knopf("ok").textContent = "Wird vorbereitet …";
            const urls = [];
            for (const n of [...gewaehlt].sort((a, b) => a - b)) {
              const seite = await pdf.getPage(n);
              const vp = seite.getViewport({ scale: 2000 / seite.getViewport({ scale: 1 }).width });
              const c = document.createElement("canvas");
              c.width = vp.width; c.height = vp.height;
              const ctx = c.getContext("2d");
              ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
              await seite.render({ canvasContext: ctx, viewport: vp }).promise;
              urls.push(await vorlageHochladen(c));
            }
            api.schliessen();
            if (urls.length) await GT.vorlagenSetzen(emit, app.z, urls);
          } }] });
          for (let n = 1; n <= Math.min(pdf.numPages, 30); n++) {
            const seite = await pdf.getPage(n);
            const vp = seite.getViewport({ scale: 110 / seite.getViewport({ scale: 1 }).width });
            const c = document.createElement("canvas");
            c.width = vp.width; c.height = vp.height;
            await seite.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
            const kachel = document.createElement("div");
            kachel.className = "gt-pdfseite" + (gewaehlt.has(n) ? " an" : "");
            kachel.appendChild(c);
            kachel.onclick = () => { gewaehlt.has(n) ? gewaehlt.delete(n) : gewaehlt.add(n); kachel.classList.toggle("an"); };
            d.inhalt.querySelector(".gt-pdfseiten").appendChild(kachel);
          }
        } else {
          const url = URL.createObjectURL(datei);
          const img = await GT.ladeBild(url);
          const s = Math.min(1, 2400 / Math.max(img.width, img.height));
          const c = document.createElement("canvas");
          c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
          const ctx = c.getContext("2d");
          ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
          ctx.drawImage(img, 0, 0, c.width, c.height);
          await GT.vorlagenSetzen(emit, app.z, [await vorlageHochladen(c)]);
        }
      } catch (err) { GT.toast("Vorlage: " + (err.message || err), "fehler"); }
    };
    eingabe.click();
  };

  // ---------- ☰-Leiste auf der Lehrer-Tafel ----------
  GT.LehrerLeiste = class {
    constructor(el, app) {
      this.el = el;
      this.app = app;
      this.schueler = [];
      this.angebote = [];
      this.offen = new Set();
      this.aufgabenCache = {};
      this.anonym = false;
      this.aufgabenListe = null;
      el.addEventListener("click", (e) => this.klick(e));
      // Überschrift: Tippen genügt – kurz nach der letzten Taste (oder mit Enter) steht sie an der Tafel.
      let ueTimer = null;
      const ueSenden = (text) => {
        clearTimeout(ueTimer);
        this.app.emit("lehrer:ueberschrift", { text });
      };
      el.addEventListener("input", (e) => {
        if (e.target.id !== "gt-ueberschrift") return;
        clearTimeout(ueTimer);
        ueTimer = setTimeout(() => ueSenden(e.target.value), 600);
      });
      el.addEventListener("keydown", (e) => {
        if (e.target.id === "gt-ueberschrift" && e.key === "Enter") { e.preventDefault(); ueSenden(e.target.value); e.target.blur(); }
      });
      el.addEventListener("focusout", (e) => {
        // Beim Neuzeichnen der Leiste verschwindet das Feld – das ist kein Verlassen durch die Lehrkraft.
        if (e.target.id === "gt-ueberschrift" && e.target.isConnected && e.target.value !== (this.app.z.ueberschrift || "")) ueSenden(e.target.value);
      });
      this.ueberschriftLoeschen = () => { clearTimeout(ueTimer); ueSenden(""); };
      el.addEventListener("change", (e) => {
        if (e.target.id === "gt-anonym") this.anonym = e.target.checked;
        if (e.target.dataset.opt) this.app.emit("lehrer:einstellungen", { [e.target.dataset.opt]: e.target.checked });
      });
    }

    zeichnen() {
      const z = this.app.z;
      if (!z || !z.seiten) return;
      const liste = [...this.schueler].sort((a, b) => (b.vorne - a.vorne) || (b.gemeldet - a.gemeldet) || (b.online - a.online) || a.name.localeCompare(b.name));
      const modusKnoepfe = z.modus === "live"
        ? '<button class="knopf rot klein" data-a="beenden">⏹ Beenden</button>'
        : '<button class="knopf gruen klein" data-a="starten">▶ Für Klasse starten</button>';
      const offenWerkzeuge = this.werkzeugeOffen ? "an" : "";
      // Wird gerade die Überschrift getippt, darf das Neuzeichnen sie nicht zurücksetzen.
      const ue = this.el.querySelector("#gt-ueberschrift");
      const ueFokus = ue && document.activeElement === ue ? { wert: ue.value, a: ue.selectionStart, b: ue.selectionEnd } : null;
      this.el.innerHTML = `
        <div class="ll-kopf"><b>Tafel-Steuerung</b>${modusKnoepfe}</div>
        <div class="ll-abschnitt"><div class="ll-titel">An die Tafel <label class="schalter klein"><input type="checkbox" id="gt-anonym" ${this.anonym ? "checked" : ""}>Antworten anonym</label></div>
          ${liste.length ? liste.map((s) => this.schuelerZeile(s)).join("") : '<div class="hinweis">Noch niemand angemeldet.</div>'}</div>
        ${this.aufgabenAbschnitt()}
        ${this.angebote.length ? `<div class="ll-abschnitt"><div class="ll-titel">🙋 Möchten vorstellen</div>${this.angebote.map((a) =>
          `<div class="ll-zeile"><span><b>${GT.esc(a.name)}</b> · ${GT.esc(a.titel)}</span><span><button class="knopf gruen klein" data-a="angebot" data-id="${a.id}">＋ an Tafel</button>
           <button class="knopf hell klein" data-a="angebot-weg" data-id="${a.id}">✕</button></span></div>`).join("")}</div>` : ""}
        <div class="ll-abschnitt"><div class="ll-titel">Tafel</div>
          <div class="ll-ueberschrift"><input id="gt-ueberschrift" type="text" maxlength="120" autocomplete="off"
              placeholder="Überschrift der Tafel (bleibt beim Leeren)" value="${GT.esc(z.ueberschrift || "")}" aria-label="Überschrift der Tafel">
            <button class="knopf hell klein" data-a="ueberschrift-weg" title="Überschrift löschen" ${z.ueberschrift ? "" : "disabled"}>✕</button></div>
          <div class="ll-knoepfe">
            <button class="knopf klein hell" data-a="merken" title="Diesen Moment für den Rückblick festhalten">⭐ Merken</button>
            <button class="knopf klein ${z.eingefroren ? "gruen" : "hell"}" data-a="einfrieren">🧊 ${z.eingefroren ? "Stifte wieder frei" : "Stifte weg!"}</button>
            <button class="knopf hell klein" data-a="leeren">🧹 Seite leeren</button>
            <button class="knopf hell klein" data-a="leeren-alle">🧹 Alles leeren</button>
            <button class="knopf hell klein" data-a="seite-neu">📑 Neue Seite</button>
            ${z.seiten.length > 1 ? '<button class="knopf hell klein" data-a="seite-weg">🗑 Seite löschen</button>' : ""}
            <button class="knopf hell klein" data-a="png">💾 Bild (Seite)</button>
            <button class="knopf hell klein" data-a="pdf">💾 PDF (alle Seiten)</button>
          </div>
          <div class="ll-titel" style="margin-top:8px">Hintergrund dieser Seite</div><div class="gt-hgwahl"></div>
          <div class="ll-knoepfe"><button class="knopf hell klein" data-a="vorlage">📄 Vorlage (Bild/PDF)</button></div>
          <label class="schalter klein"><input type="checkbox" data-opt="datum_zeigen" ${z.datum_zeigen !== false ? "checked" : ""}>Datum oben links zeigen</label>
          <label class="schalter klein"><input type="checkbox" data-opt="farbe_pro_schueler" ${z.farbe_pro_schueler ? "checked" : ""}>Farbe + Namensschild pro Schüler</label>
          <label class="schalter klein"><input type="checkbox" data-opt="tafelbild_an_alle" ${z.tafelbild_an_alle ? "checked" : ""}>Tafelbild beim Beenden an alle schicken</label>
          <button class="knopf hell klein ${offenWerkzeuge}" data-a="werkzeuge" style="margin-top:8px">🛠️ Werkzeuge der Schüler ${this.werkzeugeOffen ? "▴" : "▾"}</button>
          <div class="ll-werkzeuge" ${this.werkzeugeOffen ? "" : "hidden"}></div>
        </div>
        <div class="ll-knoepfe"><a class="knopf hell klein" href="${GT.link(GT.pfade.dashboard)}">← Dashboard</a>
          <a class="knopf hell klein" href="${GT.link(GT.pfade.rueckblick)}" target="_blank">📖 Rückblick (${z.momente_anzahl || 0})</a></div>`;
      if (ueFokus) {
        const neu = this.el.querySelector("#gt-ueberschrift");
        neu.value = ueFokus.wert;
        neu.focus();
        try { neu.setSelectionRange(ueFokus.a, ueFokus.b); } catch (e) { /* egal */ }
      }
      GT.hintergrundWahl(this.el.querySelector(".gt-hgwahl"), z.seiten[z.aktuelle_seite].hintergrund,
        (art) => this.app.emit("lehrer:hintergrund", { seite: z.aktuelle_seite, art }));
      if (this.werkzeugeOffen) GT.werkzeugSchalter(this.el.querySelector(".ll-werkzeuge"), z, (e, d) => this.app.emit(e, d));
    }

    aufgabenAbschnitt() {
      const z = this.app.z;
      const aufSeite = z.seiten[z.aktuelle_seite].objekte.filter((o) => o.typ === "aufgabe");
      let html = `<div class="ll-abschnitt"><div class="ll-titel">📋 Aufgabe an die Tafel
        <button class="knopf hell klein" data-a="aufgabenliste">${this.aufgabenOffen ? "▴" : "▾"}</button></div>`;
      if (this.aufgabenOffen) {
        const status = GT.aufgabenStatus(z);
        html += '<div class="ll-legende">🟢 an der Tafel · ✔ geprüft · ✎ bearbeitet · ↺ war dran</div>';
        html += !this.aufgabenListe ? '<div class="hinweis">lädt …</div>' : this.aufgabenListe.map((a) => {
          const st = status[String(a.aufgabe_id)];
          const marke = st ? `<span class="ll-marke ${st.klasse}">${GT.esc(st.text)}</span>` : "";
          return `<div class="ll-aufgabe-zeile ${st ? st.klasse : ""}"><div class="ll-aufgabe-titel">${GT.esc(a.titel)}${marke}</div>
            <div class="ll-niveaus">${a.niveaus.map((n) =>
              `<button class="knopf klein ${n === a.vorschlag ? "gruen" : "hell"}${st && st.niveaus.includes(n) ? " benutzt" : ""}" data-a="aufgabe-holen"
                 data-aufgabe="${GT.esc(a.aufgabe_id)}" data-niveau="${n}" title="Niveau ${n}${n === a.vorschlag ? " (Niveau des Schülers)" : ""}${st && st.niveaus.includes(n) ? " – schon an der Tafel" : ""}">${n}</button>`).join("")}</div></div>`;
        }).join("");
      }
      aufSeite.forEach((o) => {
        const felder = Object.values(o.felder || {});
        const rot = felder.filter((f) => f && f.status === "falsch").length;
        const pruefbar = o.aufgabentyp !== "freitext";
        html += `<div class="ll-aufgabe"><span>${GT.esc(o.titel)} · ${o.niveau}${rot ? ` <span class="marke" style="background:#fcebeb;color:#791f1f">${rot} rot</span>` : ""}</span>
          <span>${pruefbar ? `<button class="knopf klein gruen" data-a="pruefen" data-id="${o.id}">✓ Prüfen</button>
          <button class="knopf klein hell" data-a="loesung" data-id="${o.id}">Lösung</button>` : '<span class="hinweis">Freitext: besprechen</span>'}</span></div>`;
      });
      return html + "</div>";
    }

    schuelerZeile(s) {
      const eingabe = (this.app.z.eingabe || {})[s.id] || "tastatur";
      const knopf = s.vorne
        ? `<button class="knopf hell klein" data-a="eingabe" data-id="${s.id}" data-eingabe="${eingabe === "wortbank" ? "tastatur" : "wortbank"}"
             title="Eingabe für Aufgaben umschalten">${eingabe === "wortbank" ? "🔤" : "⌨"}</button>
           <button class="knopf rot klein" data-a="abziehen" data-id="${s.id}">✕</button>`
        : `<button class="knopf ${s.gemeldet ? "gruen" : "hell"} klein" data-a="zuschalten" data-id="${s.id}" data-eingabe="tastatur" title="An die Tafel – mit Tastatur">＋ ⌨</button>
           <button class="knopf ${s.gemeldet ? "gruen" : "hell"} klein" data-a="zuschalten" data-id="${s.id}" data-eingabe="wortbank" title="An die Tafel – mit Wortbank">＋ 🔤</button>`;
      const offen = this.offen.has(s.id);
      const aufgaben = offen ? (this.aufgabenCache[s.id] || null) : null;
      let unter = "";
      if (offen) {
        unter = !aufgaben ? '<div class="hinweis">lädt …</div>' : aufgaben.map((a) =>
          `<div class="ll-aufgabe"><span>${GT.esc(a.titel)}</span>${a.bearbeitet
            ? `<button class="knopf klein hell" data-a="ab-antwort" data-id="${s.id}" data-aufgabe="${GT.esc(a.aufgabe_id)}">📥 an Tafel</button>`
            : '<span class="marke grau">leer</span>'}</div>`).join("");
      }
      return `<div class="ll-zeile ${s.online ? "" : "offline"}">
          <span>${s.vorne ? "🟢" : s.online ? "⚪" : "⚫"} <b>${GT.esc(s.name)}</b> ${s.gemeldet ? '<span class="marke gelb">🙋</span>' : ""}</span>
          <span><button class="knopf hell klein" data-a="aufgaben" data-id="${s.id}" title="Aufgaben ansehen">${offen ? "▴" : "▾"}</button> ${knopf}</span>
        </div>${offen ? `<div class="ll-unter">${unter}</div>` : ""}`;
    }

    async klick(e) {
      const b = e.target.closest("[data-a]");
      if (!b) return;
      const a = b.dataset.a, id = b.dataset.id, app = this.app, z = app.z;
      const senden = async (ereignis, daten) => { const r = await app.emit(ereignis, daten); if (!r.ok) GT.toast(r.grund || "Fehler", "fehler"); return r; };
      if (a === "starten") senden("lehrer:modus", { modus: "live" });
      if (a === "beenden") GT.tafelBeenden(app, () => (location.href = GT.link(GT.pfade.dashboard)));
      if (a === "zuschalten") senden("lehrer:zuschalten", { schueler_id: id, eingabe: b.dataset.eingabe || "tastatur" });
      if (a === "eingabe") senden("lehrer:eingabe", { schueler_id: id, eingabe: b.dataset.eingabe });
      if (a === "ueberschrift-weg") this.ueberschriftLoeschen();
      if (a === "merken") senden("lehrer:merken").then((r) => r.ok && GT.toast(r.id ? "⭐ Moment gemerkt" : "Die Tafel ist leer – nichts zu merken."));
      if (a === "aufgabenliste") {
        this.aufgabenOffen = !this.aufgabenOffen;
        if (this.aufgabenOffen) (GT.abAdapter ? GT.abAdapter.aufgaben(this.app.z.am_brett || []).then((l) => ({ aufgaben: l }))
          : GT.api("GET", "/tafel/api/lehrer/aufgaben")).then((d) => { this.aufgabenListe = d.aufgaben; this.zeichnen(); })
          .catch((err) => GT.toast(err.message, "fehler"));
        this.zeichnen();
      }
      if (a === "aufgabe-holen") {
        const m = app.buehne.mitte();
        const daten = { aufgabe_id: b.dataset.aufgabe, niveau: b.dataset.niveau,
          x: Math.round(m.x - 320), y: Math.round(Math.max(20, m.y - 300)) };
        if (GT.abAdapter) Object.assign(daten, await GT.abAdapter.leer(b.dataset.aufgabe, b.dataset.niveau));
        senden("lehrer:aufgabe_holen", daten);
      }
      if (a === "pruefen") { const o = app.objekt(id); if (o) GT.aufgabePruefen(app, o); }
      if (a === "loesung") senden("lehrer:loesung_einsetzen", { seite: z.aktuelle_seite, id });
      if (a === "abziehen") senden("lehrer:abziehen", { schueler_id: id });
      if (a === "angebot") senden("lehrer:angebot_annehmen", { angebot_id: id });
      if (a === "angebot-weg") senden("lehrer:angebot_ablehnen", { angebot_id: id });
      if (a === "einfrieren") senden("lehrer:einfrieren", { an: !z.eingefroren });
      if (a === "leeren" && confirm("Diese Seite leeren?")) senden("lehrer:leeren", { alle: false });
      if (a === "leeren-alle" && confirm("Alle Seiten leeren?")) senden("lehrer:leeren", { alle: true });
      if (a === "seite-neu") senden("lehrer:seite_neu", {});
      if (a === "seite-weg" && confirm("Diese Seite löschen?")) senden("lehrer:seite_loeschen", { index: z.aktuelle_seite });
      if ((a === "png" || a === "pdf") && (await GT.fehlerWarnung(app, "sichern", a === "png"))) {
        (a === "png" ? GT.tafelbildPng(app.z) : GT.tafelbildPdf(app.z)).catch((err) => GT.toast(err.message, "fehler"));
      }
      if (a === "werkzeuge") { this.werkzeugeOffen = !this.werkzeugeOffen; this.zeichnen(); }
      if (a === "vorlage") GT.vorlageDialog(app);
      if (a === "aufgaben") {
        if (this.offen.has(id)) this.offen.delete(id);
        else {
          this.offen.add(id);
          (GT.abAdapter ? GT.abAdapter.aufgabenVon(id).then((l) => ({ aufgaben: l }))
            : GT.api("GET", `/tafel/api/lehrer/schueler/${id}/aufgaben`)).then((d) => { this.aufgabenCache[id] = d.aufgaben; this.zeichnen(); })
            .catch((err) => GT.toast(err.message, "fehler"));
        }
        this.zeichnen();
      }
      if (a === "ab-antwort") {
        const m = app.buehne.mitte();
        const eintrag = (this.aufgabenCache[id] || []).find((x) => String(x.aufgabe_id) === b.dataset.aufgabe);
        senden("lehrer:ab_antwort", { schueler_id: id, aufgabe_id: b.dataset.aufgabe, anonym: this.anonym,
          x: Math.round(m.x - 290), y: Math.round(m.y - 150), karte: GT.abAdapter && eintrag ? GT.karteAus(eintrag) : undefined });
      }
    }
  };
})();
