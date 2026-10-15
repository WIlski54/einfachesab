/* ab.js – gemeinsame Logik für das Schüler-AB (bearbeiten) und die Lehrer-Ansicht (nur lesen, live).
 *
 * Jedes Eingabefeld bekommt automatisch eine ID aus Aufgaben-Nummer und Reihenfolge:
 *   a3.f2  = 2. Eingabefeld in Aufgabe 3     a4.w1 = 1. Widget (Schalenmodell) in Aufgabe 4
 * Dadurch muss man im Inhalt (ab_inhalt.html) keine IDs vergeben.
 */
(function () {
  'use strict';

  var MODUS = window.AB_MODUS || 'schueler';
  var NS = 'http://www.w3.org/2000/svg';
  var RADIEN = [50, 88, 124];
  var MAX_ELEKTRONEN = 40;
  var STATUS_TEXT = {
    angemeldet: MODUS === 'schueler' ? 'Angemeldet – Deine Lehrkraft sieht es' : 'möchte vorstellen'
  };

  var HILFE_TEXT = {
    offen: MODUS === 'schueler' ? 'Angefragt – Deine Lehrkraft sieht es' : 'Hilfe angefragt',
    kommentiert: MODUS === 'schueler' ? 'Antwort steht neben der Aufgabe' : 'Kommentar gesendet',
    ki: MODUS === 'schueler' ? 'KI-Hilfe ist freigegeben' : 'KI freigegeben',
    unterwegs: MODUS === 'schueler' ? 'Deine Lehrkraft kommt zu Dir' : 'Du gehst hin'
  };

  var felder = {};           // feld-id -> {art, el, ...}
  var hilfeBoxen = {};       // aufgaben-nr -> {cb, box, status, aktionen, wert}
  var vorstellenBoxen = {};  // aufgaben-nr -> {cb, box, status}
  var dirty = {};            // feld-id -> true, solange nicht bestätigt gespeichert
  var timer = {};
  var socket = null;

  function svgEl(name, attrs) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) { e.setAttribute(k, attrs[k]); }
    return e;
  }

  // ---------- Werte lesen / setzen ----------
  function wertVon(id) {
    var f = felder[id];
    if (f.art === 'checkbox') { return f.el.checked ? 'true' : 'false'; }
    if (f.art === 'bohr') { return f.get(); }
    return f.el.value;
  }

  function setzeWert(id, wert) {
    var f = felder[id];
    if (!f) { return; }
    if (f.art === 'checkbox') { f.el.checked = (wert === 'true'); }
    else if (f.art === 'bohr') { f.set(wert); }
    else { f.el.value = wert; }
  }

  // ---------- Speichern (Schüler) ----------
  function zeigeStatus() {
    var s = document.getElementById('speicher-status');
    if (!s) { return; }
    if (!socket || !socket.connected) {
      s.textContent = 'Keine Verbindung – wird nachgeschickt';
      s.className = 'speicher warn';
    } else if (Object.keys(dirty).length) {
      s.textContent = 'Speichere …';
      s.className = 'speicher';
    } else {
      s.textContent = 'Gespeichert ✓';
      s.className = 'speicher ok';
    }
  }

  function senden(id) {
    if (!socket) { return; }
    var wert = wertVon(id);
    socket.emit('antwort', { feld: id, wert: wert }, function (res) {
      if (res && res.ok) {
        if (wertVon(id) === wert) { delete dirty[id]; }
      } else if (res && res.fehler === 'abgemeldet') {
        location.href = '/login';
      }
      zeigeStatus();
    });
  }

  function aenderung(id) {
    dirty[id] = true;
    zeigeStatus();
    clearTimeout(timer[id]);
    timer[id] = setTimeout(function () { senden(id); }, 400);
  }

  // ---------- Schalenmodell ----------
  function baueBohr(wrap, id) {
    var svg = wrap.querySelector('svg.bohr');
    var gruppe = svg.querySelector('.elektronen');
    var zaehler = wrap.querySelector('.zaehler');
    var punkte = [];
    var w = { art: 'bohr', el: wrap };

    function pos(p) {
      return { x: 150 + RADIEN[p.r] * Math.cos(p.w), y: 150 + RADIEN[p.r] * Math.sin(p.w) };
    }
    function zeichnen() {
      while (gruppe.firstChild) { gruppe.removeChild(gruppe.firstChild); }
      punkte.forEach(function (p) {
        var q = pos(p);
        gruppe.appendChild(svgEl('circle', { 'class': 'e', r: 7, cx: q.x, cy: q.y }));
      });
      zaehler.textContent = punkte.length;
    }

    w.get = function () { return JSON.stringify(punkte); };
    w.set = function (wert) {
      var arr = [];
      try { arr = JSON.parse(wert || '[]'); } catch (e) { arr = []; }
      if (!Array.isArray(arr)) { arr = []; }
      punkte = arr.filter(function (p) {
        return p && Number.isInteger(p.r) && p.r >= 0 && p.r < RADIEN.length && isFinite(p.w);
      }).slice(0, MAX_ELEKTRONEN);
      zeichnen();
    };

    var reset = wrap.querySelector('.bohr-reset');
    if (MODUS === 'schueler') {
      svg.addEventListener('click', function (ev) {
        var pt = svg.createSVGPoint();
        pt.x = ev.clientX; pt.y = ev.clientY;
        var p = pt.matrixTransform(svg.getScreenCTM().inverse());
        for (var i = 0; i < punkte.length; i++) {          // Elektron getroffen -> entfernen
          var q = pos(punkte[i]);
          if (Math.hypot(q.x - p.x, q.y - p.y) < 11) {
            punkte.splice(i, 1); zeichnen(); aenderung(id); return;
          }
        }
        var dx = p.x - 150, dy = p.y - 150, d = Math.hypot(dx, dy), best = 0;
        for (var j = 1; j < RADIEN.length; j++) {
          if (Math.abs(RADIEN[j] - d) < Math.abs(RADIEN[best] - d)) { best = j; }
        }
        if (Math.abs(RADIEN[best] - d) > 20 || punkte.length >= MAX_ELEKTRONEN) { return; }
        punkte.push({ r: best, w: Math.round(Math.atan2(dy, dx) * 1000) / 1000 });
        zeichnen(); aenderung(id);
      });
      if (reset) {
        reset.addEventListener('click', function () { punkte = []; zeichnen(); aenderung(id); });
      }
    } else if (reset) {
      reset.style.display = 'none';
    }
    zeichnen();
    return w;
  }

  // ---------- "Möchte ich vorstellen" ----------
  var vorstellenStatus = {};   // aufgaben-nr -> angemeldet (Angebot liegt an der Tafel)

  // Lehrer-Ansicht: Knöpfe unter dem Vorstellen-Feld
  function aktualisiereAktionen(nr, status) {
    var v = vorstellenBoxen[nr];
    if (!v || !v.aktionen) { return; }
    v.aktionen.innerHTML = '';
    var knoepfe = status === 'angemeldet' ? [['ablehnen', 'Ablehnen']] : [];
    knoepfe.forEach(function (k) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = k[1];
      b.className = 'aktion aktion-' + k[0];
      b.addEventListener('click', function () {
        if (window.AB_AKTION) { window.AB_AKTION(nr, k[0]); }
      });
      v.aktionen.appendChild(b);
    });
  }

  function zeigeVorstellen(nr, status) {
    var v = vorstellenBoxen[nr];
    if (!v) { return; }
    vorstellenStatus[nr] = status || null;
    v.cb.checked = !!status;
    v.box.classList.toggle('aktiv', status === 'angemeldet');
    v.status.textContent = status ? (STATUS_TEXT[status] || status) : '';
    if (MODUS !== 'schueler') { aktualisiereAktionen(nr, status); }
  }

  // liste = [{nr, status}, ...] (so liefert sie der Server in schueler_info)
  function setzeVorstellenListe(liste) {
    var map = {};
    liste.forEach(function (e) { map[e.nr] = e.status; });
    Object.keys(vorstellenBoxen).forEach(function (nr) { zeigeVorstellen(nr, map[nr] || null); });
  }

  // ---------- "Ich brauche Hilfe" ----------
  function aktualisiereHilfeAktionen(nr, status) {
    var h = hilfeBoxen[nr];
    if (!h || !h.aktionen) { return; }
    h.aktionen.innerHTML = '';
    if (!status) { return; }
    var knoepfe = [['kommentar', '💬 Antworten'], ['ki', '🤖 KI freigeben'], ['komme', '🚶 Ich komme'], ['erledigt', '✓ Erledigt']];
    knoepfe.forEach(function (k) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = k[1];
      b.className = 'aktion aktion-h-' + k[0];
      if ((k[0] === 'ki' && status === 'ki') || (k[0] === 'komme' && status === 'unterwegs')) {
        b.classList.add('gewaehlt');
      }
      b.addEventListener('click', function () {
        if (k[0] === 'kommentar') {                       // Kommentar-Feld dieser Aufgabe aufklappen
          var auf = document.querySelector('.lehrer-notizen[data-notizen="' + nr + '"] .k-auf');
          if (auf && !auf.classList.contains('offen')) { auf.click(); }
          else if (auf) { var ta = auf.parentNode.querySelector('textarea'); if (ta) { ta.focus(); } }
        } else if (window.AB_HILFE_AKTION) {
          window.AB_HILFE_AKTION(nr, k[0]);
        }
      });
      h.aktionen.appendChild(b);
    });
  }

  function zeigeHilfe(nr, status) {
    var h = hilfeBoxen[nr];
    if (!h) { return; }
    h.wert = status || null;
    h.cb.checked = !!status;
    h.box.className = 'hilfe' + (status ? ' h-' + status : '');
    h.status.textContent = status ? (HILFE_TEXT[status] || status) : '';
    if (MODUS !== 'schueler') { aktualisiereHilfeAktionen(nr, status); }
    kiAktualisieren(nr);
  }

  // liste = [{nr, status}, ...] (so liefert sie der Server in schueler_info)
  function setzeHilfeListe(liste) {
    var map = {};
    liste.forEach(function (e) { map[e.nr] = e.status; });
    Object.keys(hilfeBoxen).forEach(function (nr) { zeigeHilfe(nr, map[nr] || null); });
  }

  // ---------- KI-Hilfe (nur für Aufgaben, bei denen die Lehrkraft "KI freigeben" gewählt hat) ----------
  var KI_DATEN = window.AB_KI || null;          // {verlauf: {nr: [{id, rolle, text}]}, verfuegbar}; fehlt auf der Beamer-Seite
  var kiBoxen = {};                             // nr -> {box, verlauf, status, form, ta, knopf}
  var kiDenkt = {};
  var KI_FRAGE_FEHLER = {
    nicht_freigegeben: 'Die KI ist für diese Aufgabe nicht freigegeben.',
    ki_aus: 'Die KI ist gerade nicht verfügbar.',
    warten: 'Einen Moment, die KI antwortet noch.',
    zu_schnell: 'Nicht so schnell – warte kurz und frage dann nochmal.',
    limit: 'Du hast alle Fragen für diese Aufgabe gestellt. Sprich Deine Lehrkraft an.',
    ungueltig: 'Bitte schreibe eine kurze Frage (höchstens 500 Zeichen).'
  };

  function baueKi(sec, nr) {
    if (!KI_DATEN || kiBoxen[nr]) { return; }
    var box = document.createElement('div');
    box.className = 'ki-box';
    box.setAttribute('data-ki', nr);
    box.hidden = true;
    var kopf = document.createElement('div');
    kopf.className = 'ki-kopf';
    var t = document.createElement('strong');
    t.textContent = '🤖 KI-Hilfe';
    var sub = document.createElement('span');
    sub.className = 'ki-sub';
    sub.textContent = MODUS === 'schueler' ? 'Gibt Tipps, keine Lösungen. Deine Lehrkraft kann mitlesen.' : 'Verlauf (nur lesen)';
    kopf.appendChild(t);
    kopf.appendChild(sub);
    var verlauf = document.createElement('div');
    verlauf.className = 'ki-verlauf';
    verlauf.setAttribute('aria-live', 'polite');
    var status = document.createElement('div');
    status.className = 'ki-status';
    box.appendChild(kopf);
    box.appendChild(verlauf);
    box.appendChild(status);
    var b = { box: box, verlauf: verlauf, status: status, form: null, ta: null, knopf: null, fehler: '' };
    if (MODUS === 'schueler') {
      var form = document.createElement('form');
      form.className = 'ki-form';
      var ta = document.createElement('textarea');
      ta.rows = 2;
      ta.maxLength = 500;
      ta.placeholder = 'Was verstehst Du nicht?';
      ta.setAttribute('aria-label', 'Frage an die KI');
      var knopf = document.createElement('button');
      knopf.type = 'submit';
      knopf.textContent = 'Fragen';
      form.appendChild(ta);
      form.appendChild(knopf);
      box.appendChild(form);
      b.form = form; b.ta = ta; b.knopf = knopf;
      form.addEventListener('submit', function (ev) { ev.preventDefault(); kiFragen(nr); });
      ta.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); kiFragen(nr); }
      });
    }
    sec.appendChild(box);
    kiBoxen[nr] = b;
    ((KI_DATEN.verlauf || {})[nr] || []).forEach(function (m) { kiNachricht(nr, m, true); });
    kiAktualisieren(nr);
  }

  function kiNachricht(nr, m, still) {
    var b = kiBoxen[nr];
    if (!b || b.verlauf.querySelector('[data-id="' + m.id + '"]')) { return; }
    var e = document.createElement('div');
    e.className = 'ki-msg ' + (m.rolle === 'user' ? 'frage' : 'antwort');
    e.setAttribute('data-id', m.id);
    var wer = document.createElement('span');
    wer.className = 'ki-wer';
    wer.textContent = m.rolle === 'user' ? (MODUS === 'schueler' ? 'Du' : 'Schüler:in') : '🤖 KI';
    var text = document.createElement('div');
    text.textContent = m.text;                         // textContent: kein HTML aus Fragen oder KI-Antworten
    e.appendChild(wer);
    e.appendChild(text);
    b.verlauf.appendChild(e);
    b.verlauf.scrollTop = b.verlauf.scrollHeight;
    if (m.rolle !== 'user') { b.fehler = ''; }
    if (!still) { kiAktualisieren(nr); }
  }

  function kiAktualisieren(nr) {
    var b = kiBoxen[nr];
    if (!b) { return; }
    var frei = !!hilfeBoxen[nr] && hilfeBoxen[nr].wert === 'ki';
    var hatVerlauf = b.verlauf.children.length > 0;
    b.box.hidden = !(frei || hatVerlauf);
    b.box.classList.toggle('frei', frei);
    var denkt = !!kiDenkt[nr];
    var meldung = '';
    if (frei && !KI_DATEN.verfuegbar) { meldung = MODUS === 'schueler' ? 'Die KI ist gerade nicht verfügbar. Melde Dich bei Deiner Lehrkraft.' : 'Die KI ist ausgeschaltet oder nicht eingerichtet.'; }
    else if (b.fehler) { meldung = b.fehler; }
    else if (denkt) { meldung = '🤖 denkt nach …'; }
    else if (!frei && hatVerlauf) { meldung = 'Die KI-Hilfe ist für diese Aufgabe beendet.'; }
    b.status.textContent = meldung;
    b.status.classList.toggle('fehler', !!b.fehler || (frei && !KI_DATEN.verfuegbar));
    if (b.form) {
      b.form.hidden = !(frei && KI_DATEN.verfuegbar);
      b.knopf.disabled = denkt;
      b.ta.disabled = denkt;
    }
  }

  function kiFragen(nr) {
    var b = kiBoxen[nr];
    if (!b || !b.ta || kiDenkt[nr]) { return; }
    var text = b.ta.value.trim();
    if (!text) { return; }
    b.fehler = '';
    socket.emit('ki_frage', { aufgabe: nr, text: text }, function (res) {
      if (res && res.ok) { b.ta.value = ''; }
      else { b.fehler = KI_FRAGE_FEHLER[res && res.fehler] || 'Das hat gerade nicht geklappt.'; kiAktualisieren(nr); }
    });
  }

  function kiAlleAktualisieren() { Object.keys(kiBoxen).forEach(kiAktualisieren); }

  function kiVerlaufSetzen(verlauf) {                  // nach Verbindungsabbruch: Stand vom Server übernehmen
    Object.keys(kiBoxen).forEach(function (nr) {
      var b = kiBoxen[nr];
      b.verlauf.textContent = '';
      ((verlauf || {})[nr] || []).forEach(function (m) { kiNachricht(nr, m, true); });
      kiDenkt[nr] = false;
    });
    kiAlleAktualisieren();
  }

  function kiRegistrieren() {
    if (!KI_DATEN) { return; }
    socket.on('ki_nachricht', function (d) {
      if (LEHRER_EDIT && d.schueler_id !== LEHRER_EDIT.schueler_id) { return; }
      kiNachricht(d.aufgabe, d);
      if (MODUS === 'schueler' && d.rolle !== 'user') {
        zeigeToast('🤖 Die KI hat bei Aufgabe ' + d.aufgabe + ' geantwortet – ansehen', '.ki-box[data-ki="' + d.aufgabe + '"]');
      }
    });
    socket.on('ki_denkt', function (d) {
      if (LEHRER_EDIT && d.schueler_id !== LEHRER_EDIT.schueler_id) { return; }
      kiDenkt[d.aufgabe] = !!d.aktiv;
      kiAktualisieren(d.aufgabe);
    });
    socket.on('ki_fehler', function (d) {
      if (LEHRER_EDIT && d.schueler_id !== LEHRER_EDIT.schueler_id) { return; }
      var b = kiBoxen[d.aufgabe];
      if (b) {
        b.fehler = MODUS === 'schueler' ? 'Die KI antwortet gerade nicht. Versuche es gleich nochmal oder melde Dich bei Deiner Lehrkraft.'
                                         : 'KI-Fehler (' + d.grund + '): Die Frage wurde nicht beantwortet.';
        kiAktualisieren(d.aufgabe);
      }
    });
    socket.on('ki_verfuegbar', function (d) { KI_DATEN.verfuegbar = !!d.verfuegbar; kiAlleAktualisieren(); });
  }

  // ---------- Lehrer-Kommentare (Randspalte, türkis = Lehrkraft) ----------
  var LEHRER_EDIT = window.AB_LEHRER_EDIT || null;    // nur auf der Detailseite der Lehrkraft gesetzt
  var SCHNELL = ['Sehr gut ✓', 'Bitte genauer', 'Begründe das', 'Schau nochmal hin'];
  var KOMMENTAR_FARBEN = ['t', 'p', 'b', 'o', 'v', 'l'];   // wie im Server; Zeichnungen (ebene.js) nutzen dieselben Schlüssel
  var toastTimer = null;

  function notizBereich(nr) {
    return document.querySelector('.lehrer-notizen[data-notizen="' + nr + '"]');
  }

  function zeigeKommentar(a, neuHinweis) {
    var bereich = notizBereich(a.aufgabe);
    if (!bereich || bereich.querySelector('[data-annotation="' + a.id + '"]')) { return; }
    var el = document.createElement('div');
    el.className = 'lehrer-notiz';
    el.setAttribute('data-annotation', a.id);
    var farbe = a.daten && KOMMENTAR_FARBEN.indexOf(a.daten.c) >= 0 ? a.daten.c
      : KOMMENTAR_FARBEN[bereich.querySelectorAll('.lehrer-notiz').length % KOMMENTAR_FARBEN.length];   // ältere Kommentare ohne Farbe
    el.setAttribute('data-farbe', farbe);
    el.classList.add('nf-' + farbe);
    var kopf = document.createElement('div');
    kopf.className = 'lehrer-notiz-kopf';
    kopf.textContent = '✎ Lehrkraft';
    var text = document.createElement('div');
    text.className = 'lehrer-notiz-text';
    text.textContent = (a.daten && a.daten.text) || '';         // textContent: kein HTML aus Daten
    el.appendChild(kopf);
    el.appendChild(text);
    if (LEHRER_EDIT) {
      var x = document.createElement('button');
      x.type = 'button';
      x.className = 'lehrer-notiz-weg';
      x.setAttribute('aria-label', 'Kommentar löschen');
      x.textContent = '✕';
      x.addEventListener('click', function () {
        socket.emit('kommentar_loeschen', { schueler_id: LEHRER_EDIT.schueler_id, id: a.id });
      });
      el.appendChild(x);
    }
    var editor = bereich.querySelector('.kommentar-editor');
    bereich.insertBefore(el, editor);                            // Editor bleibt ganz unten
    if (LEHRER_EDIT) {                                           // antippen = in dieser Farbe zeichnen
      el.classList.add('waehlbar');
      el.title = 'Antippen: in dieser Farbe zeichnen';
      el.addEventListener('click', function (ev) {
        if (ev.target.closest('.lehrer-notiz-weg')) { return; }
        farbeMelden(a.aufgabe, farbe, 'waehlen');
      });
    }
    farbeMelden(a.aufgabe, farbe, neuHinweis ? 'neu' : 'liste');
    if (neuHinweis) {
      el.classList.add('frisch');
      setTimeout(function () { el.classList.remove('frisch'); }, 4000);
    }
  }

  // Sagt der Zeichen-Ebene (ebene.js), welche Kommentarfarben es in einer Aufgabe gibt bzw. welche gewählt wurde
  function farbeMelden(nr, farbe, art) {
    document.dispatchEvent(new CustomEvent('ab-kommentarfarbe', { detail: { nr: String(nr), farbe: farbe, art: art } }));
  }

  function entferneKommentar(id) {
    var el = document.querySelector('[data-annotation="' + id + '"]');
    if (el && el.parentNode) {
      var nr = el.closest('.lehrer-notizen') ? el.closest('.lehrer-notizen').getAttribute('data-notizen') : null;
      el.parentNode.removeChild(el);
      if (nr) { farbeMelden(nr, '', 'liste'); }
    }
  }

  // Schüler-Ansicht: kurzer Hinweis unten; antippen springt zur Stelle (selector)
  function zeigeToast(text, selector) {
    var t = document.getElementById('kommentar-toast');
    if (!t) {
      t = document.createElement('button');
      t.type = 'button';
      t.id = 'kommentar-toast';
      document.body.appendChild(t);
    }
    t.textContent = text;
    t.className = 'sichtbar';
    t.onclick = function () {
      var el = document.querySelector(selector);
      if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      t.className = '';
    };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = ''; }, 9000);
  }

  // Lehrer-Ansicht: Editor unter den Notizen jeder Aufgabe
  function baueEditor(nr, bereich) {
    var box = document.createElement('div');
    box.className = 'kommentar-editor';

    var auf = document.createElement('button');
    auf.type = 'button';
    auf.className = 'k-auf';
    auf.textContent = '💬 Kommentar';
    box.appendChild(auf);

    var panel = document.createElement('div');
    panel.className = 'k-panel';
    panel.hidden = true;

    function senden(text, fertig) {
      text = (text || '').trim();
      if (!text) { return; }
      socket.emit('kommentar_neu',
        { schueler_id: LEHRER_EDIT.schueler_id, aufgabe: nr, text: text },
        function (res) {
          if (res && res.ok) { if (fertig) { fertig(); } }
          else if (res && res.fehler === 'zu_viele') { alert('Mehr als 20 Kommentare an einer Aufgabe sind nicht möglich.'); }
          else { alert('Der Kommentar konnte nicht gesendet werden.'); }
        });
    }

    var chips = document.createElement('div');
    chips.className = 'k-chips';
    SCHNELL.forEach(function (t) {
      var c = document.createElement('button');
      c.type = 'button';
      c.textContent = t;
      c.addEventListener('click', function () { senden(t); });
      chips.appendChild(c);
    });
    panel.appendChild(chips);

    var ta = document.createElement('textarea');
    ta.rows = 3;
    ta.maxLength = 400;
    ta.placeholder = 'Kommentar zu Aufgabe ' + nr + ' …';
    panel.appendChild(ta);

    var ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'k-senden';
    ok.textContent = 'Senden';
    ok.addEventListener('click', function () {
      senden(ta.value, function () { ta.value = ''; });
    });
    panel.appendChild(ok);

    box.appendChild(panel);
    auf.addEventListener('click', function () {
      panel.hidden = !panel.hidden;
      auf.classList.toggle('offen', !panel.hidden);
      if (!panel.hidden) { ta.focus(); }
    });
    bereich.appendChild(box);
  }

  function setzeKommentare(liste) {
    document.querySelectorAll('.lehrer-notiz').forEach(function (e) { e.parentNode.removeChild(e); });
    (liste || []).forEach(function (a) { if (a.typ === 'kommentar') { zeigeKommentar(a, false); } });
  }

  // ---------- Nur-lesen-Modus (Lehrer-Ansicht) ----------
  function sperren(e) {
    e.readOnly = true;
    e.tabIndex = -1;
    if (e.type === 'checkbox') {
      e.addEventListener('click', function (ev) { ev.preventDefault(); });
    }
  }

  // ---------- Aufbau ----------
  function init() {
    document.querySelectorAll('.aufgabe[data-aufgabe]').forEach(function (sec) {
      var nr = sec.getAttribute('data-aufgabe');
      var i = 0, j = 0;

      sec.querySelectorAll('input:not([data-vorstellen]):not([data-hilfe]), textarea').forEach(function (e) {
        i++;
        var id = 'a' + nr + '.f' + i;
        var art = e.type === 'checkbox' ? 'checkbox' : 'text';
        e.setAttribute('data-feld', id);
        felder[id] = { art: art, el: e };
        if (e.tagName === 'INPUT' && e.type === 'text') {     // iPad: keine Autokorrektur bei Na, Cl ...
          e.setAttribute('autocomplete', 'off');
          e.setAttribute('autocorrect', 'off');
          e.setAttribute('autocapitalize', 'off');
          e.setAttribute('spellcheck', 'false');
        }
        if (MODUS === 'schueler') {
          e.addEventListener(art === 'checkbox' ? 'change' : 'input', function () { aenderung(id); });
        } else {
          sperren(e);
        }
      });

      sec.querySelectorAll('[data-widget="bohr"]').forEach(function (wrap) {
        j++;
        var id = 'a' + nr + '.w' + j;
        wrap.setAttribute('data-feld', id);
        felder[id] = baueBohr(wrap, id);
      });

      // Container für die spätere Lehrer-Ebene (Kommentare, Markierungen, Zeichnungen)
      var inhalt = sec.querySelector('.aufgabe-inhalt');
      if (inhalt && !inhalt.querySelector('.lehrer-ebene')) {
        var eb = document.createElement('div');
        eb.className = 'lehrer-ebene';
        eb.setAttribute('data-ebene', nr);
        inhalt.appendChild(eb);
      }
      var rand = sec.querySelector('.rand');
      if (rand && !rand.querySelector('.lehrer-notizen')) {
        var nz = document.createElement('div');
        nz.className = 'lehrer-notizen';
        nz.setAttribute('data-notizen', nr);
        rand.appendChild(nz);
        if (LEHRER_EDIT) { baueEditor(nr, nz); }
      }

      var cb = sec.querySelector('input[data-vorstellen]');
      if (cb) {
        var box = cb.closest('.vorstellen');
        var aktionen = null;
        if (MODUS !== 'schueler') {
          aktionen = document.createElement('div');
          aktionen.className = 'vorstellen-aktionen';
          box.insertAdjacentElement('afterend', aktionen);
        }
        vorstellenBoxen[nr] = { cb: cb, box: box, status: box.querySelector('.status'), aktionen: aktionen };
        if (MODUS === 'schueler') {
          cb.addEventListener('change', function () {
            var aktiv = cb.checked;
            var vorher = vorstellenStatus[nr] || null;
            zeigeVorstellen(nr, aktiv ? 'angemeldet' : null);
            socket.emit('vorstellen', { aufgabe: nr, aktiv: aktiv }, function (res) {
              if (res && res.ok === false) {                                  // Server hat abgelehnt
                zeigeVorstellen(nr, vorher);
                if (res.fehler === 'leer') {
                  zeigeToast('✍️ Trage zuerst etwas in Aufgabe ' + nr + ' ein – dann kannst Du sie vorstellen',
                             '.aufgabe[data-aufgabe="' + nr + '"]');
                }
              }
            });
          });
        } else {
          sperren(cb);
        }
      }

      var hcb = sec.querySelector('input[data-hilfe]');
      if (hcb) {
        var hbox = hcb.closest('.hilfe');
        var haktionen = null;
        if (MODUS !== 'schueler') {
          haktionen = document.createElement('div');
          haktionen.className = 'hilfe-aktionen';
          hbox.insertAdjacentElement('afterend', haktionen);
        }
        hilfeBoxen[nr] = { cb: hcb, box: hbox, status: hbox.querySelector('.status'), aktionen: haktionen, wert: null };
        if (MODUS === 'schueler') {
          hcb.addEventListener('change', function () {
            var aktiv = hcb.checked;
            var vorher = hilfeBoxen[nr].wert;
            zeigeHilfe(nr, aktiv ? 'offen' : null);
            socket.emit('hilfe', { aufgabe: nr, aktiv: aktiv }, function (res) {
              if (!res || res.ok === false) { zeigeHilfe(nr, vorher); }
              else { zeigeHilfe(nr, res.status || null); }
            });
          });
        } else {
          sperren(hcb);
        }
      }
      baueKi(sec, nr);
    });

    var werte = window.AB_WERTE || {};
    Object.keys(werte).forEach(function (id) { setzeWert(id, werte[id]); });
    var vorst = window.AB_VORSTELLEN || {};
    Object.keys(vorst).forEach(function (nr) { zeigeVorstellen(nr, vorst[nr]); });
    var hilfe = window.AB_HILFE || {};
    Object.keys(hilfe).forEach(function (nr) { zeigeHilfe(nr, hilfe[nr]); });
    kiAlleAktualisieren();
    setzeKommentare(window.AB_ANNOTATIONEN || []);

    // Lehrer-Ansicht: Sprung zu einer Aufgabe, z. B. /lehrer/schueler/<id>#aufgabe-3 (aus dem Dashboard)
    var m = /^#aufgabe-(\d+)$/.exec(location.hash || '');
    if (m && MODUS !== 'schueler') {
      var ziel = document.querySelector('.aufgabe[data-aufgabe="' + m[1] + '"]');
      if (ziel) {
        ziel.classList.add('ziel');
        setTimeout(function () { ziel.scrollIntoView({ block: 'start' }); }, 50);
      }
    }
  }

  // Lehrer-Ansicht: ein Feld wurde live geändert
  function live(id, wert) {
    var f = felder[id];
    if (!f) { return; }
    setzeWert(id, wert);
    f.el.classList.add('neu');
    setTimeout(function () { f.el.classList.remove('neu'); }, 1700);
  }

  function start(sock) {
    socket = sock;
    init();
    if (MODUS === 'schueler' || LEHRER_EDIT) {            // Beamer-Seite zeigt bewusst keine Kommentare/Zeichnungen
      kiRegistrieren();
      var E = window.Ebene || null;
      if (E) {
        E.start({
          modus: MODUS === 'schueler' ? 'schueler' : 'lehrer',
          socket: socket,
          sid: LEHRER_EDIT ? LEHRER_EDIT.schueler_id : null,
          edit: !!LEHRER_EDIT,
          breite: window.AB_BREITE || null,
          name: window.AB_NAME || ''
        });
        E.setze(window.AB_ANNOTATIONEN || []);
      }
      socket.on('annotation_neu', function (a) {
        if (LEHRER_EDIT && a.schueler_id !== LEHRER_EDIT.schueler_id) { return; }
        if (a.typ !== 'kommentar') {
          if (E) {
            E.neu(a);
            if (MODUS === 'schueler') {
              zeigeToast('🖍️ Neue Markierung bei Aufgabe ' + a.aufgabe + ' – ansehen', '.aufgabe[data-aufgabe="' + a.aufgabe + '"]');
            }
          }
          return;
        }
        zeigeKommentar(a, true);
        if (MODUS === 'schueler') {
          zeigeToast('💬 Neuer Kommentar bei Aufgabe ' + a.aufgabe + ' – ansehen', '[data-annotation="' + a.id + '"]');
        }
      });
      socket.on('annotation_weg', function (d) {
        if (LEHRER_EDIT && d.schueler_id !== LEHRER_EDIT.schueler_id) { return; }
        entferneKommentar(d.id);
        if (E) { E.weg(d.id); }
      });
      socket.on('ebene_geleert', function (d) {
        if (LEHRER_EDIT && d.schueler_id !== LEHRER_EDIT.schueler_id) { return; }
        if (E) { E.geleert(String(d.aufgabe)); }
      });
    }
    if (MODUS === 'schueler') {
      socket.on('vorstellen_liste', function (liste) { setzeVorstellenListe(liste); });   // Angebot angenommen/abgelehnt
      socket.on('hilfe_status', function (d) {
        zeigeHilfe(d.aufgabe, d.status);
        var sel = '.aufgabe[data-aufgabe="' + d.aufgabe + '"]';
        if (d.status === 'unterwegs') { zeigeToast('🚶 Deine Lehrkraft kommt gleich zu Dir (Aufgabe ' + d.aufgabe + ')', sel); }
        else if (d.status === 'ki') { zeigeToast('🤖 KI-Hilfe ist für Aufgabe ' + d.aufgabe + ' freigegeben', sel); }
      });
      var ersterConnect = true;
      socket.on('connect', function () {
        socket.emit('schueler_join', {});
        Object.keys(dirty).forEach(function (id) { senden(id); });
        zeigeStatus();
        if (!ersterConnect) {                              // iPad war eingeschlafen: verpasste Kommentare holen
          socket.emit('annotationen_laden', {}, function (res) {
            if (res && res.ok) {
              setzeKommentare(res.liste);
              if (window.Ebene) { window.Ebene.setze(res.liste); }
              if (KI_DATEN) { KI_DATEN.verfuegbar = !!res.ki_verfuegbar; kiVerlaufSetzen(res.ki); }
              Object.keys(hilfeBoxen).forEach(function (nr) { zeigeHilfe(nr, (res.hilfe || {})[nr] || null); });
            }
          });
        }
        ersterConnect = false;
      });
      socket.on('disconnect', zeigeStatus);
      socket.on('sitzung_beendet', function () {
        alert('Die Sitzung wurde von Deiner Lehrkraft beendet.');
        location.href = '/login';
      });
      zeigeStatus();
    }
  }

  window.AB = { start: start, live: live, setzeVorstellenListe: setzeVorstellenListe, setzeHilfeListe: setzeHilfeListe };
})();
