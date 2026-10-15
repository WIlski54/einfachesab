"""Die Schnittstelle zwischen Tafel und Arbeitsblatt („Host“).

Ein AB stellt ein Objekt mit diesen Methoden bereit und übergibt es an `init_tafel`.
Die Tafel selbst weiß nichts über Sessions, Datenbanken oder Aufgabenformate des ABs.
"""
from dataclasses import dataclass


@dataclass
class Person:
    id: str
    rolle: str  # "lehrer" | "schueler"
    name: str
    klasse: str = ""

    @property
    def ist_lehrer(self):
        return self.rolle == "lehrer"

    def als_dict(self):
        return {"id": self.id, "rolle": self.rolle, "name": self.name, "klasse": self.klasse}


LEHRKRAFT = Person(id="lehrer", rolle="lehrer", name="Lehrkraft")


class TafelHost:
    """Vorlage mit Standardverhalten. Ein AB überschreibt die ersten vier Methoden."""

    #: Server-Adapter (Python) für Aufgaben/Lösungen/AB-Antworten – oder None,
    #: dann liefert der Browser-Adapter (`GT.abAdapter`) diese Daten.
    ab = None

    #: Ablage für Tafelzustand und Dateien (siehe tafel/speicher.py) – None = nur Arbeitsspeicher
    speicher = None

    def person_socket(self, auth):
        """Person zur neuen Live-Verbindung (Namespace /tafel) oder None → Verbindung abgelehnt."""
        raise NotImplementedError

    def person_http(self, request):
        """Person zu einer HTTP-Anfrage an /tafel/… oder None → 401."""
        raise NotImplementedError

    def schueler(self, schueler_id):
        """Person eines Lernplatzes oder None."""
        raise NotImplementedError

    def schueler_liste(self):
        """Alle Lernplätze der Sitzung (für die Liste der Lehrkraft)."""
        raise NotImplementedError

    def vor_start(self):
        """Wird aufgerufen, bevor die Tafel live geht – z. B. einen Präsentationsmodus beenden."""
