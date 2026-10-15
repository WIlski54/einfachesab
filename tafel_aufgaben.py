"""Aufgaben des Arbeitsblatts für die digitale Tafel (Server-Adapter).

Diese Datei gehört zum INHALT des Arbeitsblatts (wie templates/ab_inhalt.html): Wer ein neues AB
baut, ändert hier die Tafel-Fassungen. Die Lösungen bleiben auf dem Server und gehen nie an die
Schüler:innen.

Zwei Dinge sind hier beschrieben:
1. AUFGABEN_AB    – wie die Antworten aus dem AB als „Karte“ an die Tafel kommen
                    (Feldnummern = Reihenfolge der Eingabefelder in ab_inhalt.html: a<Aufgabe>.f<Nr>).
2. VARIANTEN      – die leeren Tafel-Aufgaben (eine Fassung je Aufgabe) samt Lösung, die live gelöst werden.
"""
import json

# Es gibt bewusst nur EINE Fassung je Aufgabe (keine Niveaus A/B/C). Die Tafel braucht aber einen Schlüssel
# für den Knopf in der Aufgabenliste; er steht nur dort (Knopftext) und erscheint nicht auf der Tafel.
KNOPF = "an die Tafel"

# ---------- Tafel-Fassungen (leer + Lösung) ----------
# lueckentext: teile (None = Lücke), loesung je Lücke (Liste akzeptierter Antworten), wortbank
# zuordnung:   links (Zeilen), optionen, loesung {zeile: option}
# mc:          frage, optionen, loesung
# richtigfalsch: aussagen [(Text, "richtig"|"falsch")]
# freitext:    frage
def _schalen(*zahlen):
    """„2,1“ darf auch als „2 1“, „2-1“, „2/1“ … geschrieben werden."""
    return [t.join(str(z) for z in zahlen) for t in (",", ", ", " ", "-", "/", ";", "|", ".")]


# Die Tafel-Fassungen entsprechen dem AB (gleiche Felder, gleiche Reihenfolge wie in ab_inhalt.html): Was eine Person
# im AB eingetragen hat, steht an der Tafel schon in den Feldern und lässt sich dort per Tastatur ergänzen.
# (Aufgabe 4 – Schalenmodell – hat keine Tafel-Fassung; sie kommt als Karte mit der gesetzten Elektronenzahl.)
VARIANTEN = {
    "1": {"titel": "Aufgabe 1 · Die Bausteine des Atoms", "typ": "lueckentext",
          "teile": ["Proton (p⁺) – Ladung: ", None, ", Ort im Atom: ", None, ". Neutron (n) – Ladung: ", None,
                    ", Ort im Atom: ", None, ". Elektron (e⁻) – Ladung: ", None, ", Ort im Atom: ", None, "."],
          "loesung": [["positiv", "+", "1+", "einfach positiv"], ["Kern", "Atomkern", "im Kern", "im Atomkern"],
                      ["neutral", "keine", "ungeladen", "0"], ["Kern", "Atomkern", "im Kern", "im Atomkern"],
                      ["negativ", "-", "1-", "einfach negativ"], ["Hülle", "Atomhülle", "Elektronenhülle",
                                                                   "in der Hülle", "in der Atomhülle"]],
          "wortbank": ["positiv", "neutral", "negativ", "Kern", "Hülle"]},
    "2": {"titel": "Aufgabe 2 · Lückentext", "typ": "lueckentext",
          "teile": ["Ein Atom besteht aus dem ", None, " und der ", None, ". Im Kern befinden sich die ", None,
                    " und die ", None, ". Die Ordnungszahl eines Elements gibt die Anzahl der ", None,
                    " an. Ein neutrales Atom hat genauso viele ", None, " wie Protonen."],
          "loesung": [["Kern", "Atomkern"], ["Hülle", "Atomhülle", "Elektronenhülle"],
                      ["Protonen", "Neutronen"], ["Neutronen", "Protonen"], ["Protonen"], ["Elektronen"]],
          "wortbank": ["Kern", "Hülle", "Protonen", "Neutronen", "Elektronen", "Ionen"]},
    "3": {"titel": "Aufgabe 3 · Das Natrium-Atom", "typ": "lueckentext",
          "teile": ["Natrium: Ordnungszahl 11, Massenzahl 23. Protonen: ", None, "  Neutronen: ", None,
                    "  Elektronen: ", None, "  K-Schale: ", None, "  L-Schale: ", None, "  M-Schale: ", None],
          "loesung": [["11"], ["12"], ["11"], ["2"], ["8"], ["1"]],
          "wortbank": ["1", "2", "8", "11", "12", "23"]},
    "5": {"titel": "Aufgabe 5 · Periodensystem", "typ": "lueckentext",
          "teile": ["Lithium (Li, 3) – Elektronen pro Schale: ", None, ", Periode: ", None, ", Hauptgruppe: ", None,
                    ", Alkalimetall: ", None, ". Kohlenstoff (C, 6) – Elektronen pro Schale: ", None, ", Periode: ",
                    None, ", Hauptgruppe: ", None, ", Alkalimetall: ", None,
                    ". Magnesium (Mg, 12) – Elektronen pro Schale: ", None, ", Periode: ", None,
                    ", Hauptgruppe: ", None, ", Alkalimetall: ", None, ". Kalium (K, 19) – Elektronen pro Schale: ",
                    None, ", Periode: ", None, ", Hauptgruppe: ", None, ", Alkalimetall: ", None, "."],
          "loesung": [_schalen(2, 1), ["2"], ["1", "I"], ["ja", "x"],
                      _schalen(2, 4), ["2"], ["4", "IV"], ["nein"],
                      _schalen(2, 8, 2), ["3"], ["2", "II"], ["nein"],
                      _schalen(2, 8, 8, 1), ["4"], ["1", "I"], ["ja", "x"]],
          "wortbank": ["ja", "nein", "1", "2", "3", "4", "2,1", "2,4", "2,8,2", "2,8,8,1"]},
    "6": {"titel": "Aufgabe 6 · Ähnliche Eigenschaften", "typ": "freitext",
          "frage": "Natrium (11) und Kalium (19) reagieren beide heftig mit Wasser. Erkläre mithilfe des Atombaus, "
                   "warum die beiden Elemente ähnliche Eigenschaften haben."},
}


def _gemischt(liste):
    """Feste, aber nicht triviale Reihenfolge (die Lösung soll nicht einfach dastehen)."""
    return sorted(liste, key=lambda t: (len(t) * 7 + sum(map(ord, t))) % 11)


def aufgabenliste():
    return [{"aufgabe_id": nr, "titel": v["titel"], "typ": v["typ"],
             "niveaus": [KNOPF]} for nr, v in VARIANTEN.items()]


def aufgabe_leer(aufgabe_id, niveau):
    f = VARIANTEN.get(aufgabe_id)
    if f is None or niveau != KNOPF:
        return None
    typ = f["typ"]
    daten = {"aufgabe_id": aufgabe_id, "niveau": "", "titel": f["titel"], "aufgabentyp": typ}
    if typ == "lueckentext":
        teile, n = [], 0
        for teil in f["teile"]:
            if teil is None:
                teile.append({"feld": f"l{n}"})
                n += 1
            else:
                teile.append({"text": teil})
        daten.update(teile=teile, wortbank=list(f["wortbank"]))
    elif typ == "zuordnung":
        daten.update(zeilen=[{"feld": f"z{i}", "text": t} for i, t in enumerate(f["links"])],
                     optionen=list(f["optionen"]))
    elif typ == "mc":
        daten.update(frage=f["frage"], optionen=list(f["optionen"]))
    elif typ == "richtigfalsch":
        daten.update(aussagen=[{"feld": f"r{i}", "text": t} for i, (t, _) in enumerate(f["aussagen"])])
    else:
        daten.update(frage=f["frage"])
    return daten


def loesung(aufgabe_id, niveau):
    f = VARIANTEN.get(aufgabe_id)
    if f is None or f["typ"] == "freitext":
        return None
    typ = f["typ"]
    if typ == "lueckentext":
        return {f"l{i}": list(alt) for i, alt in enumerate(f["loesung"])}
    if typ == "zuordnung":
        return {f"z{i}": [f["loesung"][t]] for i, t in enumerate(f["links"])}
    if typ == "mc":
        return {"wahl": [f["loesung"]]}
    if typ == "richtigfalsch":
        return {f"r{i}": [u] for i, (_, u) in enumerate(f["aussagen"])}
    return None


# ---------- Antworten aus dem AB (Karten) ----------
ELEMENTE = ("Lithium (Li)", "Kohlenstoff (C)", "Magnesium (Mg)", "Kalium (K)")
SCHALEN = ("K", "L", "M")


class AbAdapter:
    """Liest die Antworten einer Person aus der Tabelle `antworten` und liefert sie als Tafel-Karten."""

    def __init__(self, get_db, anzahl_aufgaben):
        self.get_db = get_db
        self.anzahl = anzahl_aufgaben

    # ----- Tafel-Seite (leere Aufgaben, Lösungen) -----
    def aufgabenliste(self):
        return aufgabenliste()

    def aufgabe_leer(self, aufgabe_id, niveau):
        return aufgabe_leer(aufgabe_id, niveau)

    def loesung(self, aufgabe_id, niveau):
        return loesung(aufgabe_id, niveau)

    def niveau_des_schuelers(self, schueler_id, aufgabe_id):
        return KNOPF

    # ----- Antworten der Schüler:innen -----
    def _felder(self, schueler_id):
        db = self.get_db()
        try:
            return {r[0]: r[1] for r in db.execute(
                "SELECT feld, wert FROM antworten WHERE schueler_id=?", (schueler_id,)).fetchall()}
        finally:
            db.close()

    @staticmethod
    def _f(felder, nr, n):
        wert = (felder.get(f"a{nr}.f{n}") or "").strip()
        return "" if wert == "false" else wert

    def _schalen(self, felder):
        try:
            punkte = json.loads(felder.get("a4.w1") or "[]")
        except ValueError:
            punkte = []
        zaehler = [0, 0, 0]
        for p in punkte if isinstance(punkte, list) else []:
            if isinstance(p, dict) and isinstance(p.get("r"), int) and 0 <= p["r"] < 3:
                zaehler[p["r"]] += 1
        return zaehler

    def aufgaben_des_schuelers(self, schueler_id):
        felder = self._felder(schueler_id)
        f = lambda nr, n: self._f(felder, nr, n)  # noqa: E731
        ergebnis = []

        def karte(nr, titel, typ, inhalt, bearbeitet):
            ergebnis.append({"aufgabe_id": str(nr), "titel": titel, "typ": typ, "niveau": "",
                             "bearbeitet": bool(bearbeitet), "inhalt": inhalt})

        # 1: Tabelle Teilchen / Ladung / Ort
        paare = [[t, " · ".join(x for x in (f(1, 2 * i + 1), f(1, 2 * i + 2)) if x) or "…"]
                 for i, t in enumerate(("Proton", "Neutron", "Elektron"))]
        karte(1, "Aufgabe 1 · Die Bausteine des Atoms", "zuordnung", {"paare": paare},
              any(f(1, n) for n in range(1, 7)))
        # 2: Lückentext (Text wie in ab_inhalt.html)
        teile = VARIANTEN["2"]["teile"]
        luecken = [f(2, n) for n in range(1, 7)]
        segmente, i = [], 0
        for teil in teile:
            if teil is None:
                segmente.append({"luecke": luecken[i] or "…"})
                i += 1
            else:
                segmente.append({"text": teil})
        karte(2, "Aufgabe 2 · Lückentext", "lueckentext", {"segmente": segmente}, any(luecken))
        # 3: Natrium-Atom
        w = [f(3, n) or "…" for n in range(1, 7)]
        karte(3, "Aufgabe 3 · Das Natrium-Atom", "freitext",
              {"text": f"Protonen: {w[0]} · Neutronen: {w[1]} · Elektronen: {w[2]}\n"
                       f"K: {w[3]} · L: {w[4]} · M: {w[5]}"},
              any(f(3, n) for n in range(1, 7)))
        # 4: Schalenmodell
        z = self._schalen(felder)
        karte(4, "Aufgabe 4 · Das Schalenmodell von Chlor", "freitext",
              {"text": f"{sum(z)} Elektronen gesetzt (K: {z[0]} · L: {z[1]} · M: {z[2]})"}, sum(z) > 0)
        # 5: Periodensystem
        paare, bearbeitet = [], False
        for i, name in enumerate(ELEMENTE):
            s, per, hg, alk = (f(5, 4 * i + k) for k in (1, 2, 3, 4))
            bearbeitet = bearbeitet or any((s, per, hg, alk))
            paare.append([name, f"Schalen {s or '…'} · Periode {per or '…'} · Gruppe {hg or '…'}"
                                f" · {'Alkalimetall' if alk == 'true' else 'kein Alkalimetall'}"])
        karte(5, "Aufgabe 5 · Periodensystem", "zuordnung", {"paare": paare}, bearbeitet)
        # 6: Freitext
        text = f(6, 1)
        karte(6, "Aufgabe 6 · Ähnliche Eigenschaften", "freitext", {"text": text}, text)
        return ergebnis

    def aufgabe_befuellt(self, schueler_id, aufgabe_id, person):
        """Die Tafel-Aufgabe, in der schon steht, was die Person im AB eingetragen hat (oder None, wenn es für diese
        Aufgabe keine Tafel-Fassung gibt). Die Felder bleiben an der Tafel per Tastatur bearbeitbar."""
        nr = str(aufgabe_id)
        objekt = aufgabe_leer(nr, KNOPF)
        if objekt is None:
            return None
        felder = self._felder(schueler_id)
        f = lambda a, n: self._f(felder, a, n)  # noqa: E731
        if nr in ("1", "2", "3"):
            werte = [f(int(nr), n) for n in range(1, 7)]
        elif nr == "5":
            werte = []
            for i in range(4):
                s, per, hg, alk = (f(5, 4 * i + k) for k in (1, 2, 3, 4))
                werte += [s, per, hg, "ja" if alk == "true" else ("nein" if (s or per or hg) else "")]   # ungekreuzt = „nein“
        else:
            werte = None
        vorhanden = {}
        if werte is not None:
            for i, wert in enumerate(werte):
                if wert:
                    vorhanden[f"l{i}"] = wert[:60]
        elif f(int(nr), 1):
            vorhanden["text"] = f(int(nr), 1)[:2000]
        objekt["felder"] = {k: {"wert": w, "von_id": person.id, "von": person.name, "status": None, "alt": None}
                            for k, w in vorhanden.items()}
        objekt["quelle"] = schueler_id
        return objekt

    def aufgabe_des_schuelers(self, schueler_id, aufgabe_id):
        return next((a for a in self.aufgaben_des_schuelers(schueler_id) if a["aufgabe_id"] == str(aufgabe_id)), None)
