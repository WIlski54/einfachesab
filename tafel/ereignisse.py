"""SocketIO-Handler der Tafel im eigenen Namespace (Standard: /tafel).

Dünn gehalten: prüfen → Zustand ändern → senden → (gedrosselt) speichern.
Räume im Namespace: "lehrer" (alle Lehrer-Fenster inkl. Beamer), "schueler" (alle Lernenden),
"p_<person_id>" (alle Fenster einer Person). Der Default-Namespace des ABs bleibt unberührt.
"""
import logging
import secrets
import threading

from flask import request
from flask_socketio import join_room

from . import aufgaben
from .tuersteher import BEREICHE, Abgelehnt, pruefe, zahl

log = logging.getLogger("tafel")

DATEI_PREFIX = "/tafel/datei/"
MAX_PUNKTE = 6000
FORM_FELDER = {"id", "typ", "art", "farbe", "staerke", "x", "y", "dx", "dy"}
STATUS_WERKZEUG = {"formel": "formel", "foto": "kamera", "ab_antwort": "ab_antwort",
                   "text": "text", "karte": "karten"}
SPEICHER_PAUSE = 2.0  # Sekunden: Änderungen werden höchstens so oft gesichert


def _fehler(grund):
    return {"ok": False, "grund": grund}


class TafelServer:
    def __init__(self, socketio, tafel, host, namespace="/tafel"):
        self.socketio = socketio
        self.tafel = tafel
        self.host = host
        self.ab = getattr(host, "ab", None)
        self.speicher = getattr(host, "speicher", None)
        self.ns = namespace
        self.verbindungen = {}  # sid -> Person
        self._timer = None
        self._timer_lock = threading.Lock()

    # ---------- Senden ----------
    def emit(self, ereignis, daten, to, skip_sid=None):
        self.socketio.emit(ereignis, daten, to=to, skip_sid=skip_sid, namespace=self.ns)

    def an_tafel(self, ereignis, daten, ausser=None):
        """An alle, die die Tafel gerade sehen: Lehrer immer, Schüler nur live und nur die gezeigte Seite."""
        self.emit(ereignis, daten, "lehrer", skip_sid=ausser)
        verborgene_seite = isinstance(daten, dict) and daten.get("seite", self.tafel.aktuelle_seite) != self.tafel.aktuelle_seite
        if self.tafel.modus == "live" and not verborgene_seite:
            self.emit(ereignis, daten, "schueler", skip_sid=ausser)

    def zustand_senden(self, sid, person):
        self.emit("tafel:zustand", self.tafel.serialisiere(fuer_lehrer=person.ist_lehrer), sid)
        self.emit("tafel:rechte", self.tafel.rechte_fuer(person), sid)

    def alles_senden(self, mit_seiten=True):
        """Nach größeren Änderungen: Zustand (oder nur Metadaten) + Rechte an alle."""
        ereignis = "tafel:zustand" if mit_seiten else "tafel:meta"

        def daten(fuer_lehrer):
            d = self.tafel.serialisiere(fuer_lehrer=fuer_lehrer)
            if not mit_seiten:
                d.pop("seiten", None)
            return d

        self.emit(ereignis, daten(True), "lehrer")
        self.emit(ereignis, daten(False), "schueler")
        for sid, person in list(self.verbindungen.items()):
            self.emit("tafel:rechte", self.tafel.rechte_fuer(person), sid)
        self.schuelerliste_senden()

    def schuelerliste_senden(self):
        online = {p.id for p in list(self.verbindungen.values())}
        liste = [{"id": p.id, "name": p.name, "klasse": p.klasse, "online": p.id in online,
                  "vorne": self.tafel.ist_am_brett(p.id), "gemeldet": p.id in self.tafel.meldungen,
                  "farbe": self.tafel.schuelerfarben.get(p.id)}
                 for p in self.host.schueler_liste()]
        self.emit("lehrer:schueler", liste, "lehrer")

    def angebote_senden(self):
        self.emit("lehrer:angebote", [self._angebot_ohne_karte(a) for a in self.tafel.angebote], "lehrer")
        for sid, person in list(self.verbindungen.items()):
            if not person.ist_lehrer:
                eigene = [self._angebot_ohne_karte(a) for a in self.tafel.angebote if a["schueler_id"] == person.id]
                self.emit("ab:angebote", eigene, sid)

    @staticmethod
    def _angebot_ohne_karte(a):
        return {k: v for k, v in a.items() if k != "karte"}

    # ---------- Speichern ----------
    def aenderung(self):
        """Gedrosselt sichern: höchstens alle SPEICHER_PAUSE Sekunden ein Schreibvorgang."""
        if self.speicher is None:
            return
        with self._timer_lock:
            if self._timer is None:
                self._timer = threading.Timer(SPEICHER_PAUSE, self.sofort_sichern)
                self._timer.daemon = True
                self._timer.start()

    def sofort_sichern(self):
        with self._timer_lock:
            if self._timer is not None:
                self._timer.cancel()
            self._timer = None
        if self.speicher is None:
            return
        with self.tafel.lock:
            daten = self.tafel.export_zustand()
        try:
            self.speicher.speichern(daten)
        except Exception:  # Sichern darf den Unterricht nie unterbrechen
            log.exception("Tafel konnte nicht gesichert werden")

    def laden(self):
        """Zustand aus dem Speicher übernehmen (Start, Snapshot geladen, Fortsetzungsstunde)."""
        if self.speicher is None:
            return False
        try:
            daten = self.speicher.laden()
            with self.tafel.lock:
                if daten:
                    self.tafel.import_zustand(daten)
                else:
                    self.tafel.zuruecksetzen()
            return bool(daten)
        except (ValueError, TypeError, KeyError):
            log.exception("Gespeicherte Tafel unlesbar – starte leer")
            with self.tafel.lock:
                self.tafel.zuruecksetzen()
            return False

    def neu_laden_und_senden(self):
        """Für den Host: nach Snapshot-Laden, Reset oder IServ-Abschluss aufrufen."""
        with self._timer_lock:
            if self._timer is not None:
                self._timer.cancel()
            self._timer = None
        self.laden()
        with self.tafel.lock:
            self.alles_senden()

    def person_entfernen(self, person_id):
        """Für den Host: beim Löschen eines Lernplatzes aufrufen (Datenschutz)."""
        with self.tafel.lock:
            self.tafel.person_entfernen(person_id)
            self.alles_senden()
        self.sofort_sichern()

    def beenden(self):
        """Für den Host: Tafel beenden (z. B. weil ein Präsentationsmodus startet)."""
        with self.tafel.lock:
            if self.tafel.modus == "aus":
                return
            self.tafel.modus_setzen("aus")
            self.alles_senden()
        self.aenderung()

    # ---------- AB-Karten ----------
    def ab_karte_objekt(self, schueler_id, aufgabe_id, anzeige_name, oid=None, x=450, y=250, karte=None):
        """Karte aus dem Server-Adapter bauen – oder die vom Browser gelieferte Karte prüfen."""
        x, y = zahl(x, *BEREICHE["x"]), zahl(y, *BEREICHE["y"])
        if oid is not None and (not isinstance(oid, str) or not 0 < len(oid) <= 40):
            raise Abgelehnt("Ungültige Objekt-ID.")
        if self.ab is not None:
            aufgabe = self.ab.aufgabe_des_schuelers(schueler_id, aufgabe_id)
            if aufgabe is None:
                raise Abgelehnt("Diese Aufgabe gibt es nicht.")
            if not aufgabe["bearbeitet"]:
                raise Abgelehnt("Diese Aufgabe ist noch nicht bearbeitet.")
            daten = {"titel": aufgabe["titel"], "aufgabentyp": aufgabe["typ"], "niveau": aufgabe["niveau"],
                     "inhalt": aufgabe["inhalt"]}
        else:
            try:
                daten = aufgaben.karte_bereinigen(karte)
            except ValueError as e:
                raise Abgelehnt(str(e))
        return dict(daten, id=oid or "ab-" + secrets.token_hex(5), typ="ab_karte", x=x, y=y, anzeige_name=anzeige_name)

    # geschätzte Größe großer Karten auf der Tafel (für einen freien Platz)
    KARTEN_GROESSE = {"aufgabe": (640, 360), "ab_karte": (580, 260)}
    FREIE_PLAETZE = ((30, 100), (830, 100), (30, 540), (830, 540))  # oben bleibt Platz für Datum, Überschrift, Status

    def karte_legen(self, person, objekt, ausser=None):
        """Große Karten (Aufgaben, AB-Antworten) nicht übereinander legen: freier Platz im
        2×2-Raster, sonst der Wunschplatz, sonst leicht versetzt."""
        vorhanden = self.tafel.seiten[self.tafel.aktuelle_seite]["objekte"]
        b, h = self.KARTEN_GROESSE.get(objekt.get("typ"), (300, 150))

        def ueberlappt(x, y):
            for o in vorhanden:
                ob, oh = self.KARTEN_GROESSE.get(o.get("typ"), (0, 0))
                if ob and x < o.get("x", 0) + ob and o.get("x", 0) < x + b and y < o.get("y", 0) + oh and o.get("y", 0) < y + h:
                    return True
            return any(abs(o.get("x", 0) - x) < 25 and abs(o.get("y", 0) - y) < 25 for o in vorhanden)

        # große Karten zuerst ins Raster (die Mitte würde alle Rasterplätze überdecken), dann der Wunschplatz
        gross = objekt.get("typ") in self.KARTEN_GROESSE
        kandidaten = [*self.FREIE_PLAETZE, (objekt["x"], objekt["y"])] if gross else [(objekt["x"], objekt["y"])]
        frei = next(((x, y) for x, y in kandidaten if not ueberlappt(x, y)), None)
        if frei:
            objekt["x"], objekt["y"] = frei
        else:
            for _ in range(12):
                if not any(abs(o.get("x", 0) - objekt["x"]) < 25 and abs(o.get("y", 0) - objekt["y"]) < 25 for o in vorhanden):
                    break
                objekt["x"] += 40
                objekt["y"] += 40
        op = self.tafel.hinzufuegen(person, self.tafel.aktuelle_seite, objekt)
        self.an_tafel("tafel:op", op, ausser=ausser)
        return op

    def loesung_fuer(self, obj):
        if self.ab is not None:
            return self.ab.loesung(obj.get("aufgabe_id"), obj.get("niveau"))
        return self.tafel.loesungen.get(obj["id"])


def _datei_url(url):
    return url is None or (isinstance(url, str) and url.startswith(DATEI_PREFIX) and len(url) < 80)


def _gueltiges_objekt(obj):
    if not isinstance(obj, dict):
        raise Abgelehnt("Ungültiges Objekt.")
    oid = obj.get("id")
    if not isinstance(oid, str) or not 0 < len(oid) <= 40:
        raise Abgelehnt("Ungültige Objekt-ID.")
    if obj.get("typ") in ("ab_karte", "aufgabe"):
        raise Abgelehnt("Aufgaben und AB-Karten werden über eigene Knöpfe gelegt.")
    if len(obj.get("punkte", [])) > MAX_PUNKTE:
        raise Abgelehnt("Strich zu lang.")
    if obj.get("typ") == "bild" and not (obj.get("url") and _datei_url(obj.get("url"))):
        raise Abgelehnt("Bilder müssen hochgeladen werden.")
    for k in ("dx", "dy", "breite", "hoehe", "groesse", "farbe", "staerke"):
        if k in obj:
            zahl(obj[k], -5000, 5000)
    for punkt in obj.get("punkte", []):
        if not isinstance(punkt, list) or len(punkt) != 3:
            raise Abgelehnt("Ungültiger Strich.")
        for w in punkt:
            zahl(w, -5000, 5000)


def _seitennummer(d):
    seite = d.get("seite")
    if isinstance(seite, bool) or not isinstance(seite, int):
        raise Abgelehnt("Ungültige Seite.")
    return seite


def registriere(socketio, server):
    tafel = server.tafel
    ns = server.ns

    def person():
        return server.verbindungen.get(request.sid)

    def geschuetzt(fn):
        """Fängt Abgelehnt/KeyError ab, sperrt die Tafel während der Änderung, antwortet per Ack
        und plant das Sichern, wenn sich die Tafel geändert hat."""
        def wrapper(daten=None):
            p = person()
            if p is None:
                return _fehler("Nicht angemeldet.")
            if daten is not None and not isinstance(daten, dict):
                return _fehler("Ungültige Anfrage.")
            try:
                with tafel.lock:
                    vorher = tafel.version
                    antwort = fn(p, daten or {}) or {"ok": True}
                    geaendert = tafel.version != vorher
                if geaendert:
                    server.aenderung()
                return antwort
            except Abgelehnt as e:
                server.emit("tafel:abgelehnt", {"grund": e.grund}, request.sid)
                return _fehler(e.grund)
            except (KeyError, ValueError, TypeError) as e:
                grund = "Das Objekt gibt es nicht mehr." if isinstance(e, KeyError) else "Ungültige Anfrage."
                server.emit("tafel:abgelehnt", {"grund": grund}, request.sid)
                return _fehler(grund)
        wrapper.__name__ = fn.__name__
        return wrapper

    def nur_lehrer(fn):
        def inner(p, d):
            if not p.ist_lehrer:
                raise Abgelehnt("Nur für die Lehrkraft.")
            return fn(p, d)
        inner.__name__ = fn.__name__
        return geschuetzt(inner)

    def schueler_von(d, schluessel="schueler_id"):
        schueler = server.host.schueler(d.get(schluessel))
        if schueler is None:
            raise Abgelehnt("Unbekannter Schüler.")
        return schueler

    # ---------- Verbindung ----------
    def verbinden(auth=None):
        p = server.host.person_socket(auth if isinstance(auth, dict) else {})
        if p is None:
            return False
        server.verbindungen[request.sid] = p
        join_room("lehrer" if p.ist_lehrer else "schueler")
        join_room("p_" + p.id)
        with tafel.lock:
            server.zustand_senden(request.sid, p)
            server.schuelerliste_senden()
            if p.ist_lehrer:
                server.emit("lehrer:angebote", [server._angebot_ohne_karte(a) for a in tafel.angebote], request.sid)
            else:
                eigene = [server._angebot_ohne_karte(a) for a in tafel.angebote if a["schueler_id"] == p.id]
                server.emit("ab:angebote", eigene, request.sid)
        return True

    def trennen(*_):
        p = server.verbindungen.pop(request.sid, None)
        if p is None:
            return
        with tafel.lock:
            if not any(q.id == p.id for q in server.verbindungen.values()):
                for oid in tafel.sperren_von(p.id):
                    server.an_tafel("tafel:sperre", {"id": oid, "name": None})
                for oid, feld in tafel.feld_sperren_von(p.id):
                    server.an_tafel("tafel:feld_sperre", {"id": oid, "feld": feld, "name": None})
            server.schuelerliste_senden()

    socketio.on_event("connect", verbinden, namespace=ns)
    socketio.on_event("disconnect", trennen, namespace=ns)

    # ---------- Objekte ----------
    @geschuetzt
    def op(p, d):
        seite, art = _seitennummer(d), d.get("op")
        if art == "add":
            _gueltiges_objekt(d.get("objekt"))
            pruefe(tafel, p, "add", objekt=d["objekt"], seite=seite)
            ergebnis = tafel.hinzufuegen(p, seite, d["objekt"])
        elif art in ("update", "delete"):
            obj = tafel.objekt(seite, d.get("id"))
            if obj is None:
                raise KeyError(d.get("id"))
            halter = tafel.sperren.get(obj["id"])
            if halter and halter[0] != p.id:
                raise Abgelehnt(f"Wird gerade von {halter[1]} bewegt.")
            if art == "update":
                aenderungen = d.get("aenderungen")
                if not isinstance(aenderungen, dict):
                    raise TypeError
                pruefe(tafel, p, "update", objekt=obj, aenderungen=aenderungen, seite=seite)
                ergebnis = tafel.aendern(p, seite, obj["id"], aenderungen)
            else:
                pruefe(tafel, p, "delete", objekt=obj, seite=seite)
                ergebnis = tafel.loeschen(p, seite, obj["id"])
                if obj.get("typ") == "aufgabe":
                    server.an_tafel("tafel:op", ergebnis, ausser=request.sid)
                    server.alles_senden(mit_seiten=False)
                    return {"ok": True, "version": ergebnis["version"]}
        else:
            raise ValueError(art)
        server.an_tafel("tafel:op", ergebnis, ausser=request.sid)
        return {"ok": True, "version": ergebnis["version"], "objekt": ergebnis.get("objekt"),
                "index": ergebnis.get("index")}

    @geschuetzt
    def vorne(p, d):
        seite = _seitennummer(d)
        obj = tafel.objekt(seite, d.get("id"))
        if obj is None:
            raise KeyError(d.get("id"))
        pruefe(tafel, p, "vorne", seite=seite)
        halter = tafel.sperren.get(obj["id"])
        if halter and halter[0] != p.id:
            raise Abgelehnt(f"Wird gerade von {halter[1]} bewegt.")
        ergebnis = tafel.nach_vorne(seite, obj["id"])
        server.an_tafel("tafel:op", ergebnis)
        return {"ok": True, "version": ergebnis["version"]}

    def undo_redo(richtung):
        @geschuetzt
        def handler(p, d):
            pruefe(tafel, p, "undo")
            schritt = tafel.naechster_schritt(p, richtung)
            if schritt and not p.ist_lehrer:
                aktion, objekt, aenderungen, seite = schritt
                pruefe(tafel, p, aktion, objekt=objekt, aenderungen=aenderungen, seite=seite)
            ergebnis = tafel.undo(p) if richtung == "undo" else tafel.redo(p)
            if ergebnis:
                server.an_tafel("tafel:op", ergebnis)
            return {"ok": True, "leer": ergebnis is None}
        handler.__name__ = "tafel_" + richtung
        return handler

    @geschuetzt
    def greifen(p, d):
        pruefe(tafel, p, "greifen")
        if not tafel.greifen(p, d.get("id")):
            raise Abgelehnt(f"Wird gerade von {tafel.sperren[d.get('id')][1]} bewegt.")
        server.an_tafel("tafel:sperre", {"id": d.get("id"), "name": p.name}, ausser=request.sid)

    @geschuetzt
    def loslassen(p, d):
        halter = tafel.sperren.get(d.get("id"))
        if halter and halter[0] == p.id:
            tafel.loslassen(p, d.get("id"))
            server.an_tafel("tafel:sperre", {"id": d.get("id"), "name": None}, ausser=request.sid)

    @geschuetzt
    def ab_karte(p, d):
        pruefe(tafel, p, "add", objekt={"typ": "ab_karte"})
        objekt = server.ab_karte_objekt(p.id, d.get("aufgabe_id"), p.name, d.get("id"),
                                        d.get("x", 450), d.get("y", 250), karte=d.get("karte"))
        ergebnis = server.karte_legen(p, objekt)
        return {"ok": True, "version": ergebnis["version"], "objekt": ergebnis["objekt"]}

    # ---------- Flüchtiges (wird nicht gespeichert) ----------
    def fluechtig(ereignis, werkzeug_von, bereinigen=None):
        def handler(d=None):
            p = person()
            d = d if isinstance(d, dict) else {}
            if p is None:
                return
            try:
                pruefe(tafel, p, "live", werkzeug=werkzeug_von(d))
                if bereinigen:
                    d = bereinigen(p, d)
            except (Abgelehnt, KeyError, TypeError, ValueError):
                return
            if d is None:
                return
            d.update({"person_id": p.id, "name": p.name})
            server.an_tafel(ereignis, d, ausser=request.sid)
        handler.__name__ = ereignis.replace(":", "_")
        return handler

    def bewegen_bereinigen(p, d):
        obj = tafel.objekt(tafel.aktuelle_seite, d.get("id"))
        halter = obj and tafel.sperren.get(obj["id"])
        if obj is None or (halter and halter[0] != p.id):
            return None
        return {"id": obj["id"], "seite": tafel.aktuelle_seite,
                "x": zahl(d.get("x"), *BEREICHE["x"]), "y": zahl(d.get("y"), *BEREICHE["y"])}

    def form_bereinigen(p, d):
        objekt = d.get("objekt")
        if objekt is None:
            return {"objekt": None}
        if not isinstance(objekt, dict) or objekt.get("typ") != "form":
            return None
        objekt = {k: v for k, v in objekt.items() if k in FORM_FELDER}
        for k in ("x", "y", "dx", "dy", "farbe", "staerke"):
            zahl(objekt.get(k, 0), -5000, 5000)
        return {"objekt": objekt}

    @geschuetzt
    def ansicht(p, d):
        pruefe(tafel, p, "ansicht")
        tafel.ansicht_setzen(d.get("zoom", 1), d.get("x", 0), d.get("y", 0))
        server.an_tafel("tafel:ansicht", dict(tafel.ansicht, version=tafel.version), ausser=request.sid)

    @geschuetzt
    def seite(p, d):
        pruefe(tafel, p, "seite")
        index = d.get("index")
        if isinstance(index, bool) or not isinstance(index, int):
            raise Abgelehnt("Ungültige Seite.")
        tafel.seite_waehlen(index)
        server.alles_senden()  # Schüler erhalten immer nur die gezeigte Seite

    @geschuetzt
    def melden(p, d):
        pruefe(tafel, p, "melden")
        tafel.melden(p, bool(d.get("an", True)))
        tafel.version += 1
        server.alles_senden(mit_seiten=False)

    @geschuetzt
    def zustand_anfordern(p, d):
        server.zustand_senden(request.sid, p)

    # ---------- Lehrer ----------
    @nur_lehrer
    def l_modus(p, d):
        if d.get("modus") == "live" and tafel.modus != "live":
            server.host.vor_start()
        tafel.modus_setzen(d.get("modus"))
        server.alles_senden()

    @nur_lehrer
    def l_zuschalten(p, d):
        tafel.zuschalten(schueler_von(d), d.get("eingabe"))
        server.alles_senden(mit_seiten=False)

    @nur_lehrer
    def l_eingabe(p, d):
        schueler = schueler_von(d)
        if d.get("eingabe") not in ("tastatur", "wortbank"):
            raise Abgelehnt("Ungültige Eingabeart.")
        tafel.eingabe[schueler.id] = d["eingabe"]
        tafel.version += 1
        server.alles_senden(mit_seiten=False)

    # ---------- Aufgaben an der Tafel ----------
    def aufgabe_auf_seite(d):
        seite = d.get("seite", tafel.aktuelle_seite)
        if isinstance(seite, bool) or not isinstance(seite, int):
            raise Abgelehnt("Ungültige Seite.")
        obj = tafel.objekt(seite, d.get("id"))
        if obj is None or obj.get("typ") != "aufgabe":
            raise KeyError(d.get("id"))
        return seite, obj

    @nur_lehrer
    def l_aufgabe_holen(p, d):
        if server.ab is not None:
            leer = server.ab.aufgabe_leer(d.get("aufgabe_id"), d.get("niveau"))
            loesung = None
        else:  # Browser-Adapter: Aufgabe und Lösung kommen von der Lehrkraft
            try:
                leer = aufgaben.aufgabe_bereinigen(d.get("aufgabe"))
                loesung = aufgaben.loesung_bereinigen(leer, d.get("loesung"))
            except ValueError as e:
                raise Abgelehnt(str(e))
        if leer is None:
            raise Abgelehnt("Diese Aufgabe gibt es in diesem Niveau nicht.")
        objekt = dict(leer, id="auf-" + secrets.token_hex(5), typ="aufgabe", felder={}, geprueft=False,
                      x=zahl(d.get("x", 300), *BEREICHE["x"]), y=zahl(d.get("y", 120), *BEREICHE["y"]))
        if loesung:
            tafel.loesungen[objekt["id"]] = loesung
        ergebnis = server.karte_legen(p, objekt)
        tafel.aufgabe_vermerken(objekt, "geholt")
        server.alles_senden(mit_seiten=False)
        return {"ok": True, "id": objekt["id"], "version": ergebnis["version"]}

    @geschuetzt
    def feld(p, d):
        seite, obj = aufgabe_auf_seite(d)
        pruefe(tafel, p, "feld", seite=seite)
        try:
            ergebnis = tafel.feld_setzen(p, seite, obj["id"], d.get("feld"), d.get("wert"))
        except PermissionError as e:
            raise Abgelehnt(f"{e.args[0]} bearbeitet dieses Feld gerade.")
        if str(d.get("wert") or "").strip():
            tafel.aufgabe_vermerken(obj, "bearbeitet")
        server.an_tafel("tafel:op", ergebnis, ausser=request.sid)
        return {"ok": True, "version": ergebnis["version"], "felder": ergebnis["aenderungen"]["felder"]}

    @geschuetzt
    def feld_fokus(p, d):
        seite, obj = aufgabe_auf_seite(d)
        pruefe(tafel, p, "feld", seite=seite)
        feldname = d.get("feld")
        if d.get("an", True):
            if not tafel.feld_greifen(p, obj["id"], feldname):
                raise Abgelehnt(f"{tafel.feld_sperren[(obj['id'], feldname)][1]} bearbeitet dieses Feld gerade.")
            server.an_tafel("tafel:feld_sperre", {"id": obj["id"], "feld": feldname, "name": p.name}, ausser=request.sid)
        elif tafel.feld_loslassen(p, obj["id"], feldname):
            server.an_tafel("tafel:feld_sperre", {"id": obj["id"], "feld": feldname, "name": None}, ausser=request.sid)

    @nur_lehrer
    def l_pruefen(p, d):
        seite, obj = aufgabe_auf_seite(d)
        loesung = server.loesung_fuer(obj)
        if loesung is None:
            raise Abgelehnt("Diese Aufgabe wird nicht automatisch geprüft – bitte selbst besprechen.")
        ergebnis, zaehler = tafel.pruefen(p, seite, obj["id"], loesung)
        tafel.aufgabe_vermerken(obj, "geprueft")
        server.an_tafel("tafel:op", ergebnis)
        server.alles_senden(mit_seiten=False)
        return {"ok": True, **zaehler}

    @nur_lehrer
    def l_loesung_einsetzen(p, d):
        seite, obj = aufgabe_auf_seite(d)
        loesung = server.loesung_fuer(obj)
        if loesung is None:
            raise Abgelehnt("Für diese Aufgabe ist keine Lösung hinterlegt.")
        ergebnis = tafel.loesung_einsetzen(p, seite, obj["id"], loesung, d.get("feld"))
        tafel.aufgabe_vermerken(obj, "geprueft")
        server.an_tafel("tafel:op", ergebnis)
        server.alles_senden(mit_seiten=False)

    # ---------- Momentaufnahmen ----------
    @nur_lehrer
    def l_merken(p, d):
        m = tafel.merken()
        tafel.version += 1
        server.alles_senden(mit_seiten=False)
        return {"ok": True, "id": m and m["id"]}

    @nur_lehrer
    def l_notiz(p, d):
        tafel.notiz(d.get("moment_id"), d.get("text", ""))
        tafel.version += 1

    @nur_lehrer
    def l_fortsetzen(p, d):
        tafel.fortsetzen(d.get("moment_id"))
        server.alles_senden()

    @nur_lehrer
    def l_abziehen(p, d):
        tafel.abziehen(d.get("schueler_id"))
        server.alles_senden(mit_seiten=False)

    @nur_lehrer
    def l_einfrieren(p, d):
        tafel.einfrieren(bool(d.get("an")))
        server.alles_senden(mit_seiten=False)

    @nur_lehrer
    def l_leeren(p, d):
        tafel.leeren(alle=bool(d.get("alle")))
        server.alles_senden()

    @nur_lehrer
    def l_einstellungen(p, d):
        erlaubt = {"werkzeuge", "einsatzarten", "farbe_pro_schueler", "tafelbild_an_alle", "datum_zeigen"}
        tafel.einstellungen(**{k: v for k, v in d.items() if k in erlaubt})
        server.alles_senden(mit_seiten=False)

    @nur_lehrer
    def l_ueberschrift(p, d):
        tafel.ueberschrift_setzen(d.get("text"))
        server.alles_senden(mit_seiten=False)
        return {"ok": True, "text": tafel.ueberschrift}

    @nur_lehrer
    def l_hintergrund(p, d):
        tafel.hintergrund_setzen(d.get("seite", tafel.aktuelle_seite), d.get("art"))
        server.alles_senden()

    @nur_lehrer
    def l_vorlage(p, d):
        if not _datei_url(d.get("url")):
            raise Abgelehnt("Ungültige Vorlage.")
        tafel.vorlage_setzen(d.get("seite", tafel.aktuelle_seite), d.get("url"))
        server.alles_senden()

    @nur_lehrer
    def l_seite_neu(p, d):
        if not _datei_url(d.get("vorlage_url")):
            raise Abgelehnt("Ungültige Vorlage.")
        index = tafel.seite_neu(vorlage_url=d.get("vorlage_url"), hintergrund=d.get("hintergrund"))
        if d.get("wechseln", True):
            tafel.seite_waehlen(index)
        server.alles_senden()
        return {"ok": True, "index": index}

    @nur_lehrer
    def l_seite_loeschen(p, d):
        if len(tafel.seiten) <= 1:
            raise Abgelehnt("Die letzte Seite bleibt.")
        tafel.seite_loeschen(d.get("index"))
        server.alles_senden()

    @nur_lehrer
    def l_ab_antwort(p, d):
        schueler = schueler_von(d)
        name = "Schülerlösung" if d.get("anonym") else schueler.name
        objekt = server.ab_karte_objekt(schueler.id, d.get("aufgabe_id"), name, None,
                                        d.get("x", 450), d.get("y", 250), karte=d.get("karte"))
        ergebnis = server.karte_legen(p, objekt)
        return {"ok": True, "version": ergebnis["version"]}

    @nur_lehrer
    def l_angebot_annehmen(p, d):
        angebot = next((a for a in tafel.angebote if a["id"] == d.get("angebot_id")), None)
        if angebot is None:
            raise Abgelehnt("Das Angebot gibt es nicht mehr.")
        schueler = schueler_von(angebot)
        objekt = server.ab_karte_objekt(schueler.id, angebot["aufgabe_id"], schueler.name, karte=angebot.get("karte"))
        tafel.angebot_entfernen(angebot["id"])
        tafel.zuschalten(schueler)
        server.karte_legen(schueler, objekt)
        server.alles_senden(mit_seiten=False)
        server.angebote_senden()

    @nur_lehrer
    def l_angebot_ablehnen(p, d):
        tafel.angebot_entfernen(d.get("angebot_id"))
        tafel.version += 1
        server.angebote_senden()

    @nur_lehrer
    def l_meldung_weg(p, d):
        schueler = server.host.schueler(d.get("schueler_id"))
        if schueler:
            tafel.melden(schueler, False)
        tafel.version += 1
        server.alles_senden(mit_seiten=False)

    handler = {
        "tafel:op": op,
        "tafel:undo": undo_redo("undo"),
        "tafel:redo": undo_redo("redo"),
        "tafel:greifen": greifen,
        "tafel:loslassen": loslassen,
        "tafel:ab_karte": ab_karte,
        "tafel:live_strich": fluechtig("tafel:live_strich", lambda d: "marker" if d.get("marker") else "stift"),
        "tafel:laser": fluechtig("tafel:laser", lambda d: "laser"),
        "tafel:lineal": fluechtig("tafel:lineal", lambda d: "lineal"),
        "tafel:bewegen": fluechtig("tafel:bewegen", lambda d: "auswahl", bewegen_bereinigen),
        "tafel:form_vorschau": fluechtig("tafel:form_vorschau", lambda d: "formen", form_bereinigen),
        "tafel:vorne": vorne,
        "tafel:status": fluechtig("tafel:status", lambda d: STATUS_WERKZEUG.get(d.get("taetigkeit"))),
        "tafel:ansicht": ansicht,
        "tafel:seite": seite,
        "tafel:melden": melden,
        "tafel:zustand_anfordern": zustand_anfordern,
        "tafel:feld": feld,
        "tafel:feld_fokus": feld_fokus,
        "lehrer:modus": l_modus,
        "lehrer:zuschalten": l_zuschalten,
        "lehrer:eingabe": l_eingabe,
        "lehrer:aufgabe_holen": l_aufgabe_holen,
        "lehrer:pruefen": l_pruefen,
        "lehrer:loesung_einsetzen": l_loesung_einsetzen,
        "lehrer:merken": l_merken,
        "lehrer:notiz": l_notiz,
        "lehrer:fortsetzen": l_fortsetzen,
        "lehrer:abziehen": l_abziehen,
        "lehrer:einfrieren": l_einfrieren,
        "lehrer:leeren": l_leeren,
        "lehrer:einstellungen": l_einstellungen,
        "lehrer:hintergrund": l_hintergrund,
        "lehrer:ueberschrift": l_ueberschrift,
        "lehrer:vorlage": l_vorlage,
        "lehrer:seite_neu": l_seite_neu,
        "lehrer:seite_loeschen": l_seite_loeschen,
        "lehrer:ab_antwort": l_ab_antwort,
        "lehrer:angebot_annehmen": l_angebot_annehmen,
        "lehrer:angebot_ablehnen": l_angebot_ablehnen,
        "lehrer:meldung_weg": l_meldung_weg,
    }
    for name, fn in handler.items():
        socketio.on_event(name, fn, namespace=ns)
