"""Werkzeug-IDs, Einsatzart-Presets und die Zuordnung Objekt → Werkzeug."""

# Werkzeuge, die der Lehrer für Schüler freischalten kann (Reihenfolge = Werkzeugleiste)
SCHUELER_WERKZEUGE = (
    "auswahl", "stift", "marker", "radierer", "text", "formel", "formen",
    "karten", "lineal", "kamera", "ab_antwort", "laser", "zoom", "seiten", "melden",
)

# Schnellwahl im Dashboard. "melden" ist immer dabei, der Lehrer kann es abschalten.
EINSATZARTEN = {
    "A": {"auswahl", "stift", "marker", "radierer", "text", "formel", "formen", "laser"},
    "B": {"auswahl", "kamera", "stift", "marker", "radierer", "laser"},
    "C": {"auswahl", "ab_antwort", "stift", "marker", "radierer", "laser"},
    "D": {"auswahl", "karten", "stift", "text", "radierer", "laser"},
}

HINTERGRUENDE = ("leer", "kariert", "liniert", "koordinaten", "weiss")

OBJEKT_TYPEN = {
    "form": "formen",
    "text": "text",
    "formel": "formel",
    "karte": "karten",
    "bild": "kamera",
    "ab_karte": "ab_antwort",
}

# Schlüssel, die ein Objekt beim Verschieben/Skalieren/Drehen ändert
GEOMETRIE = {"x", "y", "rotation", "skala"}

# Inhaltsschlüssel, die je Typ nachträglich geändert werden dürfen
INHALT = {
    "strich": set(),
    "form": {"farbe", "staerke"},
    "text": {"text", "farbe", "groesse"},
    "formel": {"quelle", "modus", "farbe", "groesse"},
    "karte": {"text", "kartenfarbe"},
    "bild": set(),
    "ab_karte": set(),
    "aufgabe": set(),  # Felder nur über eigene Ereignisse (tafel:feld), nie per Update
}


def werkzeuge_fuer_einsatzarten(arten):
    werkzeuge = {"melden"}
    for art in arten:
        werkzeuge |= EINSATZARTEN.get(art, set())
    return werkzeuge


def werkzeug_fuer_objekt(objekt):
    typ = objekt.get("typ")
    if typ == "strich":
        return "marker" if objekt.get("marker") else "stift"
    return OBJEKT_TYPEN.get(typ)
