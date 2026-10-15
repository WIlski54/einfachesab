"""HTTP-Schnittstellen der Tafel als Blueprint unter /tafel/…

Identität kommt vom Host (`person_http`), Dateien liegen im Host-Speicher.
"""
import base64
import datetime as dt
import json
import re
import secrets
from functools import wraps

from flask import Blueprint, Response, abort, jsonify, request

from . import aufgaben
from .ereignisse import DATEI_PREFIX
from .speicher import DATEINAME
from .tuersteher import Abgelehnt, pruefe

MAX_UPLOAD = 5 * 1024 * 1024
SIGNATUREN = {b"\xff\xd8\xff": "jpg", b"\x89PNG": "png", b"%PDF": "pdf"}
MIME = {"jpg": "image/jpeg", "png": "image/png", "pdf": "application/pdf"}


def dateityp(kopf):
    for signatur, endung in SIGNATUREN.items():
        if kopf.startswith(signatur):
            return endung
    return None


class _Arbeitsspeicher:
    """Ersatz, wenn der Host keinen Speicher hat (nur Tests/Demo)."""

    def __init__(self):
        self.dateien = {}

    def datei_speichern(self, name, daten):
        self.dateien[name] = daten

    def datei_lesen(self, name):
        return self.dateien.get(name)


def blueprint(server, archiv=False):
    bp = Blueprint("tafel", __name__)
    tafel, host = server.tafel, server.host
    dateien = server.speicher or _Arbeitsspeicher()

    def angemeldet(nur_lehrer=False):
        def deko(fn):
            @wraps(fn)
            def inner(*a, **kw):
                person = host.person_http(request)
                if person is None:
                    return jsonify(ok=False, grund="Bitte neu anmelden."), 401
                if nur_lehrer and not person.ist_lehrer:
                    return jsonify(ok=False, grund="Nur für die Lehrkraft."), 403
                return fn(person, *a, **kw)
            return inner
        return deko

    def datei_annehmen(erlaubt):
        datei = request.files.get("datei")
        if datei is None:
            return None, (jsonify(ok=False, grund="Keine Datei."), 400)
        daten = datei.read(MAX_UPLOAD + 1)
        if len(daten) > MAX_UPLOAD:
            return None, (jsonify(ok=False, grund="Die Datei ist größer als 5 MB."), 413)
        endung = dateityp(daten[:8])
        if endung not in erlaubt:
            return None, (jsonify(ok=False, grund="Nur PNG oder PDF." if "pdf" in erlaubt
                                  else "Nur Fotos (JPEG/PNG) sind erlaubt."), 400)
        name = f"{secrets.token_hex(16)}.{endung}"
        dateien.datei_speichern(name, daten)
        return DATEI_PREFIX + name, None

    @bp.errorhandler(413)
    def zu_gross(_):
        return jsonify(ok=False, grund="Die Datei ist zu groß."), 413

    @bp.get("/tafel/datei/<name>")
    def datei(name):
        if not DATEINAME.match(name):
            abort(404)
        daten = dateien.datei_lesen(name)
        if daten is None:
            abort(404)
        return Response(daten, mimetype=MIME[name.rsplit(".", 1)[1]], headers={"Cache-Control": "private, max-age=3600"})

    @bp.get("/tafel/api/ich")
    @angemeldet()
    def ich(person):
        return jsonify(ok=True, person=person.als_dict())

    # ---------- Uploads ----------
    @bp.post("/tafel/api/foto")
    @angemeldet()
    def foto(person):
        try:
            with tafel.lock:
                pruefe(tafel, person, "upload_foto")
        except Abgelehnt as e:
            return jsonify(ok=False, grund=e.grund), 403
        url, fehler = datei_annehmen({"jpg", "png"})
        return fehler or jsonify(ok=True, url=url)

    @bp.post("/tafel/api/vorlage")
    @angemeldet(nur_lehrer=True)
    def vorlage(person):
        url, fehler = datei_annehmen({"jpg", "png"})
        return fehler or jsonify(ok=True, url=url)

    @bp.post("/tafel/api/tafelbild")
    @angemeldet(nur_lehrer=True)
    def tafelbild(person):
        url, fehler = datei_annehmen({"png", "pdf"})
        if fehler:
            return fehler
        with tafel.lock:
            tafel.tafelbild_url = url
            tafel.version += 1
        server.aenderung()
        server.emit("ab:tafelbild", {"url": url}, "schueler")
        return jsonify(ok=True, url=url)

    # ---------- Schüler ----------
    @bp.get("/tafel/api/status")
    @angemeldet()
    def status(person):
        with tafel.lock:
            eigene = [server._angebot_ohne_karte(a) for a in tafel.angebote if a["schueler_id"] == person.id]
            return jsonify(ok=True, tafelbild_url=tafel.tafelbild_url, angebote=eigene, modus=tafel.modus)

    @bp.get("/tafel/api/meine_aufgaben")
    @angemeldet()
    def meine_aufgaben(person):
        if server.ab is None:
            return jsonify(ok=False, grund="Aufgaben liefert hier das Arbeitsblatt im Browser."), 404
        return jsonify(ok=True, aufgaben=server.ab.aufgaben_des_schuelers(person.id))

    @bp.post("/tafel/api/angebot")
    @angemeldet()
    def angebot(person):
        d = request.get_json(silent=True) or {}
        aufgabe_id = str(d.get("aufgabe_id", ""))[:40]
        karte = None
        if server.ab is not None:
            aufgabe = server.ab.aufgabe_des_schuelers(person.id, aufgabe_id)
            if aufgabe is None or not aufgabe["bearbeitet"]:
                return jsonify(ok=False, grund="Bearbeite die Aufgabe zuerst."), 400
            titel = aufgabe["titel"]
        else:
            try:
                karte = aufgaben.karte_bereinigen(d.get("karte"))
            except ValueError:
                return jsonify(ok=False, grund="Bearbeite die Aufgabe zuerst."), 400
            titel = karte["titel"]
        with tafel.lock:
            neu = tafel.angebot_neu(person, aufgabe_id, titel)
            if karte:
                neu["karte"] = karte
            tafel.version += 1
            server.angebote_senden()
        server.aenderung()
        return jsonify(ok=True, angebot=server._angebot_ohne_karte(neu))

    @bp.delete("/tafel/api/angebot/<angebot_id>")
    @angemeldet()
    def angebot_weg(person, angebot_id):
        with tafel.lock:
            eintrag = next((a for a in tafel.angebote if a["id"] == angebot_id), None)
            if eintrag is None or eintrag["schueler_id"] != person.id:
                return jsonify(ok=False, grund="Angebot nicht gefunden."), 404
            tafel.angebot_entfernen(angebot_id)
            tafel.version += 1
            server.angebote_senden()
        server.aenderung()
        return jsonify(ok=True)

    # ---------- Lehrkraft ----------
    @bp.get("/tafel/api/lehrer/schueler/<schueler_id>/aufgaben")
    @angemeldet(nur_lehrer=True)
    def schueler_aufgaben(person, schueler_id):
        if server.ab is None:
            return jsonify(ok=False, grund="Aufgaben liefert hier das Arbeitsblatt im Browser."), 404
        if host.schueler(schueler_id) is None:
            return jsonify(ok=False, grund="Unbekannter Schüler."), 404
        return jsonify(ok=True, aufgaben=server.ab.aufgaben_des_schuelers(schueler_id))

    @bp.get("/tafel/api/lehrer/aufgaben")
    @angemeldet(nur_lehrer=True)
    def aufgabenliste(person):
        if server.ab is None:
            return jsonify(ok=False, grund="Aufgaben liefert hier das Arbeitsblatt im Browser."), 404
        with tafel.lock:
            vorne = list(tafel.am_brett)
        liste = server.ab.aufgabenliste()
        for a in liste:
            vorschlag = next((server.ab.niveau_des_schuelers(sid, a["aufgabe_id"]) for sid in vorne), None)
            a["vorschlag"] = vorschlag if vorschlag in a["niveaus"] else (a["niveaus"][0] if a["niveaus"] else None)
        return jsonify(ok=True, aufgaben=liste)

    @bp.get("/tafel/api/lehrer/momente")
    @angemeldet(nur_lehrer=True)
    def momente(person):
        with tafel.lock:
            return jsonify(ok=True, momente=tafel.momente_liste())

    @bp.get("/tafel/api/lehrer/momente/<moment_id>")
    @angemeldet(nur_lehrer=True)
    def moment(person, moment_id):
        with tafel.lock:
            try:
                return jsonify(ok=True, moment=tafel.moment_holen(moment_id))
            except KeyError:
                return jsonify(ok=False, grund="Momentaufnahme nicht gefunden."), 404

    # ---------- Archiv als Datei (nur Prototyp; im AB übernimmt das der Snapshot) ----------
    if archiv:
        def _upload_namen(daten):
            return set(re.findall(r"/tafel/datei/([a-f0-9]{32}\.(?:jpg|png|pdf))", json.dumps(daten)))

        @bp.get("/tafel/api/lehrer/archiv")
        @angemeldet(nur_lehrer=True)
        def archiv_holen(person):
            with tafel.lock:
                daten = tafel.archiv()
            daten["uploads"] = {}
            for name in _upload_namen(daten):
                roh = dateien.datei_lesen(name)
                if roh is not None:
                    daten["uploads"][name] = base64.b64encode(roh).decode("ascii")
            name = "Tafel_" + dt.datetime.now().strftime("%Y-%m-%d_%H%M") + ".json"
            return Response(json.dumps(daten, ensure_ascii=False), mimetype="application/json",
                            headers={"Content-Disposition": f'attachment; filename="{name}"'})

        @bp.post("/tafel/api/lehrer/archiv")
        @angemeldet(nur_lehrer=True)
        def archiv_laden(person):
            datei = request.files.get("datei")
            try:
                daten = json.loads(datei.read().decode("utf-8")) if datei else None
                if not isinstance(daten, dict):
                    raise ValueError("Keine gültige Datei.")
                for name, inhalt in (daten.pop("uploads", None) or {}).items():
                    roh = base64.b64decode(inhalt, validate=True)
                    if not DATEINAME.match(name) or dateityp(roh[:8]) != name.rsplit(".", 1)[1] or len(roh) > MAX_UPLOAD:
                        raise ValueError("Die Datei enthält ungültige Bilder.")
                    dateien.datei_speichern(name, roh)
                with tafel.lock:
                    anzahl = tafel.archiv_laden(daten)
                    tafel.version += 1
                    server.alles_senden(mit_seiten=False)
                server.aenderung()
            except (ValueError, UnicodeDecodeError, json.JSONDecodeError, TypeError, AttributeError) as e:
                grund = str(e) if isinstance(e, ValueError) else "Die Datei konnte nicht gelesen werden."
                return jsonify(ok=False, grund=grund), 400
            return jsonify(ok=True, neu=anzahl)

    return bp
