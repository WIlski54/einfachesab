/* ebene.js – die Lehrer-Ebene: Zeichnungen, Stempel und Bilder, die ÜBER den Schülerantworten liegen.
 *
 * Schüler-Ansicht: zeigt die Ebene nur an (pointer-events: none – Eingaben gehen durch).
 * Lehrer-Ansicht:  Werkzeugleiste unten; Pointer Events (Finger, Stift, Maus).
 *
 * Koordinaten: x und y sind auf die BREITE der Aufgabe bezogen (px / Breite), damit eine Markierung
 * auf jedem Gerät an derselben Stelle liegt, auch wenn die Höhe abweicht.
 * Striche und Stempel werden auf ein <canvas> gezeichnet (mix-blend-mode: multiply, damit die
 * Schülerschrift darunter lesbar bleibt), Bilder sind <img>-Elemente.
 */
(function () {
  'use strict';

  // Farbschlüssel wie bei den Kommentaren (app.py: KOMMENTAR_FARBEN; ab.css: .nf-*): Eine Zeichnung in der
  // Farbe eines Kommentars gehört für die Schüler:innen sichtbar zu diesem Kommentar. r = rot, g = gelb: ohne Kommentarbezug.
  var FARBE = { t: '#0f8a7e', p: '#d6336c', b: '#3b6fd4', o: '#e8820c', v: '#8b5cf6', l: '#4d9f2f', r: '#dc2626' };
  var MARKER = { t: 'rgba(15,138,126,.30)', p: 'rgba(214,51,108,.28)', b: 'rgba(59,111,212,.28)', o: 'rgba(232,130,12,.32)',
                 v: 'rgba(139,92,246,.28)', l: 'rgba(77,159,47,.30)', r: 'rgba(220,38,38,.28)', g: 'rgba(250,204,21,.45)' };
  var STIFT_DICKE = [0.0035, 0.006, 0.010];       // Anteil der Aufgabenbreite
  var MARKER_DICKE = [0.022, 0.035, 0.05];
  var STEMPEL = {
    check: ['✓', '#16a34a'], cross: ['✗', '#dc2626'], question: ['?', '#d97706'],
    excl: ['!', '#dc2626'], star: ['★', '#d97706'], bulb: ['💡', '#000']
  };
  var STEMPEL_GROESSE = [0.045, 0.07, 0.10];
  var BILD_BREITE = [0.2, 0.35, 0.5];
  var MAX_PUNKTE = 400;
  var MAX_BILD_KANTE = 900;                       // Bilder vor dem Hochladen auf diese Kantenlänge verkleinern
  var MAX_BILD_BYTES = 280000;

  var cfg = null;                                 // {modus, socket, sid, edit}
  var tafeln = {};                                // aufgaben-nr -> {ebene, inhalt, cv, ctx, liste: []}
  var aktiv = null;                               // aufgaben-nr, in der gerade gezeichnet wird
  var werkzeug = { art: 'stift', farbe: 't', groesse: 2, stempel: 'check', bild: null };
  var leiste = null;
  var wip = null;                                 // Strich, der gerade gezogen wird
  var geloeschtLaufend = {};
  var letzte = {};                                // aufgaben-nr -> zuletzt gewählte/neue Kommentarfarbe

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) { e.className = cls; }
    if (text !== undefined) { e.textContent = text; }
    return e;
  }

  // ---------- Zeichnen ----------
  function breite(t) { return t.inhalt.clientWidth || 1; }

  function groesse(t) {
    var W = breite(t), H = t.inhalt.clientHeight || 1, dpr = window.devicePixelRatio || 1;
    var cv = t.cv;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
    }
    t.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    t.ebene.style.setProperty('--eb-w', W + 'px');
  }

  function strich(ctx, W, d) {
    var pts = d.p, dicke = (d.m ? MARKER_DICKE : STIFT_DICKE)[d.b - 1] * W;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = dicke;
    ctx.strokeStyle = d.m ? (MARKER[d.f] || MARKER.g) : (FARBE[d.f] || FARBE.t);
    ctx.fillStyle = ctx.strokeStyle;
    if (pts.length === 1) {                        // einzelner Punkt
      ctx.beginPath();
      ctx.arc(pts[0][0] * W, pts[0][1] * W, dicke / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.beginPath();
    ctx.moveTo(pts[0][0] * W, pts[0][1] * W);
    for (var i = 1; i < pts.length - 1; i++) {     // weiche Linie durch die Mittelpunkte
      var mx = (pts[i][0] + pts[i + 1][0]) / 2 * W, my = (pts[i][1] + pts[i + 1][1]) / 2 * W;
      ctx.quadraticCurveTo(pts[i][0] * W, pts[i][1] * W, mx, my);
    }
    var l = pts[pts.length - 1];
    ctx.lineTo(l[0] * W, l[1] * W);
    ctx.stroke();
  }

  function stempel(ctx, W, d) {
    var def = STEMPEL[d.s];
    if (!def) { return; }
    ctx.font = 'bold ' + Math.round(STEMPEL_GROESSE[d.g - 1] * W) + 'px Arial, Helvetica, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = def[1];
    ctx.fillText(def[0], d.x * W, d.y * W);
  }

  function zeichne(nr) {
    var t = tafeln[nr];
    if (!t) { return; }
    groesse(t);
    var W = breite(t), ctx = t.ctx;
    ctx.clearRect(0, 0, W, t.inhalt.clientHeight);
    t.liste.forEach(function (o) {
      if (o.typ === 'zeichnung') { strich(ctx, W, o.daten); }
      else if (o.typ === 'stempel') { stempel(ctx, W, o.daten); }
    });
    if (wip && wip.nr === nr && wip.daten) { strich(ctx, W, wip.daten); }
  }

  function bildElement(t, o) {
    if (o.img) { return; }
    var img = new Image();
    img.className = 'eb-bild';
    img.alt = '';
    img.draggable = false;
    img.style.left = (o.daten.x * 100) + '%';
    img.style.top = 'calc(' + o.daten.y + ' * var(--eb-w))';
    img.style.width = (o.daten.w * 100) + '%';
    img.src = o.daten.url || o.lokalSrc;
    o.img = img;
    t.ebene.insertBefore(img, t.cv.nextSibling);
  }

  // ---------- Objekte verwalten ----------
  function einfuegen(a) {
    var t = tafeln[a.aufgabe];
    if (!t || a.typ === 'kommentar') { return; }
    if (t.liste.some(function (o) { return o.id === a.id; })) { return; }       // schon da
    var o = { id: a.id, typ: a.typ, daten: a.daten };
    t.liste.push(o);
    if (a.typ === 'bild') { bildElement(t, o); }
    zeichne(a.aufgabe);
  }

  function setze(liste) {
    Object.keys(tafeln).forEach(function (nr) {
      var t = tafeln[nr];
      t.liste.forEach(function (o) { if (o.img && o.img.parentNode) { o.img.parentNode.removeChild(o.img); } });
      t.liste = [];
    });
    (liste || []).forEach(einfuegen);
    Object.keys(tafeln).forEach(zeichne);
  }

  function neu(a) {
    if (a.typ === 'kommentar') { return; }
    var t = tafeln[a.aufgabe];
    if (!t) { return; }
    if (a.cid) {                                    // vom eigenen Gerät gesendet? Dann nur die ID nachtragen
      var eigene = t.liste.filter(function (o) { return o.cid === a.cid; })[0];
      if (eigene) { eigene.id = a.id; if (a.daten.url) { eigene.daten.url = a.daten.url; } return; }
    }
    einfuegen(a);
  }

  function entferne(o, nr) {
    var t = tafeln[nr];
    t.liste.splice(t.liste.indexOf(o), 1);
    if (o.img && o.img.parentNode) { o.img.parentNode.removeChild(o.img); }
    zeichne(nr);
  }

  function weg(id) {
    Object.keys(tafeln).forEach(function (nr) {
      var o = tafeln[nr].liste.filter(function (x) { return x.id === id; })[0];
      if (o) { entferne(o, nr); }
    });
  }

  function geleert(nr) {
    var t = tafeln[nr];
    if (!t) { return; }
    t.liste.slice().forEach(function (o) { entferne(o, nr); });
  }

  // ---------- Senden (Lehrkraft) ----------
  function sende(nr, typ, daten, lokal) {
    var cid = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    var o = { id: null, cid: cid, typ: typ, daten: lokal || daten };
    var t = tafeln[nr];
    t.liste.push(o);
    if (typ === 'bild') { o.lokalSrc = daten.src; bildElement(t, o); }
    zeichne(nr);
    cfg.socket.emit('ebene_neu', { schueler_id: cfg.sid, aufgabe: nr, typ: typ, daten: daten, cid: cid }, function (res) {
      if (res && res.ok) {
        if (o.id === null) { o.id = res.id; }
      } else {
        entferne(o, nr);
        if (res && res.fehler === 'zu_viele') { alert('In dieser Aufgabe sind keine weiteren Zeichnungen möglich.'); }
        else if (res && res.fehler === 'zu_viele_bilder') { alert('Pro Aufgabe sind höchstens 3 Bilder möglich.'); }
        else { alert('Das konnte nicht gespeichert werden.'); }
      }
    });
  }

  function loescheObjekt(o, nr) {
    if (o.id === null || geloeschtLaufend[o.id]) { return; }
    geloeschtLaufend[o.id] = true;
    cfg.socket.emit('ebene_loeschen', { schueler_id: cfg.sid, id: o.id }, function () { delete geloeschtLaufend[o.id]; });
    entferne(o, nr);
  }

  // ---------- Treffer-Test für den Radierer ----------
  function abstandSegment(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    var u = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
    return Math.hypot(px - (ax + u * dx), py - (ay + u * dy));
  }

  function treffer(nr, px, py) {
    var t = tafeln[nr], W = breite(t);
    for (var i = t.liste.length - 1; i >= 0; i--) {          // oberstes Objekt zuerst
      var o = t.liste[i], d = o.daten;
      if (o.typ === 'zeichnung') {
        var toleranz = Math.max(14, (d.m ? MARKER_DICKE : STIFT_DICKE)[d.b - 1] * W / 2 + 8);
        for (var k = 0; k < d.p.length; k++) {
          var a = d.p[k], b = d.p[Math.min(k + 1, d.p.length - 1)];
          if (abstandSegment(px, py, a[0] * W, a[1] * W, b[0] * W, b[1] * W) <= toleranz) { return o; }
        }
      } else if (o.typ === 'stempel') {
        if (Math.hypot(px - d.x * W, py - d.y * W) <= STEMPEL_GROESSE[d.g - 1] * W * 0.7) { return o; }
      } else if (o.typ === 'bild' && o.img) {
        var r = o.img.getBoundingClientRect(), er = t.inhalt.getBoundingClientRect();
        if (px >= r.left - er.left && px <= r.right - er.left && py >= r.top - er.top && py <= r.bottom - er.top) { return o; }
      }
    }
    return null;
  }

  // ---------- Eingabe (Lehrkraft) ----------
  function punkt(t, ev) {
    var r = t.inhalt.getBoundingClientRect();
    return { px: ev.clientX - r.left, py: ev.clientY - r.top };
  }

  function dünn(pts) {                              // auf höchstens MAX_PUNKTE ausdünnen, Endpunkt behalten
    if (pts.length <= MAX_PUNKTE) { return pts; }
    var schritt = Math.ceil(pts.length / MAX_PUNKTE), out = [];
    for (var i = 0; i < pts.length; i += schritt) { out.push(pts[i]); }
    var l = pts[pts.length - 1];
    if (out[out.length - 1] !== l) { out.push(l); }
    return out.slice(0, MAX_PUNKTE);
  }

  function runde(v) { return Math.round(v * 10000) / 10000; }

  function verbinde(nr, t) {
    var eb = t.ebene;
    eb.addEventListener('pointerdown', function (ev) {
      if (aktiv !== nr || (ev.pointerType === 'mouse' && ev.button !== 0)) { return; }
      ev.preventDefault();
      var W = breite(t), p = punkt(t, ev), art = werkzeug.art;
      if (art === 'stift' || art === 'marker') {
        var marker = art === 'marker';
        var farbe = (!marker && werkzeug.farbe === 'g') ? 't' : werkzeug.farbe;     // gelb gibt es nur als Marker
        wip = { nr: nr, id: ev.pointerId, daten: { f: farbe, m: marker ? 1 : 0, b: werkzeug.groesse, p: [[runde(p.px / W), runde(p.py / W)]] } };
        try { eb.setPointerCapture(ev.pointerId); } catch (e) { /* ältere Browser */ }
        zeichne(nr);
      } else if (art === 'stempel') {
        sende(nr, 'stempel', { s: werkzeug.stempel, x: runde(p.px / W), y: runde(p.py / W), g: werkzeug.groesse });
      } else if (art === 'bild') {
        if (!werkzeug.bild) { return; }
        var b = werkzeug.bild, bw = BILD_BREITE[werkzeug.groesse - 1];
        var hPx = bw * W * b.h / b.w;
        sende(nr, 'bild', { x: runde(Math.max(0, p.px / W - bw / 2)), y: runde(Math.max(0, (p.py - hPx / 2) / W)), w: bw, src: b.src });
        werkzeug.bild = null;
        waehle('stift');
      } else if (art === 'radierer') {
        wip = { nr: nr, id: ev.pointerId, radieren: true };
        try { eb.setPointerCapture(ev.pointerId); } catch (e) { /* egal */ }
        var o = treffer(nr, p.px, p.py);
        if (o) { loescheObjekt(o, nr); }
      }
    });
    eb.addEventListener('pointermove', function (ev) {
      if (!wip || wip.nr !== nr || wip.id !== ev.pointerId) { return; }
      var W = breite(t);
      var ereignisse = ev.getCoalescedEvents ? ev.getCoalescedEvents() : [ev];
      if (!ereignisse.length) { ereignisse = [ev]; }
      ereignisse.forEach(function (e) {
        var p = punkt(t, e);
        if (wip.radieren) {
          var o = treffer(nr, p.px, p.py);
          if (o) { loescheObjekt(o, nr); }
          return;
        }
        var pts = wip.daten.p, l = pts[pts.length - 1];
        if (Math.hypot(p.px - l[0] * W, p.py - l[1] * W) >= 1.5) { pts.push([runde(p.px / W), runde(p.py / W)]); }
      });
      if (!wip.radieren) { zeichne(nr); }
    });
    function ende(ev) {
      if (!wip || wip.nr !== nr || wip.id !== ev.pointerId) { return; }
      var fertig = wip;
      wip = null;
      if (fertig.radieren) { return; }
      var daten = fertig.daten;
      daten.p = dünn(daten.p);
      sende(nr, 'zeichnung', daten);
    }
    eb.addEventListener('pointerup', ende);
    eb.addEventListener('pointercancel', ende);
  }

  // ---------- Werkzeugleiste ----------
  function waehle(art) {
    werkzeug.art = art;
    if (art === 'marker' && werkzeug.farbe === 't') { /* türkis bleibt möglich */ }
    leisteAktualisieren();
  }

  function knopf(text, titel, fn, cls) {
    var b = el('button', 'eb-knopf' + (cls ? ' ' + cls : ''), text);
    b.type = 'button';
    b.title = titel || '';
    b.addEventListener('click', fn);
    return b;
  }

  function leisteBauen() {
    if (leiste) { return; }
    leiste = el('div', 'eb-leiste');
    leiste.id = 'ebene-leiste';
    leiste.hidden = true;
    leiste.appendChild(el('span', 'eb-titel'));

    var gruppen = [
      ['stift', '✏️', 'Stift'], ['marker', '🖍️', 'Marker'], ['stempel', '⭐', 'Stempel'],
      ['bild', '🖼️', 'Bild einfügen'], ['radierer', '🧽', 'Radierer']
    ];
    var werkz = el('span', 'eb-gruppe');
    gruppen.forEach(function (g) {
      var b = knopf(g[1], g[2], function () {
        if (g[0] === 'bild') { bildWaehlen(); } else { waehle(g[0]); }
      });
      b.setAttribute('data-art', g[0]);
      werkz.appendChild(b);
    });
    leiste.appendChild(werkz);

    leiste.appendChild(el('span', 'eb-gruppe eb-farben'));      // Knöpfe: farbenAufbauen()

    var gr = el('span', 'eb-gruppe eb-groessen');
    ['S', 'M', 'L'].forEach(function (t, i) {
      var b = knopf(t, 'Größe ' + t, function () { werkzeug.groesse = i + 1; leisteAktualisieren(); });
      b.setAttribute('data-groesse', i + 1);
      gr.appendChild(b);
    });
    leiste.appendChild(gr);

    var st = el('span', 'eb-gruppe eb-stempel');
    Object.keys(STEMPEL).forEach(function (k) {
      var b = knopf(STEMPEL[k][0], k, function () { werkzeug.stempel = k; werkzeug.art = 'stempel'; leisteAktualisieren(); });
      b.setAttribute('data-stempel', k);
      st.appendChild(b);
    });
    leiste.appendChild(st);

    var akt = el('span', 'eb-gruppe');
    akt.appendChild(knopf('↶', 'Letztes rückgängig', function () {
      var t = tafeln[aktiv];
      if (!t) { return; }
      for (var i = t.liste.length - 1; i >= 0; i--) {
        if (t.liste[i].id !== null) { loescheObjekt(t.liste[i], aktiv); return; }
      }
    }));
    akt.appendChild(knopf('🗑', 'Alles in dieser Aufgabe löschen', function () {
      if (!confirm('Alle Zeichnungen, Stempel und Bilder in Aufgabe ' + aktiv + ' löschen? (Kommentare bleiben)')) { return; }
      var nr = aktiv;
      cfg.socket.emit('ebene_leeren', { schueler_id: cfg.sid, aufgabe: nr });
      geleert(nr);
    }));
    akt.appendChild(knopf('Fertig', 'Zeichnen beenden', function () { deaktiviere(); }, 'eb-fertig'));
    leiste.appendChild(akt);

    var hinweis = el('span', 'eb-hinweis');
    hinweis.id = 'eb-hinweis';
    leiste.appendChild(hinweis);
    document.body.appendChild(leiste);
  }

  // Farben der Kommentare dieser Aufgabe (in der Reihenfolge der Kommentare); ohne Kommentar: türkis
  function kommentarFarben(nr) {
    var liste = [];
    document.querySelectorAll('.lehrer-notizen[data-notizen="' + nr + '"] .lehrer-notiz[data-farbe]').forEach(function (n) {
      var f = n.getAttribute('data-farbe');
      if (liste.indexOf(f) < 0) { liste.push(f); }
    });
    return liste.length ? liste : ['t'];
  }

  function farbenAufbauen() {
    if (!leiste || aktiv === null) { return; }
    var box = leiste.querySelector('.eb-farben'), kf = kommentarFarben(aktiv);
    box.textContent = '';
    kf.concat(['r', 'g']).forEach(function (f, i) {
      var nr = i < kf.length ? i + 1 : 0;
      var titel = f === 'g' ? 'gelb (nur Marker)' : f === 'r' ? 'rot (ohne Kommentar)' : 'Farbe des Kommentars ' + nr;
      var b = knopf('', titel, function () {
        werkzeug.farbe = f;
        letzte[aktiv] = f;
        if (f === 'g' && werkzeug.art === 'stift') { werkzeug.art = 'marker'; }
        leisteAktualisieren();
      }, 'eb-farbe');
      b.style.background = f === 'g' ? '#facc15' : FARBE[f];
      b.setAttribute('data-farbe', f);
      box.appendChild(b);
    });
    if (kf.concat(['r', 'g']).indexOf(werkzeug.farbe) < 0) { werkzeug.farbe = kf[kf.length - 1]; }
  }

  // Kommentar-Farbe in der Aufgabe hervorheben, in der gerade gezeichnet wird
  function gewaehltMarkieren() {
    document.querySelectorAll('.lehrer-notiz.gewaehlt').forEach(function (n) { n.classList.remove('gewaehlt'); });
    if (aktiv === null) { return; }
    document.querySelectorAll('.lehrer-notizen[data-notizen="' + aktiv + '"] .lehrer-notiz[data-farbe="' + werkzeug.farbe + '"]')
      .forEach(function (n) { n.classList.add('gewaehlt'); });
  }

  function leisteAktualisieren() {
    if (!leiste) { return; }
    gewaehltMarkieren();
    var art = werkzeug.art;
    leiste.querySelectorAll('[data-art]').forEach(function (b) { b.classList.toggle('an', b.getAttribute('data-art') === art); });
    leiste.querySelectorAll('[data-farbe]').forEach(function (b) {
      var f = b.getAttribute('data-farbe');
      b.classList.toggle('an', f === werkzeug.farbe);
      b.hidden = (f === 'g' && art !== 'marker' && art !== 'stift') || (f === 'g' && art === 'stift' && false);
    });
    leiste.querySelectorAll('[data-groesse]').forEach(function (b) { b.classList.toggle('an', +b.getAttribute('data-groesse') === werkzeug.groesse); });
    var zeigeSt = art === 'stempel';
    leiste.querySelector('.eb-stempel').hidden = !zeigeSt;
    leiste.querySelectorAll('[data-stempel]').forEach(function (b) { b.classList.toggle('an', b.getAttribute('data-stempel') === werkzeug.stempel); });
    leiste.querySelector('.eb-farben').hidden = !(art === 'stift' || art === 'marker');
    var h = document.getElementById('eb-hinweis');
    h.textContent = art === 'bild' ? (werkzeug.bild ? 'Tippe auf die Stelle für das Bild' : 'Bild wird geladen …')
                  : art === 'radierer' ? 'Tippe auf eine Zeichnung, um sie zu löschen' : '';
  }

  // ---------- Bild wählen und verkleinern ----------
  function bildWaehlen() {
    var inp = document.getElementById('eb-datei');
    if (!inp) {
      inp = el('input');
      inp.type = 'file';
      inp.accept = 'image/png,image/jpeg,image/*';
      inp.id = 'eb-datei';
      inp.hidden = true;
      document.body.appendChild(inp);
      inp.addEventListener('change', function () {
        var f = inp.files && inp.files[0];
        inp.value = '';
        if (f) { bildLaden(f); }
      });
    }
    inp.click();
  }

  function bildLaden(datei) {
    var url = URL.createObjectURL(datei);
    var img = new Image();
    img.onload = function () {
      var k = Math.min(1, MAX_BILD_KANTE / Math.max(img.naturalWidth, img.naturalHeight));
      var w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
      var cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      var cx = cv.getContext('2d');
      var png = datei.type === 'image/png';
      if (!png) { cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h); }
      cx.drawImage(img, 0, 0, w, h);
      var q = 0.85, src = png ? cv.toDataURL('image/png') : cv.toDataURL('image/jpeg', q);
      while (src.length * 0.75 > MAX_BILD_BYTES && q > 0.3) {          // zu groß -> als JPEG stärker komprimieren
        q -= 0.15;
        cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h); cx.drawImage(img, 0, 0, w, h);
        src = cv.toDataURL('image/jpeg', q);
      }
      URL.revokeObjectURL(url);
      if (src.length * 0.75 > MAX_BILD_BYTES) { alert('Das Bild ist zu groß.'); return; }
      werkzeug.bild = { src: src, w: w, h: h };
      werkzeug.art = 'bild';
      leisteAktualisieren();
    };
    img.onerror = function () { URL.revokeObjectURL(url); alert('Dieses Bild kann nicht gelesen werden.'); };
    img.src = url;
  }

  // ---------- Aktivieren (Lehrkraft) ----------
  function aktiviere(nr) {
    if (!cfg || !cfg.edit || !tafeln[nr]) { return; }
    if (aktiv === nr) { deaktiviere(); return; }
    deaktiviere();
    aktiv = nr;
    leisteBauen();
    tafeln[nr].ebene.classList.add('aktiv');
    tafeln[nr].inhalt.closest('.aufgabe').classList.add('zeichnen');
    leiste.hidden = false;
    leiste.querySelector('.eb-titel').textContent = 'Aufgabe ' + nr;
    document.body.classList.add('zeichnen-an');
    var kf = kommentarFarben(nr);                   // automatisch: Farbe des zuletzt gewählten bzw. neuesten Kommentars
    werkzeug.farbe = kf.indexOf(letzte[nr]) >= 0 || letzte[nr] === 'r' ? letzte[nr] : kf[kf.length - 1];
    farbenAufbauen();
    leisteAktualisieren();
    var knoepfe = document.querySelectorAll('.eb-auf');
    knoepfe.forEach(function (b) { b.classList.toggle('offen', b.getAttribute('data-aufgabe') === nr); });
  }

  function deaktiviere() {
    if (aktiv === null) { return; }
    var t = tafeln[aktiv];
    if (t) {
      t.ebene.classList.remove('aktiv');
      t.inhalt.closest('.aufgabe').classList.remove('zeichnen');
    }
    wip = null;
    aktiv = null;
    gewaehltMarkieren();
    if (leiste) { leiste.hidden = true; }
    document.body.classList.remove('zeichnen-an');
    document.querySelectorAll('.eb-auf').forEach(function (b) { b.classList.remove('offen'); });
  }

  // ---------- Blattbreite: Schüler-Gerät meldet, Lehrer-Ansicht passt sich an ----------
  var LEHRER_RAND_PLUS = 80;                         // Lehrer-Randspalte ist 80 px breiter als die der Schüler

  function meldeBreite() {
    var blatt = document.getElementById('blatt');
    if (!blatt || !cfg.socket.connected) { return; }
    cfg.socket.emit('breite', { w: Math.round(blatt.getBoundingClientRect().width) });
  }

  function passeAn(w) {
    var blatt = document.getElementById('blatt'), hinweis = document.getElementById('breite-hinweis');
    if (!blatt || !w) { return; }
    blatt.style.maxWidth = (w + LEHRER_RAND_PLUS) + 'px';
    var verfuegbar = document.documentElement.clientWidth - 24;
    var passt = verfuegbar >= w + LEHRER_RAND_PLUS - 1;
    if (hinweis) {
      hinweis.hidden = passt;
      hinweis.textContent = passt ? '' : '⚠︎ Dein Bildschirm ist schmaler als der von ' + (cfg.name || 'der Person') + ' – Markierungen können leicht verschoben wirken';
    }
    Object.keys(tafeln).forEach(zeichne);
  }

  // ---------- Start ----------
  function start(c) {
    cfg = c;
    document.querySelectorAll('.lehrer-ebene[data-ebene]').forEach(function (eb) {
      var nr = eb.getAttribute('data-ebene');
      if (tafeln[nr]) { return; }
      var cv = el('canvas', 'eb-canvas');
      eb.insertBefore(cv, eb.firstChild);
      var t = { ebene: eb, inhalt: eb.parentNode, cv: cv, ctx: cv.getContext('2d'), liste: [] };
      if (!t.ctx) { return; }
      tafeln[nr] = t;
      groesse(t);
      if (cfg.edit) {
        verbinde(nr, t);
        var rand = t.inhalt.closest('.aufgabe').querySelector('.rand');
        if (rand) {
          var kn = knopf('✏️ Zeichnen', 'In dieser Aufgabe zeichnen, stempeln, Bild einfügen', function () { aktiviere(nr); }, 'eb-auf');
          kn.setAttribute('data-aufgabe', nr);
          rand.insertBefore(kn, rand.firstChild);
        }
      }
      if (window.ResizeObserver) { new ResizeObserver(function () { zeichne(nr); }).observe(t.inhalt); }
    });
    window.addEventListener('resize', function () { Object.keys(tafeln).forEach(zeichne); });

    if (cfg.modus === 'schueler') {
      var timer = null;
      var plane = function () { clearTimeout(timer); timer = setTimeout(meldeBreite, 300); };
      window.addEventListener('resize', plane);
      window.addEventListener('orientationchange', plane);
      cfg.socket.on('connect', meldeBreite);
      meldeBreite();
    } else if (cfg.edit) {
      if (cfg.breite) { passeAn(cfg.breite); }
      cfg.socket.on('schueler_breite', function (d) { if (d.schueler_id === cfg.sid) { passeAn(d.w); } });
      window.addEventListener('resize', function () { if (cfg.breite) { passeAn(cfg.breite); } });
      cfg.socket.on('schueler_breite', function (d) { if (d.schueler_id === cfg.sid) { cfg.breite = d.w; } });
    }
  }

  // Kommentar-Farben (von ab.js gemeldet): 'neu' = Lehrkraft hat einen Kommentar geschrieben -> ab jetzt in dessen Farbe,
  // 'waehlen' = Kommentar angetippt -> Zeichnen dort starten, 'liste' = Kommentare geladen/gelöscht
  document.addEventListener('ab-kommentarfarbe', function (ev) {
    var d = ev.detail || {};
    if (d.art === 'neu' || d.art === 'waehlen') {
      letzte[d.nr] = d.farbe;
      if (d.art === 'waehlen' && aktiv !== d.nr) { aktiviere(d.nr); }
      if (aktiv === d.nr) {
        werkzeug.farbe = d.farbe;
        if (['stift', 'marker', 'stempel'].indexOf(werkzeug.art) < 0) { werkzeug.art = 'stift'; }
      }
    }
    if (aktiv === d.nr) { farbenAufbauen(); leisteAktualisieren(); }
  });

  window.Ebene = {
    start: start, setze: setze, neu: neu, weg: weg, geleert: geleert,
    aktiviere: aktiviere, deaktiviere: deaktiviere,
    _tafeln: tafeln
  };
})();
