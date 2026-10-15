"""Aufgaben an der Tafel: Felder füllen, prüfen, korrigieren.

Ein Objekt vom Typ `aufgabe` trägt nur die leere Aufgabe und die Felder –
die Lösungen kommen erst beim Prüfen vom Server (ab_adapter), nie zu den Schülern.

Feld = {"wert", "von_id", "von", "status": None | "richtig" | "falsch", "alt": falsche Erstantwort | None}
"""
import re
import unicodedata

MAX_LAENGE = {"lueckentext": 60, "zuordnung": 60, "mc": 200, "freitext": 2000, "sortieren": 200,
              "richtigfalsch": 10, "tabelle": 60, "schalen": 2}
SCHALEN_MAX = 18   # Elektronen je Schale im Schalenmodell (Fehler wie 3 Elektronen in K bleiben möglich)
RICHTIG_FALSCH = ["richtig", "falsch"]
_TIEF = str.maketrans("₀₁₂₃₄₅₆₇₈₉⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻", "01234567890123456789+-")


def normalisieren(text):
    """Vergleichsform: Groß/Klein, Leerzeichen, Tief-/Hochstellung und Akzente spielen keine Rolle."""
    t = str(text or "").translate(_TIEF).lower().strip()
    t = unicodedata.normalize("NFKD", t)
    t = "".join(c for c in t if not unicodedata.combining(c)).replace("ø", "o")
    return re.sub(r"\s+", " ", t)


def feld_ids(objekt):
    typ = objekt.get("aufgabentyp")
    if typ == "lueckentext":
        return [t["feld"] for t in objekt.get("teile", []) if "feld" in t]
    if typ == "zuordnung":
        return [z["feld"] for z in objekt.get("zeilen", [])]
    if typ == "mc":
        return ["wahl"]
    if typ == "sortieren":
        return [f"p{i}" for i in range(len(objekt.get("elemente", [])))]
    if typ == "richtigfalsch":
        return [a["feld"] for a in objekt.get("aussagen", [])]
    if typ == "tabelle":
        return [z["feld"] for zeile in objekt.get("zeilen", []) for z in zeile if "feld" in z]
    if typ == "schalen":
        return ["s0", "s1", "s2"]
    return ["text"]


def zelle(objekt, feld):
    """Die Tabellenzelle zu einem Feld (art: None = Text, "haken" = Ankreuzfeld; zahl = Zifferntastatur)."""
    for zeile in objekt.get("zeilen", []):
        for z in zeile:
            if z.get("feld") == feld:
                return z
    return {}


def optionen(objekt):
    """Erlaubte Werte bei Auswahl-Aufgaben – None bei freier Eingabe."""
    typ = objekt.get("aufgabentyp")
    if typ in ("zuordnung", "mc"):
        return objekt.get("optionen", [])
    if typ == "sortieren":
        return objekt.get("elemente", [])
    if typ == "richtigfalsch":
        return RICHTIG_FALSCH
    return None


def wert_pruefen(objekt, feld, wert):
    """Liefert den bereinigten Wert oder wirft ValueError."""
    if feld not in feld_ids(objekt):
        raise ValueError("Dieses Feld gibt es nicht.")
    if not isinstance(wert, str):
        raise ValueError("Ungültiger Wert.")
    typ = objekt.get("aufgabentyp")
    wert = wert[:MAX_LAENGE.get(typ, 200)]
    if typ == "tabelle" and zelle(objekt, feld).get("art") == "haken" and wert not in ("", "true", "false"):
        raise ValueError("Ungültiger Wert.")
    if typ == "schalen" and wert and not (wert.isdigit() and 0 <= int(wert) <= SCHALEN_MAX):
        raise ValueError("So viele Elektronen passen nicht auf eine Schale.")
    erlaubt = optionen(objekt)
    if erlaubt is not None and wert:
        teile = wert.split("|") if objekt.get("mehrfach") else [wert]
        if any(t not in erlaubt for t in teile):
            raise ValueError("Diese Antwort steht nicht zur Auswahl.")
        if objekt.get("mehrfach"):  # feste Reihenfolge wie in der Aufgabe
            wert = "|".join(o for o in erlaubt if o in teile)
    return wert


def feld_setzen(objekt, feld, wert, person):
    """Setzt einen Feldwert. Wird ein rot geprüftes Feld geändert, bleibt die falsche
    Erstantwort als `alt` (durchgestrichen) erhalten – Fehler sind eine Lernspur."""
    wert = wert_pruefen(objekt, feld, wert)
    felder = dict(objekt.get("felder") or {})
    vorher = dict(felder.get(feld) or {})
    neu = {"wert": wert, "von_id": person.id if not person.ist_lehrer else "lehrer", "von": person.name,
           "status": vorher.get("status"), "alt": vorher.get("alt")}
    if wert != vorher.get("wert"):
        if vorher.get("status") == "falsch" and vorher.get("wert"):
            neu["alt"] = vorher.get("alt") or vorher["wert"]
        neu["status"] = None
    felder[feld] = neu
    return felder


def pruefen(objekt, loesung):
    """Markiert alle prüfbaren Felder richtig/falsch. Leere Felder zählen als falsch."""
    felder = dict(objekt.get("felder") or {})
    zaehler = {"richtig": 0, "falsch": 0}
    for feld in feld_ids(objekt):
        if feld not in loesung:
            continue
        f = dict(felder.get(feld) or {"wert": "", "von_id": None, "von": None, "alt": None})
        richtig = _stimmt(objekt, f.get("wert"), loesung[feld], feld)
        f["status"] = "richtig" if richtig else "falsch"
        zaehler[f["status"]] += 1
        felder[feld] = f
    return felder, zaehler


def loesung_einsetzen(objekt, loesung, nur_feld=None):
    """Setzt die richtige Lösung in (ein oder alle nicht richtigen) Felder ein; die falsche
    Antwort bleibt als `alt` stehen. So steht am Ende nichts Falsches an der Tafel."""
    felder = dict(objekt.get("felder") or {})
    for feld in feld_ids(objekt):
        if feld not in loesung or (nur_feld and feld != nur_feld):
            continue
        f = dict(felder.get(feld) or {"wert": "", "alt": None})
        if f.get("status") == "richtig" and not nur_feld:
            continue
        if f.get("wert") and not _stimmt(objekt, f["wert"], loesung[feld], feld):
            f["alt"] = f.get("alt") or f["wert"]
        f.update(wert=loesung[feld][0], status="richtig", von_id="lehrer", von="Lehrkraft")
        felder[feld] = f
    return felder


def _stimmt(objekt, wert, akzeptiert, feld=None):
    if objekt.get("aufgabentyp") == "tabelle" and zelle(objekt, feld).get("art") == "haken":
        return (wert == "true") == (akzeptiert[0] == "true")   # nicht angekreuzt = „false“
    if objekt.get("aufgabentyp") == "schalen":
        return str(int(wert)) in akzeptiert if str(wert or "").isdigit() else False
    if objekt.get("mehrfach"):  # Mehrfachauswahl: dieselbe Menge
        menge = lambda s: frozenset(normalisieren(t) for t in str(s or "").split("|") if t)
        return menge(wert) in {menge(a) for a in akzeptiert}
    return normalisieren(wert) in {normalisieren(x) for x in akzeptiert}


# ---------- Vom Browser gelieferte Aufgaben und Karten prüfen ----------
TYPEN = ("lueckentext", "zuordnung", "mc", "freitext", "sortieren", "richtigfalsch", "tabelle", "schalen")


def _text(wert, laenge, pflicht=False):
    if wert is None and not pflicht:
        return None
    if not isinstance(wert, str) or (pflicht and not wert.strip()):
        raise ValueError("Ungültiger Text.")
    return wert[:laenge]


def _liste(wert, maximal):
    if not isinstance(wert, list) or len(wert) > maximal:
        raise ValueError("Ungültige Liste.")
    return wert


def aufgabe_bereinigen(a):
    """Aufgabe aus dem Browser-Adapter (Lehrkraft) auf erlaubte Felder und Längen beschränken."""
    if not isinstance(a, dict) or a.get("aufgabentyp") not in TYPEN:
        raise ValueError("Unbekannter Aufgabentyp.")
    typ = a["aufgabentyp"]
    sauber = {"aufgabentyp": typ, "titel": _text(a.get("titel"), 120, True),
              "aufgabe_id": _text(str(a.get("aufgabe_id", "")), 40), "niveau": _text(a.get("niveau"), 12)}
    if typ == "lueckentext":
        teile = []
        for i, t in enumerate(_liste(a.get("teile"), 120)):
            if isinstance(t, dict) and "feld" in t:
                if t["feld"] != f"l{sum(1 for x in teile if 'feld' in x)}":
                    raise ValueError("Lücken müssen l0, l1, … heißen.")
                teile.append({"feld": t["feld"]})
            elif isinstance(t, dict):
                teile.append({"text": _text(t.get("text"), 600, True)})
            else:
                raise ValueError("Ungültiger Textteil.")
        sauber.update(teile=teile, wortbank=[_text(w, 80, True) for w in _liste(a.get("wortbank", []), 40)])
    elif typ == "zuordnung":
        zeilen = _liste(a.get("zeilen"), 25)
        sauber.update(zeilen=[{"feld": f"z{i}", "text": _text(z.get("text") if isinstance(z, dict) else None, 200, True)}
                              for i, z in enumerate(zeilen)],
                      optionen=[_text(o, 200, True) for o in _liste(a.get("optionen"), 25)])
    elif typ == "mc":
        sauber.update(frage=_text(a.get("frage"), 800, True), mehrfach=bool(a.get("mehrfach")),
                      optionen=[_text(o, 300, True) for o in _liste(a.get("optionen"), 12)])
    elif typ == "sortieren":
        sauber.update(frage=_text(a.get("frage") or "Bringe in die richtige Reihenfolge.", 800, True),
                      elemente=[_text(e, 200, True) for e in _liste(a.get("elemente"), 15)])
    elif typ == "richtigfalsch":
        aussagen = _liste(a.get("aussagen"), 25)
        sauber.update(aussagen=[{"feld": f"r{i}", "text": _text(x.get("text") if isinstance(x, dict) else None, 400, True)}
                                for i, x in enumerate(aussagen)])
    elif typ == "tabelle":
        zeilen, n = [], 0
        for zeile in _liste(a.get("zeilen"), 30):
            neu = []
            for z in _liste(zeile, 10):
                if isinstance(z, dict) and "feld" in z:
                    c = {"feld": f"c{n}"}
                    n += 1
                    if z.get("art") == "haken":
                        c["art"] = "haken"
                    if z.get("zahl"):
                        c["zahl"] = True
                    neu.append(c)
                elif isinstance(z, dict):
                    neu.append({"text": _text(z.get("text"), 200, False) or ""})
                else:
                    raise ValueError("Ungültige Zelle.")
            zeilen.append(neu)
        sauber.update(frage=_text(a.get("frage"), 1500, False) or "",
                      spalten=[_text(c, 80, False) or "" for c in _liste(a.get("spalten", []), 10)],
                      breiten=[float(b) for b in _liste(a.get("breiten", []), 10) if isinstance(b, (int, float))],
                      zeilen=zeilen)
    elif typ == "schalen":
        sauber.update(frage=_text(a.get("frage"), 1500, False) or "", kern=_text(a.get("kern"), 20, False) or "")
    else:
        sauber.update(frage=_text(a.get("frage"), 1500, True))
    return sauber


def loesung_bereinigen(objekt, loesung):
    if loesung is None:
        return None
    if not isinstance(loesung, dict):
        raise ValueError("Ungültige Lösung.")
    ids = set(feld_ids(objekt))
    sauber = {}
    for feld, werte in loesung.items():
        if feld not in ids:
            raise ValueError("Lösung für ein unbekanntes Feld.")
        sauber[feld] = [_text(w, 300, True) for w in _liste(werte, 8)]
    return sauber


def karte_bereinigen(k):
    """AB-Karte aus dem Browser (eigene Antwort bzw. Lehrkraft) beschränken."""
    if not isinstance(k, dict) or not isinstance(k.get("inhalt"), dict):
        raise ValueError("Ungültige Karte.")
    i = k["inhalt"]
    inhalt = {}
    if "segmente" in i:
        inhalt["segmente"] = []
        for s in _liste(i["segmente"], 150):
            if isinstance(s, dict) and "luecke" in s:
                inhalt["segmente"].append({"luecke": _text(s["luecke"], 120, False) or "…"})
            elif isinstance(s, dict):
                inhalt["segmente"].append({"text": _text(s.get("text"), 600, True)})
    if "paare" in i:
        inhalt["paare"] = [[_text(p[0], 200, True), _text(p[1], 200, True)]
                           for p in _liste(i["paare"], 30) if isinstance(p, list) and len(p) == 2]
    if "text" in i:
        inhalt["text"] = _text(i["text"], 3000, False) or ""
    if not inhalt:
        raise ValueError("Die Karte ist leer.")
    return {"titel": _text(k.get("titel"), 120, True), "aufgabentyp": _text(k.get("aufgabentyp"), 20) or "freitext",
            "niveau": _text(k.get("niveau"), 12), "inhalt": inhalt}


def beteiligt(objekt, person_id):
    """Hat diese Person an dem Objekt mitgewirkt (selbst angelegt oder Felder gefüllt)?"""
    if objekt.get("autor") == person_id:
        return True
    return any((f or {}).get("von_id") == person_id for f in (objekt.get("felder") or {}).values())
