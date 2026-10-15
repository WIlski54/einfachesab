"""Der Tafel-Zustand – die „echte Tafel“ auf dem Server.

Reine Logik ohne Netzwerk: Die SocketIO-Handler prüfen zuerst mit dem Türsteher
und rufen dann diese Methoden auf. Jede Änderung erhöht `version`.
"""
import copy
import datetime
import math
import secrets
import threading
import time

from . import aufgaben
from .werkzeuge import EINSATZARTEN, HINTERGRUENDE, SCHUELER_WERKZEUGE, werkzeuge_fuer_einsatzarten

MODI = ("aus", "vorbereitung", "live")
EINGABEARTEN = ("tastatur", "wortbank")
ARCHIV_FORMAT = "gsm-tafel-1"
SCHUELERFARBEN = (1, 2, 3, 4, 5)  # Paletten-Indizes (0 = Grundfarbe bleibt dem Lehrer)
ERZWUNGENE_FARBE = {"strich", "form", "text", "formel"}


def _neue_seite(hintergrund="leer", vorlage_url=None):
    return {"id": "p-" + secrets.token_hex(4), "hintergrund": hintergrund,
            "vorlage_url": vorlage_url, "objekte": []}


def _heute():
    return datetime.date.today().isoformat()


class Tafel:
    def __init__(self):
        self.lock = threading.RLock()
        self.modus = "aus"
        self.eingefroren = False
        self.einsatzarten = {"A"}
        self.werkzeuge = werkzeuge_fuer_einsatzarten(self.einsatzarten)
        self.farbe_pro_schueler = False
        self.tafelbild_an_alle = False
        self.tafelbild_url = None
        self.am_brett = []          # Schüler-IDs in Zuschalt-Reihenfolge
        self.brett_namen = {}       # id -> Name
        self.schuelerfarben = {}    # id -> Paletten-Index
        self.seiten = [_neue_seite()]
        self.aktuelle_seite = 0
        self.ansicht = {"zoom": 1, "x": 0, "y": 0}
        self.meldungen = {}         # id -> Name (in Meldereihenfolge)
        self.angebote = []
        self.sperren = {}           # objekt_id -> (person_id, name)
        self.verlauf = {}           # person_id -> {"undo": [], "redo": []}
        self.eingabe = {}           # schueler_id -> "tastatur" | "wortbank"
        self.feld_sperren = {}      # (objekt_id, feld) -> (person_id, name)
        self.auftritte = {}         # schueler_id -> {"start": Zeit, "gemerkt": bool}
        self.momente = []           # Momentaufnahmen für den Rückblick (nur Lehrkraft)
        self.loesungen = {}         # aufgabe_objekt_id -> {feld: [Antworten]} – bleibt auf dem Server
        self.aufgaben_verlauf = {}  # aufgabe_id -> {niveaus, geholt, bearbeitet, geprueft, zuletzt} (Überblick Lehrkraft)
        self.datum = _heute()  # steht oben links, wird bei jedem Start erneuert
        self.datum_zeigen = True
        self.ueberschrift = ""      # von der Lehrkraft, kein Tafelobjekt – Leeren/Radierer/Rückgängig lassen sie stehen
        self.version = 0

    # ---------- Hilfen ----------
    def _hoch(self):
        self.version += 1
        return self.version

    def _seite(self, seite):
        if not isinstance(seite, int) or not 0 <= seite < len(self.seiten):
            raise KeyError(f"Seite {seite} gibt es nicht")
        return self.seiten[seite]

    def objekt(self, seite, oid):
        for obj in self._seite(seite)["objekte"]:
            if obj["id"] == oid:
                return obj
        return None

    def _index(self, seite, oid):
        for i, obj in enumerate(self._seite(seite)["objekte"]):
            if obj["id"] == oid:
                return i
        return -1

    def _verlauf(self, person_id):
        return self.verlauf.setdefault(person_id, {"undo": [], "redo": []})

    @staticmethod
    def _autor_id(person):
        return "lehrer" if person.ist_lehrer else person.id

    # ---------- Objekte ----------
    def _einfuegen(self, seite, obj, index=None):
        liste = self._seite(seite)["objekte"]
        if index is None or index > len(liste):
            liste.append(obj)
            return len(liste) - 1
        liste.insert(index, obj)
        return index

    def hinzufuegen(self, person, seite, objekt, protokoll=True):
        if not objekt.get("id") or self.objekt(seite, objekt["id"]) is not None:
            raise ValueError("Objekt-ID fehlt oder ist schon vergeben")
        obj = copy.deepcopy(objekt)
        obj.setdefault("x", 0)
        obj.setdefault("y", 0)
        obj.setdefault("rotation", 0)
        obj.setdefault("skala", 1)
        obj["autor"] = self._autor_id(person)
        obj["autor_name"] = person.name
        if (not person.ist_lehrer and self.farbe_pro_schueler
                and obj.get("typ") in ERZWUNGENE_FARBE and person.id in self.schuelerfarben):
            obj["farbe"] = self.schuelerfarben[person.id]
        index = self._einfuegen(seite, obj)
        if protokoll:
            v = self._verlauf(person.id)
            v["undo"].append({"art": "add", "seite": seite, "objekt": copy.deepcopy(obj), "index": index})
            v["redo"].clear()
        return {"op": "add", "seite": seite, "objekt": copy.deepcopy(obj), "index": index,
                "version": self._hoch()}

    def aendern(self, person, seite, oid, aenderungen, protokoll=True):
        obj = self.objekt(seite, oid)
        if obj is None:
            raise KeyError(oid)
        vorher = {k: obj.get(k) for k in aenderungen}
        obj.update(copy.deepcopy(aenderungen))
        if protokoll:
            v = self._verlauf(person.id)
            v["undo"].append({"art": "update", "seite": seite, "id": oid,
                              "vorher": vorher, "nachher": copy.deepcopy(aenderungen)})
            v["redo"].clear()
        return {"op": "update", "seite": seite, "id": oid, "aenderungen": copy.deepcopy(aenderungen),
                "version": self._hoch()}

    def loeschen(self, person, seite, oid):
        index = self._index(seite, oid)
        if index < 0:
            raise KeyError(oid)
        obj = self._seite(seite)["objekte"].pop(index)
        self.sperren.pop(oid, None)
        v = self._verlauf(person.id)
        v["undo"].append({"art": "delete", "seite": seite, "objekt": obj, "index": index})
        v["redo"].clear()
        return {"op": "delete", "seite": seite, "id": oid, "version": self._hoch()}

    def _anwenden(self, eintrag, rueckwaerts, person_id=None):
        """Wendet einen Verlaufseintrag (rückwärts = Undo) an. None, wenn nicht mehr möglich."""
        art, seite = eintrag["art"], eintrag["seite"]
        if seite >= len(self.seiten):
            return None
        oid = eintrag["objekt"]["id"] if "objekt" in eintrag else eintrag["id"]
        halter = self.sperren.get(oid)
        if halter and halter[0] != person_id:
            return None
        entfernen = (art == "add") == rueckwaerts
        if art in ("add", "delete"):
            oid = eintrag["objekt"]["id"]
            if entfernen:
                index = self._index(seite, oid)
                if index < 0:
                    return None
                self._seite(seite)["objekte"].pop(index)
                self.sperren.pop(oid, None)
                return {"op": "delete", "seite": seite, "id": oid, "version": self._hoch()}
            if self.objekt(seite, oid) is not None:
                return None
            obj = copy.deepcopy(eintrag["objekt"])
            index = self._einfuegen(seite, obj, eintrag["index"])
            return {"op": "add", "seite": seite, "objekt": copy.deepcopy(obj), "index": index,
                    "version": self._hoch()}
        obj = self.objekt(seite, eintrag["id"])
        if obj is None:
            return None
        werte = eintrag["vorher"] if rueckwaerts else eintrag["nachher"]
        obj.update(copy.deepcopy(werte))
        return {"op": "update", "seite": seite, "id": eintrag["id"], "aenderungen": copy.deepcopy(werte),
                "version": self._hoch()}

    def naechster_schritt(self, person, richtung):
        """Was Undo/Redo als Nächstes täte – für die Rechteprüfung vorab.
        Liefert (aktion, objekt, aenderungen, seite) oder None."""
        stapel = self._verlauf(person.id)["undo" if richtung == "undo" else "redo"]
        if not stapel:
            return None
        e = stapel[-1]
        rueckwaerts = richtung == "undo"
        if e["art"] == "update":
            obj = self.objekt(e["seite"], e["id"]) if e["seite"] < len(self.seiten) else None
            return ("update", obj, e["vorher"] if rueckwaerts else e["nachher"], e["seite"]) if obj else None
        entfernen = (e["art"] == "add") == rueckwaerts
        return ("delete" if entfernen else "add", e["objekt"], None, e["seite"])

    def undo(self, person):
        v = self._verlauf(person.id)
        while v["undo"]:
            eintrag = v["undo"].pop()
            op = self._anwenden(eintrag, rueckwaerts=True, person_id=person.id)
            if op:
                v["redo"].append(eintrag)
                return op
        return None

    def redo(self, person):
        v = self._verlauf(person.id)
        while v["redo"]:
            eintrag = v["redo"].pop()
            op = self._anwenden(eintrag, rueckwaerts=False, person_id=person.id)
            if op:
                v["undo"].append(eintrag)
                return op
        return None

    def nach_vorne(self, seite, oid):
        """Objekt in der Zeichenreihenfolge ganz nach oben – ID und Autor bleiben."""
        index = self._index(seite, oid)
        if index < 0:
            raise KeyError(oid)
        liste = self._seite(seite)["objekte"]
        liste.append(liste.pop(index))
        return {"op": "vorne", "seite": seite, "id": oid, "version": self._hoch()}

    # ---------- Sperren beim Anfassen ----------
    def greifen(self, person, oid):
        halter = self.sperren.get(oid)
        if halter and halter[0] != person.id:
            return False
        self.sperren[oid] = (person.id, person.name)
        return True

    def loslassen(self, person, oid):
        if self.sperren.get(oid, (None,))[0] == person.id:
            del self.sperren[oid]

    def sperren_von(self, person_id):
        ids = [oid for oid, (pid, _) in self.sperren.items() if pid == person_id]
        for oid in ids:
            del self.sperren[oid]
        return ids

    # ---------- Seiten & Hintergrund ----------
    def leeren(self, alle):
        indizes = range(len(self.seiten)) if alle else [self.aktuelle_seite]
        self.moment("leeren", [i for i in indizes if self.seiten[i]["objekte"]])
        ziele = self.seiten if alle else [self._seite(self.aktuelle_seite)]
        for seite in ziele:
            seite["objekte"] = []
        self.verlauf.clear()
        self.sperren.clear()
        self.feld_sperren.clear()
        self._hoch()

    def seite_neu(self, vorlage_url=None, hintergrund=None):
        hintergrund = hintergrund or self._seite(self.aktuelle_seite)["hintergrund"]
        self.seiten.append(_neue_seite(hintergrund, vorlage_url))
        self._hoch()
        return len(self.seiten) - 1

    def hintergrund_setzen(self, seite, art):
        if art not in HINTERGRUENDE:
            raise ValueError(art)
        self._seite(seite)["hintergrund"] = art
        self._hoch()

    def vorlage_setzen(self, seite, url):
        self._seite(seite)["vorlage_url"] = url
        self._hoch()

    def seite_loeschen(self, index):
        self._seite(index)
        if len(self.seiten) <= 1:
            raise ValueError("Die letzte Seite bleibt.")
        self.seiten.pop(index)
        self.verlauf.clear()
        self.sperren.clear()
        if index < self.aktuelle_seite:
            self.aktuelle_seite -= 1
        self.aktuelle_seite = min(self.aktuelle_seite, len(self.seiten) - 1)
        self._hoch()

    def einfrieren(self, an):
        self.eingefroren = an
        self._hoch()

    def seite_waehlen(self, index):
        self._seite(index)
        self.aktuelle_seite = index
        self.ansicht = {"zoom": 1, "x": 0, "y": 0}
        self._hoch()

    def ansicht_setzen(self, zoom, x, y):
        werte = [float(zoom), float(x), float(y)]
        if not all(math.isfinite(w) for w in werte):
            raise ValueError("Ungültige Ansicht")
        zoom = min(4, max(1, werte[0]))
        self.ansicht = {"zoom": zoom, "x": min(1500, max(0, werte[1])), "y": min(1000, max(0, werte[2]))}
        self._hoch()

    # ---------- Wer ist vorne ----------
    def ist_am_brett(self, person_id):
        return person_id in self.am_brett

    def zuschalten(self, person, eingabe=None):
        if eingabe is not None:
            if eingabe not in EINGABEARTEN:
                raise ValueError(eingabe)
            self.eingabe[person.id] = eingabe
        self.eingabe.setdefault(person.id, "tastatur")
        if person.id not in self.am_brett:
            self.am_brett.append(person.id)
            self.auftritte[person.id] = {"start": time.time(), "gemerkt": False}
        self.brett_namen[person.id] = person.name
        if person.id not in self.schuelerfarben:
            belegt = set(self.schuelerfarben.values())
            frei = [f for f in SCHUELERFARBEN if f not in belegt]
            self.schuelerfarben[person.id] = frei[0] if frei else SCHUELERFARBEN[len(self.am_brett) % 5]
        self.meldungen.pop(person.id, None)
        self._hoch()

    def abziehen(self, person_id):
        if person_id in self.am_brett:
            self._auftritt_sichern(person_id)
            self.am_brett.remove(person_id)
        self.feld_sperren_von(person_id)
        self.brett_namen.pop(person_id, None)
        self.schuelerfarben.pop(person_id, None)
        self.sperren_von(person_id)
        self._hoch()

    def melden(self, person, an):
        if an:
            self.meldungen[person.id] = person.name
        else:
            self.meldungen.pop(person.id, None)

    # ---------- Angebote („Ich möchte das vorstellen“) ----------
    def angebot_neu(self, person, aufgabe_id, titel):
        for a in self.angebote:
            if a["schueler_id"] == person.id and a["aufgabe_id"] == aufgabe_id:
                return a
        angebot = {"id": "an-" + secrets.token_hex(4), "schueler_id": person.id, "name": person.name,
                   "aufgabe_id": aufgabe_id, "titel": titel}
        self.angebote.append(angebot)
        return angebot

    def angebot_entfernen(self, angebot_id):
        for a in self.angebote:
            if a["id"] == angebot_id:
                self.angebote.remove(a)
                return a
        return None

    # ---------- Einstellungen & Modus ----------
    def einstellungen(self, werkzeuge=None, einsatzarten=None, farbe_pro_schueler=None,
                      tafelbild_an_alle=None, datum_zeigen=None):
        if einsatzarten is not None:
            self.einsatzarten = {a for a in einsatzarten if a in EINSATZARTEN}
            if werkzeuge is None:
                self.werkzeuge = werkzeuge_fuer_einsatzarten(self.einsatzarten)
        if werkzeuge is not None:
            self.werkzeuge = {w for w in werkzeuge if w in SCHUELER_WERKZEUGE}
        if farbe_pro_schueler is not None:
            self.farbe_pro_schueler = bool(farbe_pro_schueler)
        if tafelbild_an_alle is not None:
            self.tafelbild_an_alle = bool(tafelbild_an_alle)
        if datum_zeigen is not None:
            self.datum_zeigen = bool(datum_zeigen)
        self._hoch()

    UEBERSCHRIFT_MAX = 120

    def ueberschrift_setzen(self, text):
        """Überschrift der Tafel (nur Lehrkraft, Prüfung im Ereignis). Leer = keine Überschrift."""
        text = " ".join(str(text or "").split())[:self.UEBERSCHRIFT_MAX]
        if text != self.ueberschrift:
            self.ueberschrift = text
            self._hoch()
        return text

    def modus_setzen(self, modus):
        if modus not in MODI:
            raise ValueError(modus)
        if modus == "aus" and self.modus == "live":
            for pid in list(self.am_brett):
                self._auftritt_sichern(pid)
            self.moment("ende", [i for i, s in enumerate(self.seiten) if s["objekte"]])
        self.modus = modus
        if modus != "aus":
            # Beim Starten (auch als Fortsetzung am nächsten Tag) steht das heutige Datum an der Tafel.
            self.datum = _heute()
        if modus == "aus":
            self.feld_sperren.clear()
            self.auftritte.clear()
            self.am_brett.clear()
            self.brett_namen.clear()
            self.schuelerfarben.clear()
            self.meldungen.clear()
            self.sperren.clear()
            self.eingefroren = False
        self._hoch()

    # ---------- Aufgaben: Felder, Prüfen, Lösung ----------
    def _aufgabe(self, seite, oid):
        obj = self.objekt(seite, oid)
        if obj is None or obj.get("typ") != "aufgabe":
            raise KeyError(oid)
        return obj

    def feld_greifen(self, person, oid, feld):
        halter = self.feld_sperren.get((oid, feld))
        if halter and halter[0] != person.id:
            return False
        self.feld_sperren[(oid, feld)] = (person.id, person.name)
        return True

    def feld_loslassen(self, person, oid, feld):
        if self.feld_sperren.get((oid, feld), (None,))[0] == person.id:
            del self.feld_sperren[(oid, feld)]
            return True
        return False

    def feld_sperren_von(self, person_id):
        weg = [k for k, (pid, _) in self.feld_sperren.items() if pid == person_id]
        for k in weg:
            del self.feld_sperren[k]
        return weg

    def feld_setzen(self, person, seite, oid, feld, wert):
        obj = self._aufgabe(seite, oid)
        halter = self.feld_sperren.get((oid, feld))
        if halter and halter[0] != person.id:
            raise PermissionError(halter[1])
        felder = aufgaben.feld_setzen(obj, feld, wert, person)
        return self.aendern(person, seite, oid, {"felder": felder}, protokoll=False)

    def pruefen(self, person, seite, oid, loesung):
        obj = self._aufgabe(seite, oid)
        felder, zaehler = aufgaben.pruefen(obj, loesung)
        op = self.aendern(person, seite, oid, {"felder": felder, "geprueft": True}, protokoll=False)
        return op, zaehler

    def loesung_einsetzen(self, person, seite, oid, loesung, feld=None):
        obj = self._aufgabe(seite, oid)
        felder = aufgaben.loesung_einsetzen(obj, loesung, feld)
        return self.aendern(person, seite, oid, {"felder": felder, "geprueft": True}, protokoll=False)

    def aufgabe_vermerken(self, obj, art):
        """Überblick für die Lehrkraft: welche AB-Aufgabe war wann in welchem Niveau an der Tafel."""
        aid = str(obj.get("aufgabe_id") or "")
        if not aid:
            return
        eintrag = self.aufgaben_verlauf.setdefault(aid, {"niveaus": [], "geholt": 0, "bearbeitet": False,
                                                         "geprueft": False, "zuletzt": time.time()})
        niveau = obj.get("niveau")
        if niveau and niveau not in eintrag["niveaus"]:
            eintrag["niveaus"].append(niveau)
        if art == "geholt":
            eintrag["geholt"] += 1
        elif art in ("bearbeitet", "geprueft"):
            eintrag[art] = True
        eintrag["zuletzt"] = time.time()

    # ---------- Momentaufnahmen (Rückblick) ----------
    def _beteiligte(self, indizes):
        ids = []
        for i in indizes:
            for o in self.seiten[i]["objekte"]:
                kandidaten = [o.get("autor")] + [f.get("von_id") for f in (o.get("felder") or {}).values() if f]
                for pid in kandidaten:
                    if pid and pid != "lehrer" and pid not in ids:
                        ids.append(pid)
        return ids

    def _name(self, pid):
        if pid in self.brett_namen:
            return self.brett_namen[pid]
        for s in self.seiten:
            for o in s["objekte"]:
                if o.get("autor") == pid:
                    return o.get("autor_name", "?")
                for f in (o.get("felder") or {}).values():
                    if f and f.get("von_id") == pid:
                        return f.get("von", "?")
        return "?"

    def moment(self, art, indizes, schueler=None, start=None, gemerkt=False):
        """Legt eine Momentaufnahme an (Kopie der Seiten). Leere Aufnahmen entstehen nicht."""
        indizes = [i for i in indizes if 0 <= i < len(self.seiten)]
        if not indizes:
            return None
        schueler = schueler if schueler is not None else self._beteiligte(indizes)
        m = {"id": "m-" + secrets.token_hex(4), "art": art, "zeit": time.time(), "start": start,
             "schueler": [{"id": pid, "name": self._name(pid)} for pid in schueler],
             "seiten": [{"index": i, "seite": copy.deepcopy(self.seiten[i])} for i in indizes],
             "gemerkt": gemerkt, "notiz": "", "datum": self.datum if self.datum_zeigen else None,
             "ueberschrift": self.ueberschrift}
        self.momente.append(m)
        return m

    def _auftritt_sichern(self, pid):
        auftritt = self.auftritte.pop(pid, None) or {"start": None, "gemerkt": False}
        indizes = [i for i, s in enumerate(self.seiten)
                   if any(aufgaben.beteiligt(o, pid) for o in s["objekte"])] or [self.aktuelle_seite]
        return self.moment("auftritt", indizes, schueler=[pid], start=auftritt["start"],
                           gemerkt=auftritt["gemerkt"])

    def merken(self):
        """⭐ Den aktuellen Moment festhalten und laufende Auftritte markieren."""
        for a in self.auftritte.values():
            a["gemerkt"] = True
        return self.moment("merken", [self.aktuelle_seite], schueler=list(self.am_brett), gemerkt=True)

    def notiz(self, moment_id, text):
        for m in self.momente:
            if m["id"] == moment_id:
                m["notiz"] = str(text)[:2000]
                return m
        raise KeyError(moment_id)

    def momente_liste(self):
        """Übersicht ohne Seiteninhalte (für die Liste im Rückblick)."""
        return [{k: v for k, v in m.items() if k != "seiten"} | {"seitenzahl": len(m["seiten"]),
                "objekte": sum(len(s["seite"]["objekte"]) for s in m["seiten"])} for m in self.momente]

    def moment_holen(self, moment_id):
        for m in self.momente:
            if m["id"] == moment_id:
                return copy.deepcopy(m)
        raise KeyError(moment_id)

    def fortsetzen(self, moment_id):
        """Die Tafel eines Moments wieder auflegen (ersetzt die aktuelle Tafel)."""
        m = self.moment_holen(moment_id)
        self.seiten = [s["seite"] for s in m["seiten"]]
        for s in self.seiten:
            for o in s["objekte"]:
                if o.get("typ") == "aufgabe":
                    for f in (o.get("felder") or {}).values():
                        if f:
                            f.pop("gesperrt", None)
        self.aktuelle_seite = 0
        self.ansicht = {"zoom": 1, "x": 0, "y": 0}
        self.verlauf.clear()
        self.sperren.clear()
        self.feld_sperren.clear()
        self._hoch()

    # ---------- Archiv (im Prototyp statt IServ-Snapshot) ----------
    def archiv(self):
        return {"format": ARCHIV_FORMAT, "zeit": time.time(), "seiten": copy.deepcopy(self.seiten),
                "aktuelle_seite": self.aktuelle_seite, "momente": copy.deepcopy(self.momente),
                "loesungen": copy.deepcopy(self.loesungen)}

    def archiv_laden(self, daten):
        """Momentaufnahmen einer früheren Stunde übernehmen; die aktuelle Tafel bleibt unverändert.
        Die Tafel am Ende der Stunde wird als eigener Moment „ende“ verfügbar."""
        if not isinstance(daten, dict) or daten.get("format") != ARCHIV_FORMAT:
            raise ValueError("Das ist keine gesicherte Tafel-Stunde.")
        momente = daten.get("momente")
        seiten = daten.get("seiten")
        if not isinstance(momente, list) or not isinstance(seiten, list):
            raise ValueError("Die Datei ist unvollständig.")
        for m in momente:
            if not isinstance(m, dict) or not isinstance(m.get("seiten"), list) or "id" not in m:
                raise ValueError("Die Datei ist beschädigt.")
            for s in m["seiten"]:
                if not isinstance(s, dict) or not isinstance(s.get("seite", {}).get("objekte"), list):
                    raise ValueError("Die Datei ist beschädigt.")
        momente = copy.deepcopy(momente)
        if not any(m.get("art") == "ende" for m in momente) and any(s.get("objekte") for s in seiten):
            # Tafel noch nicht beendet gesichert: Stand der Tafel als „ende“ (stabile ID, damit nicht doppelt)
            zeit = daten.get("zeit", time.time())
            momente.append({"id": f"m-stand-{int(zeit)}", "art": "ende", "zeit": zeit,
                            "start": None, "schueler": [], "gemerkt": False, "notiz": "",
                            "seiten": [{"index": i, "seite": copy.deepcopy(s)} for i, s in enumerate(seiten)]})
        vorhanden = {m["id"] for m in self.momente}
        neu = [m for m in momente if m["id"] not in vorhanden]
        for m in neu:
            m["geladen"] = True
        if isinstance(daten.get("loesungen"), dict):
            for oid, l in daten["loesungen"].items():
                self.loesungen.setdefault(oid, l)
        self.momente = sorted(self.momente + neu, key=lambda m: m.get("zeit", 0))
        return len(neu)

    # ---------- Dauerhafte Speicherung (Neustart übersteht die Tafel) ----------
    DAUERHAFT = ("modus", "eingefroren", "farbe_pro_schueler", "tafelbild_an_alle", "tafelbild_url", "am_brett",
                 "brett_namen", "schuelerfarben", "seiten", "aktuelle_seite", "ansicht", "meldungen", "angebote",
                 "eingabe", "auftritte", "momente", "loesungen", "aufgaben_verlauf", "datum", "datum_zeigen",
                 "ueberschrift", "version")

    def export_zustand(self):
        daten = {k: copy.deepcopy(getattr(self, k)) for k in self.DAUERHAFT}
        daten.update(format=ARCHIV_FORMAT, werkzeuge=sorted(self.werkzeuge), einsatzarten=sorted(self.einsatzarten))
        return daten

    def import_zustand(self, daten):
        if not isinstance(daten, dict) or daten.get("format") != ARCHIV_FORMAT:
            raise ValueError("Unbekanntes Speicherformat.")
        if not isinstance(daten.get("seiten"), list) or not daten["seiten"]:
            raise ValueError("Keine Seiten gespeichert.")
        for k in self.DAUERHAFT:
            if k in daten:
                setattr(self, k, copy.deepcopy(daten[k]))
        self.werkzeuge = {w for w in daten.get("werkzeuge", []) if w in SCHUELER_WERKZEUGE}
        self.einsatzarten = {a for a in daten.get("einsatzarten", []) if a in EINSATZARTEN}
        self.aktuelle_seite = min(max(0, int(self.aktuelle_seite)), len(self.seiten) - 1)
        self.sperren, self.feld_sperren, self.verlauf = {}, {}, {}
        self._hoch()

    def person_entfernen(self, person_id):
        """Datenschutz: Alles, was diese Person an der Tafel beigetragen hat, entfernen
        (Objekte, Feldeinträge, Momente, Angebote, Meldungen)."""
        def seite_bereinigen(seite):
            seite["objekte"] = [o for o in seite["objekte"] if o.get("autor") != person_id]
            for o in seite["objekte"]:
                for feld, f in list((o.get("felder") or {}).items()):
                    if f and f.get("von_id") == person_id:
                        del o["felder"][feld]
        for seite in self.seiten:
            seite_bereinigen(seite)
        for m in self.momente:
            for s in m["seiten"]:
                seite_bereinigen(s["seite"])
            m["schueler"] = [s for s in m["schueler"] if s["id"] != person_id]
        self.momente = [m for m in self.momente if not (m["art"] == "auftritt" and not m["schueler"])]
        self.angebote = [a for a in self.angebote if a["schueler_id"] != person_id]
        self.meldungen.pop(person_id, None)
        if person_id in self.am_brett:
            self.am_brett.remove(person_id)
        for d in (self.brett_namen, self.schuelerfarben, self.eingabe, self.auftritte, self.verlauf):
            d.pop(person_id, None)
        self.sperren_von(person_id)
        self.feld_sperren_von(person_id)
        self._hoch()

    def zuruecksetzen(self):
        """Alles auf Anfang (z. B. nach dem IServ-Abschluss des ABs). Das Lock bleibt dasselbe."""
        lock = self.lock
        self.__init__()
        self.lock = lock

    # ---------- Ausgabe ----------
    def serialisiere(self, fuer_lehrer):
        if not fuer_lehrer and self.modus != "live":
            return {"modus": self.modus, "version": self.version}
        daten = {
            "modus": self.modus,
            "eingefroren": self.eingefroren,
            "seiten": copy.deepcopy(self.seiten) if fuer_lehrer else [
                copy.deepcopy(s) if i == self.aktuelle_seite
                else {"id": s["id"], "hintergrund": s["hintergrund"], "vorlage_url": None, "objekte": []}
                for i, s in enumerate(self.seiten)],
            "aktuelle_seite": self.aktuelle_seite,
            "ansicht": dict(self.ansicht),
            "farbe_pro_schueler": self.farbe_pro_schueler,
            "datum": self.datum if self.datum_zeigen else None,
            "datum_zeigen": self.datum_zeigen,
            "ueberschrift": self.ueberschrift,
            "am_brett": [{"id": i, "name": self.brett_namen.get(i, "?"), "farbe": self.schuelerfarben.get(i)}
                         for i in self.am_brett],
            "sperren": {oid: name for oid, (_, name) in self.sperren.items()},
            "feld_sperren": [{"id": oid, "feld": f, "name": name} for (oid, f), (_, name) in self.feld_sperren.items()],
            "version": self.version,
        }
        if fuer_lehrer:
            daten.update({
                "werkzeuge": sorted(self.werkzeuge),
                "einsatzarten": sorted(self.einsatzarten),
                "tafelbild_an_alle": self.tafelbild_an_alle,
                "tafelbild_url": self.tafelbild_url,
                "meldungen": [{"id": i, "name": n} for i, n in self.meldungen.items()],
                "angebote": copy.deepcopy(self.angebote),
                "eingabe": dict(self.eingabe),
                "aufgaben_verlauf": copy.deepcopy(self.aufgaben_verlauf),
                "momente_anzahl": len(self.momente),
            })
        return daten

    def rechte_fuer(self, person):
        if person.ist_lehrer:
            return {"modus": self.modus, "am_brett": True, "lehrer": True, "eingefroren": False,
                    "werkzeuge": list(SCHUELER_WERKZEUGE), "eigene_farbe": None}
        vorne = self.ist_am_brett(person.id)
        if vorne:
            werkzeuge = [w for w in SCHUELER_WERKZEUGE if w in self.werkzeuge and w != "melden"]
        else:
            werkzeuge = ["melden"] if "melden" in self.werkzeuge else []
        return {"modus": self.modus, "am_brett": vorne, "lehrer": False, "eingefroren": self.eingefroren,
                "eingabe": self.eingabe.get(person.id, "tastatur"),
                "werkzeuge": werkzeuge, "gemeldet": person.id in self.meldungen,
                "eigene_farbe": self.schuelerfarben.get(person.id) if self.farbe_pro_schueler else None}
