/* Die Tafel im Browser: Verbindung, Zustand, Werkzeuge, Live-Anzeigen. */
(function () {
  const GT = (window.GT = window.GT || {});
  GT.werkzeuge = GT.werkzeuge || {};
  GT.registriere = (id, def) => { GT.werkzeuge[id] = Object.assign({ id }, def); };

  const STATUS_TEXT = {
    formel: "tippt eine Formel …", foto: "macht ein Foto …", ab_antwort: "sucht eine Aufgabe aus …",
    text: "schreibt einen Text …", karte: "beschriftet eine Karte …",
  };

  /** Elemente der Gastseite, die die Statuszeile nicht verdecken darf (z. B. Knöpfe und Leiste der Lehrkraft). */
  GT.pillHindernisse = GT.pillHindernisse || [".lehrer-knoepfe", ".lehrer-leiste"];

  class TafelApp {
    constructor(el, { rolle }) {
      this.el = el;
      this.rolle = rolle; // "lehrer" | "schueler" | "beamer"
      this.z = { modus: "aus", version: 0, am_brett: [], sperren: {} };
      this.version = 0;
      this.ausstehend = 0;
      this.rechte = { werkzeuge: [], am_brett: false };
      this.verbunden = false;
      this.werkzeug = null;
      this.leisteGewuenscht = rolle !== "lehrer"; // Lehrer blendet die Leiste per ✏️ ein
      this.opt = {
        stift: { farbe: 0, staerke: 2 }, marker: { farbe: 1, staerke: 2 },
        formen: { art: "pfeil", farbe: 1, staerke: 2 }, text: { farbe: 0, groesse: 40 },
        karten: { kartenfarbe: "gelb" }, formel: { farbe: 0 },
      };
      this.fremd = new Map();     // live Striche anderer
      this.namen = new Map();     // Namensschilder
      this.zeiger = new Map();    // aktive Pointer (für Zwei-Finger-Zoom)
      this.lineal = { sichtbar: false, x: 400, y: 450, winkel: 0 };
      this.stiftZuletzt = 0;
      this._bauen();
      this.buehne = new GT.Buehne(this.flaeche);
      // Öffnet/schließt die Lehrkraft ihre Leiste, weicht die Statuszeile aus.
      setTimeout(() => document.querySelectorAll(GT.pillHindernisse.join(",")).forEach((h) =>
        new MutationObserver(() => this.pillPlatzieren()).observe(h, { attributes: true, attributeFilter: ["hidden", "class", "style"] })), 0);
      this.buehne.onGroesse = () => {
        this.auswahlMenuePositionieren && this.auswahlMenuePositionieren();
        this.pillPlatzieren();
      };
      this._zeigerEreignisse();
      if (GT.leisteInit) GT.leisteInit(this);
    }

    // ---------- DOM ----------
    _bauen() {
      this.el.classList.add("gt-tafel");
      this.el.innerHTML = `
        <div class="gt-flaeche"></div>
        <div class="gt-leiste" hidden></div>
        <div class="gt-optionen" hidden></div>
        <div class="gt-pill"><span class="gt-pill-text"></span><span class="gt-pill-status"></span></div>
        <div class="gt-seiten" hidden></div>
        <div class="gt-zoom" hidden>
          <button data-z="+" title="Vergrößern">＋</button><button data-z="-" title="Verkleinern">－</button><button data-z="0" title="Ganze Tafel">⤢</button>
        </div>
        <button class="gt-melden" hidden>🙋 Melden</button>
        <div class="gt-banner" hidden>Verbindung unterbrochen … wird neu verbunden</div>
        <div class="gt-auswahlmenue" hidden></div>
        <div class="gt-dialoge"></div>`;
      const q = (s) => this.el.querySelector(s);
      this.flaeche = q(".gt-flaeche");
      this.leiste = q(".gt-leiste");
      this.optionen = q(".gt-optionen");
      this.pillText = q(".gt-pill-text");
      this.pillStatus = q(".gt-pill-status");
      this.seitenNav = q(".gt-seiten");
      this.zoomNav = q(".gt-zoom");
      this.meldenKnopf = q(".gt-melden");
      this.banner = q(".gt-banner");
      this.auswahlMenue = q(".gt-auswahlmenue");
      this.dialoge = q(".gt-dialoge");
      this.zoomNav.addEventListener("click", (e) => {
        const z = e.target.dataset.z;
        if (!z) return;
        const a = this.buehne.ansicht, m = this.buehne.mitte();
        const neu = z === "0" ? 1 : Math.min(4, Math.max(1, a.zoom * (z === "+" ? 1.4 : 1 / 1.4)));
        this.ansichtSenden({ zoom: neu, x: m.x - GT.TAFEL.B / neu / 2, y: m.y - GT.TAFEL.H / neu / 2 }, true);
      });
      this.meldenKnopf.addEventListener("click", () => {
        this.socket.emit("tafel:melden", { an: !this.rechte.gemeldet });
      });
    }

    // ---------- Verbindung ----------
    starten() {
      this.socket = GT.verbindung();
      const s = this.socket;
      s.on("connect", () => { this.verbunden = true; this.ausstehend = 0; this.banner.hidden = true; this.oberflaeche(); });
      s.on("disconnect", () => {
        this.verbunden = false; this.banner.hidden = false;
        this.werkzeugAbbrechen(); this.oberflaeche();
      });
      s.on("connect_error", (e) => {
        this.banner.hidden = false;
        if (String(e && e.message).toLowerCase().includes("rejected")) GT.abmelden();
      });
      s.on("tafel:zustand", (d) => this.zustand(d));
      s.on("tafel:meta", (d) => this.meta(d));
      s.on("tafel:op", (o) => this.opEmpfangen(o));
      s.on("tafel:rechte", (r) => this.rechteSetzen(r));
      s.on("tafel:ansicht", (a) => {
        this.buehne.ansichtSetzen(a);
        this.z.ansicht = a;
        this.version = Math.max(this.version, a.version || 0);
      });
      s.on("tafel:sperre", (d) => {
        if (d.name) this.z.sperren[d.id] = d.name; else delete this.z.sperren[d.id];
        if (d.name && this.auswahlId === d.id) this.abwaehlen();
      });
      s.on("tafel:live_strich", (d) => this.fremdStrich(d));
      s.on("tafel:laser", (d) => { (d.punkte || []).forEach((p) => this.laserPunkt(p[0], p[1])); this.namensschild(d); });
      s.on("tafel:form_vorschau", (d) => this.fremdForm(d));
      s.on("tafel:feld_sperre", (d) => {
        const m = (GT.feldSperren[d.id] = GT.feldSperren[d.id] || {});
        if (d.name) m[d.feld] = d.name; else delete m[d.feld];
        this.buehne.neuZeichnen(d.id);
        if (this.auswahlId === d.id) this.auswahlAuffrischen();
      });
      s.on("tafel:bewegen", (d) => {
        const g = d.seite === this.z.aktuelle_seite && this.buehne.knoten.get(d.id);
        if (g) { g.position({ x: d.x, y: d.y }); this.buehne.obj.batchDraw(); }
      });
      s.on("tafel:lineal", (d) => { this.lineal = Object.assign(this.lineal, d); this.linealZeichnen(); });
      s.on("tafel:status", (d) => this.fremdStatus(d));
      s.on("tafel:abgelehnt", (d) => GT.toast(d.grund, "fehler"));
      if (this.onSocket) this.onSocket(s);
    }

    zustandAnfordern() { this.socket && this.socket.emit("tafel:zustand_anfordern", {}); }

    // ---------- Zustand ----------
    zustand(d) {
      const seiteVorher = this.z.aktuelle_seite;
      this.z = Object.assign({ sperren: {} }, d);
      this.version = d.version;
      GT.feldSperrenSetzen && GT.feldSperrenSetzen(d.feld_sperren);
      this.buehne._datum = d.datum || null; // Kopfzeile zeichnet seiteZeigen mit
      this.buehne._ueberschrift = d.ueberschrift || "";
      if (d.seiten) this.seiteZeigen();
      else this.buehne.kopfSetzen(d.datum, d.ueberschrift);
      this.pillPlatzieren();
      this.oberflaeche();
      this.onZustand && this.onZustand(this.z);
    }

    meta(d) {
      const seiteVorher = this.z.aktuelle_seite;
      const seiten = this.z.seiten;
      this.z = Object.assign({}, this.z, d, { seiten });
      this.version = Math.max(this.version, d.version || 0);
      if (d.feld_sperren && GT.feldSperrenSetzen) GT.feldSperrenSetzen(d.feld_sperren);
      if (!seiten && d.modus === "live") this.zustandAnfordern();
      else if (seiten && d.aktuelle_seite !== seiteVorher) this.seiteZeigen();
      if (d.ansicht) this.buehne.ansichtSetzen(d.ansicht);
      if ("datum" in d || "ueberschrift" in d) { this.buehne.kopfSetzen(this.z.datum, this.z.ueberschrift); this.pillPlatzieren(); }
      this.oberflaeche();
      this.onZustand && this.onZustand(this.z);
    }

    seite() { return this.z.seiten && this.z.seiten[this.z.aktuelle_seite]; }

    /** Statuszeile („Niemand an der Tafel“ …) ganz rechts am oberen Rand der Tafel, in der Zeile von Datum
        und Überschrift. Stößt sie an die Überschrift, rutscht sie rechts darunter. Knöpfe und Leiste der
        Lehrkraft (GT.pillHindernisse) verdeckt sie nie – sie weicht nach links aus. */
    pillPlatzieren() {
      const pill = this.el.querySelector(".gt-pill");
      if (!pill || !this.buehne) return;
      const k = this.buehne.kopfRahmen();
      const f = this.flaeche.getBoundingClientRect(), e = this.el.getBoundingClientRect();
      const dx = f.left - e.left, dy = f.top - e.top;
      const s = k.tafel.width / GT.TAFEL.B;             // Bildschirm-Pixel je Tafel-Einheit
      pill.style.maxWidth = "none";
      const breite = pill.offsetWidth, hoehe = pill.offsetHeight;
      const zeile = k.datum ? { o: k.datum.y, h: k.datum.height } : { o: k.tafel.y + 12 * s, h: 44 * s };
      const sichtbar = { l: Math.max(k.tafel.x, 0), r: Math.min(k.tafel.x + k.tafel.width, f.width) };
      const rechtsBis = (oben) => {                     // rechter Rand, links von allem, was dort liegt
        let r = sichtbar.r - Math.max(16 * s, 8);
        for (const h of document.querySelectorAll(GT.pillHindernisse.join(","))) {
          if (h.hidden || !h.offsetWidth) continue;
          const b = h.getBoundingClientRect();
          if (b.bottom - f.top > oben - 4 && b.top - f.top < oben + hoehe + 4 && b.right - f.left > r - breite)
            r = Math.min(r, b.left - f.left - 8);
        }
        return r;
      };
      let oben = zeile.o + (zeile.h - hoehe) / 2;
      let rechts = rechtsBis(oben);
      const ueRechts = k.ueberschrift ? k.ueberschrift.x + k.ueberschrift.width + 12 : sichtbar.l;
      if (rechts - Math.min(breite, 160) < ueRechts) {   // kein Platz neben der Überschrift → darunter
        oben = zeile.o + zeile.h + 6;
        rechts = rechtsBis(oben);
      }
      const max = Math.max(120, rechts - (oben > zeile.o + zeile.h ? sichtbar.l + 8 : ueRechts));
      pill.style.maxWidth = Math.floor(max) + "px";
      pill.style.left = Math.round(Math.max(8, rechts - Math.min(breite, max)) + dx) + "px";
      pill.style.top = Math.round(Math.max(6, oben) + dy) + "px";
    }

    objekt(id) {
      const s = this.seite();
      return s ? s.objekte.find((o) => o.id === id) : null;
    }

    seiteZeigen() {
      const s = this.seite();
      if (!s) return;
      this.abwaehlen();
      this.buehne.seiteZeigen(s);
      this.buehne.ansichtSetzen(this.z.ansicht || { zoom: 1, x: 0, y: 0 });
      this.linealZeichnen();
      this.seitenNavZeigen();
    }

    // ---------- Operationen ----------
    _lokal(o) {
      const seite = this.z.seiten && this.z.seiten[o.seite];
      if (!seite) return;
      const aktuell = o.seite === this.z.aktuelle_seite;
      if (o.op === "add") {
        const i = seite.objekte.findIndex((x) => x.id === o.objekt.id);
        if (i >= 0) seite.objekte.splice(i, 1);
        const index = typeof o.index === "number" ? Math.min(o.index, seite.objekte.length) : seite.objekte.length;
        seite.objekte.splice(index, 0, o.objekt);
        if (aktuell) {
          this.buehne.objektEinfuegen(o.objekt, index);
          this.fremdEntfernen(o.objekt.id);
        }
      } else if (o.op === "update") {
        const obj = seite.objekte.find((x) => x.id === o.id);
        if (obj) Object.assign(obj, o.aenderungen);
        if (aktuell) { this.buehne.objektAendern(o.id, o.aenderungen); if (this.auswahlId === o.id) this.auswahlAuffrischen(); }
      } else if (o.op === "delete") {
        seite.objekte = seite.objekte.filter((x) => x.id !== o.id);
        if (aktuell) { if (this.auswahlId === o.id) this.abwaehlen(); this.buehne.objektEntfernen(o.id); }
      } else if (o.op === "vorne") {
        const i = seite.objekte.findIndex((x) => x.id === o.id);
        if (i >= 0) seite.objekte.push(seite.objekte.splice(i, 1)[0]);
        const g = aktuell && this.buehne.knoten.get(o.id);
        if (g) { g.moveToTop(); this.buehne.obj.batchDraw(); if (this.auswahlId === o.id) this.auswahlAuffrischen(); }
      }
    }

    opEmpfangen(o) {
      if (!this.z.seiten) return;
      if (o.version !== this.version + 1 && this.ausstehend === 0 && o.version > this.version) {
        this.version = o.version;
        this._lokal(o);
        this.zustandAnfordern(); // Lücke: vorsichtshalber alles neu holen
        return;
      }
      this.version = Math.max(this.version, o.version);
      this._lokal(o);
      this.onOp && this.onOp(o);
      if (o.objekt && this.nachEinfuegenWaehlen === o.objekt.id) {
        this.nachEinfuegenWaehlen = null;
        if (this.hat("auswahl")) { this.werkzeugWaehlen("auswahl"); this.waehlen(o.objekt.id); }
      }
    }

    /** Optimistisch lokal anwenden, dann an den Server; bei Ablehnung Zustand neu holen. */
    sende(op) {
      if (!this.verbunden) { GT.toast("Keine Verbindung.", "fehler"); return Promise.resolve({ ok: false }); }
      if (op.op === "add") op.objekt = Object.assign({ autor: this.ich(), autor_name: GT.ich ? GT.ich.name : "" }, op.objekt);
      this._lokal(op);
      this.ausstehend++;
      return new Promise((ok) => {
        this.socket.timeout(8000).emit("tafel:op", op, (fehler, antwort) => {
          this.ausstehend = Math.max(0, this.ausstehend - 1);
          if (fehler || !antwort || !antwort.ok) { this.zustandAnfordern(); ok(antwort || { ok: false }); return; }
          this.version = Math.max(this.version, antwort.version);
          const s = this.z.seiten && this.z.seiten[op.seite];
          if (op.op === "add" && s && !s.objekte.some((x) => x.id === op.objekt.id)) {
            this._lokal({ op: "add", seite: op.seite, objekt: antwort.objekt || op.objekt, index: antwort.index });
          } else if (op.op === "update" && s) {
            this._lokal(op);
          } else if (op.op === "delete" && s && s.objekte.some((x) => x.id === op.id)) {
            this._lokal(op);
          }
          ok(antwort);
        });
      });
    }

    emit(ereignis, daten) {
      return new Promise((ok) => {
        if (!this.verbunden) { GT.toast("Keine Verbindung.", "fehler"); ok({ ok: false }); return; }
        this.socket.timeout(8000).emit(ereignis, daten || {}, (fehler, a) =>
          ok(fehler ? { ok: false, grund: "Keine Antwort vom Server." } : a || { ok: false }));
      });
    }

    ich() { return this.rolle === "lehrer" ? "lehrer" : GT.ich && GT.ich.id; }

    // ---------- Rechte ----------
    rechteSetzen(r) {
      this.rechte = r;
      if (this.werkzeug && !this.hat(this.werkzeug)) this.werkzeugAbbrechen(), (this.werkzeug = null);
      if (this.auswahlId && !this.hat("auswahl")) this.abwaehlen();
      if (!this.hat("lineal") && this.linealGriff) this.linealZeichnen();
      this.oberflaeche();
    }

    /** Darf ich dieses Werkzeug gerade benutzen? */
    hat(w) {
      if (this.rolle === "beamer" || !this.verbunden) return false;
      if (this.rolle === "lehrer") return true;
      return this.z.modus === "live" && this.rechte.am_brett && !this.rechte.eingefroren
        && this.rechte.werkzeuge.includes(w);
    }

    darfBearbeiten(obj) { return this.rolle === "lehrer" || obj.autor !== "lehrer"; }

    /** Inhalt (Text, Formel, Karte) ändern darf nur, wer es geschrieben hat – und die Lehrkraft. */
    darfInhalt(obj) { return this.rolle === "lehrer" || obj.autor === this.ich(); }

    leisteSichtbar() {
      if (this.rolle === "beamer") return false;
      if (this.rolle === "lehrer") return this.leisteGewuenscht && this.verbunden;
      return this.z.modus === "live" && this.rechte.am_brett;
    }

    leisteZeigen(an) { this.leisteGewuenscht = an; this.oberflaeche(); }

    // ---------- Oberfläche ----------
    oberflaeche() {
      const leiste = this.leisteSichtbar();
      const vorher = this.el.classList.contains("mit-leiste");
      this.el.classList.toggle("mit-leiste", leiste);
      this.el.classList.toggle("eingefroren", !!this.rechte.eingefroren && this.rolle === "schueler");
      if (vorher !== leiste) setTimeout(() => this.buehne.anpassen(), 0);
      if (!leiste) { this.werkzeugAbbrechen(); this.optionen.hidden = true; }
      GT.leisteZeichnen && GT.leisteZeichnen(this, leiste);
      if (leiste && (!this.werkzeug || !this.hat(this.werkzeug))) {
        const erstes = ["stift", "auswahl", "marker", "laser", "text"].find((w) => this.hat(w));
        if (erstes) this.werkzeugWaehlen(erstes, true);
      }
      this.zoomNav.hidden = !this.hat("zoom") && this.rolle !== "lehrer";
      this.seitenNavZeigen();
      const melden = this.rolle === "schueler" && this.z.modus === "live" && !this.rechte.am_brett
        && this.rechte.werkzeuge.includes("melden");
      this.meldenKnopf.hidden = !melden;
      this.meldenKnopf.textContent = this.rechte.gemeldet ? "✋ Meldung zurückziehen" : "🙋 Melden";
      this.meldenKnopf.classList.toggle("aktiv", !!this.rechte.gemeldet);
      this.pillText.textContent = this.pillTextBerechnen();
      this.pillPlatzieren();
    }

    pillTextBerechnen() {
      const namen = (this.z.am_brett || []).map((p) => p.name);
      const liste = namen.length > 1 ? namen.slice(0, -1).join(", ") + " und " + namen[namen.length - 1] : namen[0];
      if (this.rolle === "lehrer") {
        if (this.z.modus === "vorbereitung") return "🛠️ Vorbereitung – die Klasse sieht nichts";
        if (this.z.modus !== "live") return "⏸ Tafel ist nicht gestartet";
        return (this.z.eingefroren ? "🧊 Stifte weg · " : "") + (liste ? "🟢 " + liste + " an der Tafel" : "Niemand an der Tafel");
      }
      if (this.rolle === "beamer") {
        if (this.z.eingefroren) return "🧊 Stifte weg!";
        return liste ? "✏️ " + liste + (namen.length > 1 ? " präsentieren" : " präsentiert") : "Tafel";
      }
      if (this.rechte.eingefroren) return "🧊 Stifte weg!";
      if (this.rechte.am_brett) return "✏️ Du bist an der Tafel";
      if (!liste) return "👀 Tafel";
      return "👀 " + liste + (namen.length > 1 ? " präsentieren" : " präsentiert");
    }

    seitenNavZeigen() {
      const n = (this.z.seiten || []).length;
      const darf = this.hat("seiten");
      this.seitenNav.hidden = n < 2 && !(this.rolle === "lehrer" && this.leisteSichtbar());
      const i = this.z.aktuelle_seite || 0;
      this.seitenNav.innerHTML = (darf ? `<button data-s="${i - 1}" ${i === 0 ? "disabled" : ""}>◀</button>` : "")
        + `<span>Seite ${i + 1} / ${Math.max(1, n)}</span>`
        + (darf ? `<button data-s="${i + 1}" ${i >= n - 1 ? "disabled" : ""}>▶</button>` : "");
      this.seitenNav.onclick = (e) => {
        const s = e.target.dataset.s;
        if (s === undefined) return;
        const weiter = GT.fehlerWarnung ? GT.fehlerWarnung(this, "weiterblättern", true) : Promise.resolve(true);
        weiter.then((ja) => ja && this.emit("tafel:seite", { index: Number(s) }));
      };
    }

    // ---------- Werkzeuge ----------
    werkzeugWaehlen(id, still) {
      const w = GT.werkzeuge[id];
      if (!w || !this.hat(id)) return;
      if (w.art === "aktion") { w.klick(this); return; }
      if (w.art === "schalter") { w.klick(this); GT.leisteZeichnen && GT.leisteZeichnen(this, true); return; }
      if (this.werkzeug && this.werkzeug !== id) this.werkzeugAbbrechen();
      const gleich = this.werkzeug === id;
      if (this.werkzeug !== id && GT.werkzeuge[this.werkzeug] && GT.werkzeuge[this.werkzeug].ende) GT.werkzeuge[this.werkzeug].ende(this);
      this.werkzeug = id;
      if (w.start) w.start(this);
      this.flaeche.dataset.werkzeug = id;
      GT.leisteZeichnen && GT.leisteZeichnen(this, true);
      if (GT.optionenZeigen) GT.optionenZeigen(this, still ? false : (gleich ? this.optionen.hidden : true));
    }

    werkzeugAbbrechen() {
      const w = GT.werkzeuge[this.werkzeug];
      if (w && w.abbrechen) w.abbrechen(this);
    }

    _zeigerEreignisse() {
      const stage = this.buehne.stage;
      const tafelPunkt = () => this.buehne.zeiger();
      stage.on("pointerdown", (roh) => {
        // Trefferkarte kann nach einer Änderung noch veraltet sein (Zeichnen erst im nächsten Frame) – dann jetzt zeichnen
        let e = roh;
        if (this.buehne.obj._waitingForDraw) {
          this.buehne.obj.draw();
          const pos = stage.getPointerPosition();
          const ziel = pos && stage.getIntersection(pos);
          e = Object.assign({}, roh, { target: ziel || stage });
        }
        const ev = e.evt;
        if (ev.pointerType === "pen") this.stiftZuletzt = Date.now();
        // Handballen: Solange (oder kurz nachdem) der Stift schreibt, werden Finger ignoriert
        if (ev.pointerType === "touch" && (this.stiftAktiv || Date.now() - this.stiftZuletzt < 1000)) return;
        if (ev.pointerType === "pen") this.stiftAktiv = true;
        this.zeiger.set(ev.pointerId, { x: ev.clientX, y: ev.clientY, typ: ev.pointerType });
        if (!this.optionen.hidden) this.optionen.hidden = true;
        const finger = [...this.zeiger.values()].filter((z) => z.typ === "touch").length;
        if (finger === 2 && this.zeiger.size === 2 && this.hat("zoom")) { this.werkzeugAbbrechen(); this._aktiv = null; this.pinchStarten(); return; }
        if (this.zeiger.size > 1) return;
        const feld = GT.feldVon && ev.pointerType !== "pen" && GT.feldVon(e.target);
        if (feld && GT.darfFelder(this) && this.werkzeug !== "radierer") { this.zeiger.delete(ev.pointerId); GT.feldAntippen(this, feld); return; }
        if (e.target && e.target.getAttr && e.target.getAttr("linealTeil")) return;
        const w = GT.werkzeuge[this.werkzeug];
        if (w && w.runter && this.hat(this.werkzeug)) { this._aktiv = w; w.runter(this, tafelPunkt(), ev, e); }
      });
      stage.on("pointermove", (e) => {
        const ev = e.evt;
        if (!this.zeiger.has(ev.pointerId)) return; // ignorierter Handballen oder Maus ohne Klick
        this.zeiger.set(ev.pointerId, { x: ev.clientX, y: ev.clientY, typ: ev.pointerType });
        if (this.pinch) { this.pinchBewegen(); return; }
        if (this._aktiv && this._aktiv.bewegen) this._aktiv.bewegen(this, tafelPunkt(), ev, e);
      });
      const hoch = (e) => {
        const ev = e.evt;
        if (ev.pointerType === "pen") { this.stiftAktiv = false; this.stiftZuletzt = Date.now(); }
        if (!this.zeiger.has(ev.pointerId)) return; // ignorierter Handballen
        this.zeiger.delete(ev.pointerId);
        if (this.pinch) { if (this.zeiger.size < 2) this.pinch = null; return; }
        if (this._aktiv && this._aktiv.hoch) this._aktiv.hoch(this, tafelPunkt(), ev, e);
        this._aktiv = null;
      };
      stage.on("pointerup pointercancel", hoch);
      this.flaeche.addEventListener("pointerleave", (ev) => { if (ev.pointerType === "mouse") this.zeiger.delete(ev.pointerId); });
    }

    // ---------- Zwei-Finger-Zoom ----------
    pinchStarten() {
      const [a, b] = [...this.zeiger.values()];
      const rect = this.flaeche.getBoundingClientRect();
      const mitte = { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top };
      this.pinch = { abstand: Math.hypot(a.x - b.x, a.y - b.y), ansicht: Object.assign({}, this.buehne.ansicht),
        tafelMitte: this.buehne.zuTafel(mitte) };
    }

    pinchBewegen() {
      const [a, b] = [...this.zeiger.values()];
      if (!a || !b) return;
      const rect = this.flaeche.getBoundingClientRect();
      const mitte = { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top };
      const zoom = Math.min(4, Math.max(1, this.pinch.ansicht.zoom * Math.hypot(a.x - b.x, a.y - b.y) / this.pinch.abstand));
      const { s, ox, oy } = this.buehne.basis;
      this.ansichtSenden({ zoom, x: this.pinch.tafelMitte.x - (mitte.x - ox) / (s * zoom),
        y: this.pinch.tafelMitte.y - (mitte.y - oy) / (s * zoom) });
    }

    ansichtSenden(a, sofort) {
      this.buehne.ansichtSetzen(a);
      this.z.ansicht = this.buehne.ansicht;
      clearTimeout(this._ansichtTimer);
      const senden = () => this.socket.emit("tafel:ansicht", this.buehne.ansicht);
      if (sofort) senden(); else this._ansichtTimer = setTimeout(senden, 60);
    }

    // ---------- Live: Striche anderer ----------
    fremdStrich(d) {
      if (d.seite !== undefined && d.seite !== this.z.aktuelle_seite) return;
      let f = this.fremd.get(d.strich_id);
      if (!f) {
        f = { punkte: [], knoten: new Konva.Line({ closed: true, strokeEnabled: false, listening: false }) };
        this.buehne.live.add(f.knoten);
        this.fremd.set(d.strich_id, f);
      }
      f.punkte.push(...(d.punkte || []));
      const staerken = d.marker ? GT.staerken.marker : GT.staerken.stift;
      f.knoten.setAttrs({
        points: GT.strichUmriss(f.punkte, { groesse: staerken[(d.staerke || 2) - 1], marker: d.marker, druck: d.druck }),
        fill: GT.farbe(d.farbe, this.buehne.theme), opacity: d.marker ? GT.markerDeckkraft(this.buehne.theme) : 1,
      });
      clearTimeout(f.timer);
      f.timer = setTimeout(() => this.fremdEntfernen(d.strich_id), 5000);
      this.buehne.live.batchDraw();
      const letzter = f.punkte[f.punkte.length - 1];
      if (letzter) this.namensschild({ person_id: d.person_id, name: d.name, x: letzter[0], y: letzter[1] });
    }

    fremdEntfernen(id) {
      const f = this.fremd.get(id);
      if (f) { clearTimeout(f.timer); f.knoten.destroy(); this.fremd.delete(id); this.buehne.live.batchDraw(); }
    }

    fremdForm(d) {
      if (this.formVorschau) this.formVorschau.destroy();
      this.formVorschau = null;
      if (!d.objekt) { this.buehne.live.batchDraw(); return; }
      this.formVorschau = GT.darstellung.erzeuge(d.objekt, this.buehne.theme);
      this.formVorschau.opacity(0.6);
      this.buehne.live.add(this.formVorschau);
      this.buehne.live.batchDraw();
    }

    namensschild(d) {
      if (!d.name || d.x === undefined) return;
      let n = this.namen.get(d.person_id);
      if (!n) {
        n = new Konva.Label({ listening: false, opacity: 0.9 });
        n.add(new Konva.Tag({ fill: "#ffd966", cornerRadius: 8, shadowColor: "#000", shadowBlur: 4, shadowOpacity: 0.3 }));
        n.add(new Konva.Text({ text: "✏️ " + d.name, fontSize: 24, padding: 6, fill: "#333", fontFamily: "Arial" }));
        this.buehne.live.add(n);
        this.namen.set(d.person_id, n);
      }
      n.position({ x: d.x + 16, y: d.y + 12 });
      n.visible(true);
      clearTimeout(n._timer);
      n._timer = setTimeout(() => { n.visible(false); this.buehne.live.batchDraw(); }, 1600);
      this.buehne.live.batchDraw();
    }

    laserPunkt(x, y) {
      const p = new Konva.Circle({ x, y, radius: 9, fill: GT.farben.laser, shadowColor: GT.farben.laser,
        shadowBlur: 18, shadowOpacity: 1, listening: false });
      this.buehne.live.add(p);
      p.to({ opacity: 0, radius: 4, duration: 1.8, onFinish: () => p.destroy() });
    }

    fremdStatus(d) {
      this.pillStatus.textContent = d.taetigkeit && STATUS_TEXT[d.taetigkeit] ? " · " + d.name + " " + STATUS_TEXT[d.taetigkeit] : "";
      this.pillPlatzieren();
    }

    status(taetigkeit) { this.socket && this.socket.emit("tafel:status", { taetigkeit }); }

    // ---------- Lineal ----------
    linealZeichnen() {
      const L = 760, H = 74;
      if (!this.linealGruppe) {
        this.linealGruppe = new Konva.Group({ visible: false });
        const koerper = new Konva.Rect({ width: L, height: H, fill: "rgba(240,240,230,0.55)", stroke: "#666",
          strokeWidth: 1.5, cornerRadius: 4 });
        koerper.setAttr("linealTeil", true);
        this.linealGruppe.add(koerper);
        for (let i = 0; i <= 38; i++) {
          const x = 10 + i * 19.5, lang = i % 5 === 0;
          this.linealGruppe.add(new Konva.Line({ points: [x, 0, x, lang ? 22 : 12], stroke: "#333", strokeWidth: 1.5, listening: false }));
          if (lang) this.linealGruppe.add(new Konva.Text({ x: x - 6, y: 26, text: String(i), fontSize: 13, fill: "#333", listening: false }));
        }
        const griff = new Konva.Circle({ x: L + 26, y: H / 2, radius: 20, fill: "#4a6fa5", stroke: "#fff", strokeWidth: 3 });
        griff.setAttr("linealTeil", true);
        this.linealGruppe.add(griff);
        this.linealGriff = griff;
        this.buehne.ui.add(this.linealGruppe);
        this.linealGruppe.on("dragmove", () => this.linealMelden());
        griff.on("dragmove", () => {
          const g = this.linealGruppe;
          const p = g.getAbsoluteTransform().point({ x: griff.x(), y: griff.y() });
          const t = this.buehne.zuTafel(p);
          const winkel = Math.atan2(t.y - g.y(), t.x - g.x()) * 180 / Math.PI;
          g.rotation(winkel);
          griff.position({ x: L + 26, y: H / 2 });
          this.linealMelden();
        });
        [koerper, griff].forEach((k) => k.on("pointerdown", (e) => { e.cancelBubble = true; }));
      }
      const darf = this.hat("lineal");
      this.linealGruppe.setAttrs({ visible: !!this.lineal.sichtbar, x: this.lineal.x, y: this.lineal.y,
        rotation: this.lineal.winkel, draggable: darf });
      this.linealGriff.setAttrs({ draggable: darf, visible: darf });
      this.buehne.ui.batchDraw();
    }

    linealMelden() {
      const g = this.linealGruppe;
      this.lineal = { sichtbar: this.lineal.sichtbar, x: g.x(), y: g.y(), winkel: g.rotation() };
      const jetzt = Date.now();
      if (jetzt - (this._linealZeit || 0) > 50) { this._linealZeit = jetzt; this.socket.emit("tafel:lineal", this.lineal); }
    }

    /** Punkte auf die Linealkante ziehen, wenn der Strich nah an ihr beginnt. */
    linealEinrasten(punkte) {
      if (!this.lineal.sichtbar || punkte.length < 2) return punkte;
      const w = this.lineal.winkel * Math.PI / 180, dx = Math.cos(w), dy = Math.sin(w);
      const { x, y } = this.lineal;
      const abstand = (p) => (p[0] - x) * -dy + (p[1] - y) * dx;
      if (Math.abs(abstand(punkte[0])) > 30) return punkte;
      return punkte.map((p) => {
        const t = (p[0] - x) * dx + (p[1] - y) * dy;
        return [x + t * dx, y + t * dy, p[2]];
      });
    }

    // ---------- Auswahl (von werkzeuge/auswahl.js genutzt) ----------
    waehlen(id) { GT.auswahl && GT.auswahl.waehlen(this, id); }
    abwaehlen() { GT.auswahl && GT.auswahl.abwaehlen(this); }
    auswahlAuffrischen() { GT.auswahl && GT.auswahl.auffrischen(this); }

    /** Neues Objekt in der Sichtmitte einfügen und danach anwählen. */
    /** Freie Stelle nahe (x, y): nicht exakt auf ein vorhandenes Objekt legen. */
    freiePosition(x, y) {
      const objekte = (this.seite() && this.seite().objekte) || [];
      for (let i = 0; i < 12 && objekte.some((o) => Math.abs(o.x - x) < 25 && Math.abs(o.y - y) < 25); i++) { x += 40; y += 40; }
      return { x: Math.round(x), y: Math.round(y) };
    }

    einfuegenMitte(objekt, breite, hoehe) {
      const m = this.buehne.mitte();
      Object.assign(objekt, this.freiePosition(m.x - (breite || 0) / 2, m.y - (hoehe || 0) / 2));
      return this.sende({ op: "add", seite: this.z.aktuelle_seite, objekt }).then((a) => {
        if (a.ok && this.hat("auswahl")) { this.werkzeugWaehlen("auswahl", true); this.waehlen(objekt.id); }
        return a;
      });
    }

    // ---------- Dialoge ----------
    dialog({ titel, inhalt, knoepfe, breit, beimSchliessen }) {
      const d = document.createElement("div");
      d.className = "gt-dialog-hg";
      d.innerHTML = `<div class="gt-dialog ${breit ? "breit" : ""}"><div class="gt-dialog-kopf"><b></b><button class="gt-x" title="Schließen">✕</button></div>
        <div class="gt-dialog-inhalt"></div><div class="gt-dialog-fuss"></div></div>`;
      d.querySelector("b").textContent = titel;
      const bereich = d.querySelector(".gt-dialog-inhalt");
      if (typeof inhalt === "string") bereich.innerHTML = inhalt; else if (inhalt) bereich.appendChild(inhalt);
      const fuss = d.querySelector(".gt-dialog-fuss");
      const api = {
        el: d, inhalt: bereich,
        schliessen: () => { d.remove(); beimSchliessen && beimSchliessen(); },
        knopf: (name) => fuss.querySelector(`[data-k="${name}"]`),
      };
      (knoepfe || []).forEach((k) => {
        const b = document.createElement("button");
        b.textContent = k.text;
        b.dataset.k = k.name || k.text;
        b.className = k.haupt ? "haupt" : "";
        b.onclick = () => k.aktion(api);
        fuss.appendChild(b);
      });
      d.querySelector(".gt-x").onclick = api.schliessen;
      this.dialoge.appendChild(d);
      return api;
    }
  }

  GT.TafelApp = TafelApp;
})();
