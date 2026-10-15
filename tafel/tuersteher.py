"""Der Türsteher: prüft jede Aktion, bevor sie die Tafel verändert.

Die Oberfläche blendet Werkzeuge zwar aus – geschützt wird aber erst hier.
"""
import math

from .werkzeuge import GEOMETRIE, INHALT, werkzeug_fuer_objekt

EINFACHE_AKTIONEN = {
    "undo": "radierer",
    "greifen": "auswahl",
    "vorne": "auswahl",
    "ansicht": "zoom",
    "seite": "seiten",
    "upload_foto": "kamera",
}

# erlaubte Wertebereiche (Tafel ist 1500 × 1000 Punkte)
BEREICHE = {"x": (-1500, 3000), "y": (-1000, 2000), "rotation": (-3600, 3600), "skala": (0.1, 8)}


class Abgelehnt(Exception):
    @property
    def grund(self):
        return self.args[0]


def zahl(wert, von=-1e6, bis=1e6):
    """Endliche Zahl im Bereich – sonst Abgelehnt (schützt u. a. vor NaN/Infinity)."""
    if isinstance(wert, bool) or not isinstance(wert, (int, float)) or not math.isfinite(wert):
        raise Abgelehnt("Ungültige Zahl.")
    if not von <= wert <= bis:
        raise Abgelehnt("Wert außerhalb der Tafel.")
    return wert


def pruefe_geometrie(werte):
    for k in GEOMETRIE & set(werte):
        zahl(werte[k], *BEREICHE[k])


def pruefe(tafel, person, aktion, objekt=None, aenderungen=None, werkzeug=None, seite=None):
    if aenderungen:
        pruefe_geometrie(aenderungen)
    if objekt and aktion == "add":
        pruefe_geometrie(objekt)
    if person.ist_lehrer:
        return
    if tafel.modus != "live":
        raise Abgelehnt("Die Tafel ist gerade nicht aktiv.")

    if aktion == "melden":
        if "melden" not in tafel.werkzeuge:
            raise Abgelehnt("Melden ist gerade nicht freigegeben.")
        return

    if not tafel.ist_am_brett(person.id):
        raise Abgelehnt("Du bist nicht an der Tafel.")
    if tafel.eingefroren:
        raise Abgelehnt("Die Tafel ist eingefroren – Stifte weg!")
    if seite is not None and seite != tafel.aktuelle_seite:
        raise Abgelehnt("Diese Seite wird gerade nicht gezeigt.")

    def braucht(*werkzeuge):
        if not any(w in tafel.werkzeuge for w in werkzeuge):
            raise Abgelehnt("Dieses Werkzeug ist nicht freigegeben.")

    if aktion in EINFACHE_AKTIONEN:
        braucht(EINFACHE_AKTIONEN[aktion])
    elif aktion == "feld":
        pass  # Aufgabenfelder: an der Tafel genügt, es braucht kein Werkzeug
    elif aktion == "live":
        if werkzeug:  # ohne Werkzeug (z. B. Status zurücksetzen) genügt „an der Tafel“
            braucht(werkzeug)
    elif aktion == "add":
        benoetigt = werkzeug_fuer_objekt(objekt or {})
        if benoetigt is None:
            raise Abgelehnt("Unbekannter Objekttyp.")
        braucht(benoetigt)
    elif aktion == "update":
        _pruefe_update(person, objekt, aenderungen or {}, braucht)
    elif aktion == "delete":
        if objekt.get("autor") == "lehrer":
            raise Abgelehnt("Das hat die Lehrkraft angelegt – nur verschieben erlaubt.")
        braucht("radierer", "auswahl")
    else:
        raise Abgelehnt("Unbekannte Aktion.")


def _pruefe_update(person, objekt, aenderungen, braucht):
    if not aenderungen:
        raise Abgelehnt("Keine Änderung.")
    schluessel = set(aenderungen)
    inhalt = schluessel - GEOMETRIE
    erlaubter_inhalt = INHALT.get(objekt.get("typ"), set())
    if inhalt - erlaubter_inhalt:
        raise Abgelehnt("Diese Eigenschaft darf nicht geändert werden.")
    if objekt.get("autor") == "lehrer" and schluessel - {"x", "y"}:
        raise Abgelehnt("Das hat die Lehrkraft angelegt – nur verschieben erlaubt.")
    if inhalt and objekt.get("autor") != person.id:
        raise Abgelehnt("Den Inhalt darf nur ändern, wer es geschrieben hat.")
    if schluessel & GEOMETRIE:
        braucht("auswahl")
    if inhalt:
        braucht(werkzeug_fuer_objekt(objekt))
