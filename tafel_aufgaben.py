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
VARIANTEN = {
    "1": {"titel": "Aufgabe 1 · Die Bausteine des Atoms", "typ": "zuordnung",
          "links": ["Proton", "Neutron", "Elektron"], "optionen": ["positiv", "neutral", "negativ"],
          "loesung": {"Proton": "positiv", "Neutron": "neutral", "Elektron": "negativ"}},
    "2": {"titel": "Aufgabe 2 · Lückentext", "typ": "lueckentext",
          "teile": ["Ein Atom besteht aus dem ", None, " und der ", None, ". Im Kern befinden sich die ", None,
                    " und die ", None, ". Die Ordnungszahl eines Elements gibt die Anzahl der ", None,
                    " an. Ein neutrales Atom hat genauso viele ", None, " wie Protonen."],
          "loesung": [["Kern", "Atomkern"], ["Hülle", "Atomhülle", "Elektronenhülle"],
                      ["Protonen", "Neutronen"], ["Neutronen", "Protonen"], ["Protonen"], ["Elektronen"]],
          "wortbank": ["Kern", "Hülle", "Protonen", "Neutronen", "Elektronen", "Ionen"]},
    "3": {"titel": "Aufgabe 3 · Das Natrium-Atom", "typ": "mc",
          "frage": "Wie viele Neutronen hat ein Natrium-Atom (Ordnungszahl 11, Massenzahl 23)?",
          "optionen": ["11", "12", "23", "34"], "loesung": "12"},
    "5": {"titel": "Aufgabe 5 · Periodensystem", "typ": "richtigfalsch",
          "aussagen": [["Lithium (Li) ist ein Alkalimetall.", "richtig"],
                       ["Kohlenstoff (C) ist ein Alkalimetall.", "falsch"],
                       ["Magnesium (Mg) ist ein Alkalimetall.", "falsch"],
                       ["Kalium (K) ist ein Alkalimetall.", "richtig"]]},
    "6": {"titel": "Aufgabe 6 · Ähnliche Eigenschaften", "typ": "freitext",
          "frage": "Erkläre mithilfe des Atombaus, warum Natrium und Kalium ähnliche Eigenschaften haben."},
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

    def aufgabe_des_schuelers(self, schueler_id, aufgabe_id):
        return next((a for a in self.aufgaben_des_schuelers(schueler_id) if a["aufgabe_id"] == str(aufgabe_id)), None)
