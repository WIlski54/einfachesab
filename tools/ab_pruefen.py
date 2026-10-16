#!/usr/bin/env python3
"""Konsistenzprüfung für ein (neu gebautes) Arbeitsblatt – VOR dem Ausliefern ausführen.

    python tools/ab_pruefen.py            # im Projektordner

Prüft, dass templates/ab_inhalt.html und tafel_aufgaben.py zusammenpassen:
  * jede Aufgabe im AB hat eine Tafel-Fassung (VARIANTEN) – und umgekehrt
  * Anzahl und Reihenfolge der Eingabefelder im AB == Felder der Tafel-Aufgabe (a<N>.f<k> = Tafel-Feld k)
  * Schalenmodell-Aufgaben haben das Widget (data-widget="bohr"), Freitext-Aufgaben genau 1 textarea
  * jede Lösung ist vollständig, wird vom Server akzeptiert und gilt für die eigene Musterlösung als „richtig“
  * AB_META ist vollständig
Rückgabewert 0 = alles in Ordnung, 1 = Fehler (werden aufgelistet).
"""
import os
import re
import sys
from html.parser import HTMLParser

BASIS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASIS)

from tafel.aufgaben import feld_ids, loesung_bereinigen, pruefen, aufgabe_bereinigen  # noqa: E402
import tafel_aufgaben as ta  # noqa: E402


class _AB(HTMLParser):
    """Sammelt je Aufgabe: Anzahl Eingabefelder (ohne ‚vorstellen‘/‚Hilfe‘) und Widgets – wie static/js/ab.js."""

    def __init__(self):
        super().__init__()
        self.aufgabe = None
        self.tiefe = 0
        self.daten = {}

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "section" and a.get("data-aufgabe", "").isdigit():
            self.aufgabe = a["data-aufgabe"]
            self.daten[self.aufgabe] = {"felder": 0, "bohr": 0, "textarea": 0, "checkbox": 0}
            return
        if self.aufgabe is None:
            return
        d = self.daten[self.aufgabe]
        if tag in ("input", "textarea") and "data-vorstellen" not in a and "data-hilfe" not in a:
            if a.get("type") in ("button", "submit", "hidden"):
                return
            d["felder"] += 1
            d["textarea"] += tag == "textarea"
            d["checkbox"] += a.get("type") == "checkbox"
        if a.get("data-widget") == "bohr":
            d["bohr"] += 1

    def handle_endtag(self, tag):
        if tag == "section":
            self.aufgabe = None


def main():
    fehler, hinweise = [], []
    with open(os.path.join(BASIS, "templates", "ab_inhalt.html"), encoding="utf-8") as f:
        html = f.read()
    p = _AB()
    p.feed(html)
    ab = p.daten
    if not ab:
        fehler.append('ab_inhalt.html: keine <section data-aufgabe="N"> gefunden.')
    nummern = sorted(ab, key=int)
    if nummern != [str(i) for i in range(1, len(nummern) + 1)]:
        fehler.append(f"Aufgaben im AB müssen 1..n lückenlos nummeriert sein, gefunden: {nummern}")
    if sorted(ta.VARIANTEN) != nummern:
        fehler.append(f"Tafel-Fassungen {sorted(ta.VARIANTEN)} passen nicht zu den AB-Aufgaben {nummern}.")

    for nr in nummern:
        v, d = ta.VARIANTEN.get(nr), ab[nr]
        if v is None:
            continue
        o = ta.aufgabe_leer(nr, ta.KNOPF)
        if o is None:
            fehler.append(f"Aufgabe {nr}: aufgabe_leer liefert nichts.")
            continue
        typ = o["aufgabentyp"]
        try:
            o = aufgabe_bereinigen(o)          # genau die Prüfung, die der Server beim Einsetzen macht
        except Exception as e:                  # noqa: BLE001
            fehler.append(f"Aufgabe {nr}: Tafel-Aufgabe wird vom Server abgelehnt ({e}).")
            continue
        ids = feld_ids(o)
        if typ == "schalen":
            if d["bohr"] < 1:
                fehler.append(f'Aufgabe {nr}: Typ „schalen“ braucht im AB ein <div data-widget="bohr"> (Feld a{nr}.w1).')
        elif typ == "freitext":
            if d["felder"] != 1 or d["textarea"] != 1:
                fehler.append(f"Aufgabe {nr}: Typ „freitext“ braucht genau 1 <textarea> im AB (gefunden: {d['felder']} Felder).")
        elif typ in ("lueckentext", "tabelle"):
            if d["felder"] != len(ids):
                fehler.append(f"Aufgabe {nr}: AB hat {d['felder']} Eingabefelder, die Tafel-Aufgabe {len(ids)} Felder "
                              f"– Reihenfolge/Anzahl müssen übereinstimmen (a{nr}.f1 … a{nr}.f{len(ids)}).")
        else:
            hinweise.append(f"Aufgabe {nr}: Typ „{typ}“ wird nicht aus dem AB vorbelegt (nur freie Tafel-Aufgabe).")

        # Lösung
        l = ta.loesung(nr, ta.KNOPF)
        if typ == "freitext":
            continue
        if not l:
            fehler.append(f"Aufgabe {nr}: keine Lösung hinterlegt.")
            continue
        try:
            l = loesung_bereinigen(o, l)
        except ValueError as e:
            fehler.append(f"Aufgabe {nr}: Lösung ungültig ({e}) – max. 8 Varianten je Feld, keine leeren Texte.")
            continue
        fehlt = [i for i in ids if i not in l]
        if fehlt:
            fehler.append(f"Aufgabe {nr}: keine Lösung für Feld(er) {fehlt}.")
            continue
        # Musterlösung muss als richtig gelten
        o["felder"] = {i: {"wert": l[i][0], "von_id": "x", "von": "x", "status": None, "alt": None} for i in ids}
        _, z = pruefen(o, l)
        if z["falsch"]:
            fehler.append(f"Aufgabe {nr}: die eigene Musterlösung wird als falsch gewertet ({z}).")

    meta = open(os.path.join(BASIS, "app.py"), encoding="utf-8").read()
    for k in ("schule", "titel", "fach", "klasse"):
        m = re.search(r"AB_META\s*=\s*\{.*?'%s':\s*'([^']*)'" % k, meta, re.S)
        if not m or not m.group(1).strip():
            fehler.append(f"app.py: AB_META['{k}'] fehlt oder ist leer.")
    if "Chemie" in html and "'fach': 'Chemie'" not in meta:
        hinweise.append("ab_inhalt.html erwähnt „Chemie“, AB_META['fach'] ist aber anders – bitte prüfen.")

    for h in hinweise:
        print("HINWEIS ", h)
    for e in fehler:
        print("FEHLER  ", e)
    if fehler:
        print(f"\n{len(fehler)} Fehler – bitte beheben.")
        return 1
    print(f"OK – {len(nummern)} Aufgaben, AB und Tafel-Fassungen sind konsistent.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
