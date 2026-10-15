"""Tafel-Baustein. Einbau in eine Flask-App (siehe README / references/tafel.md im Skill):

    from tafel import init_tafel
    server = init_tafel(app, socketio, MeinHost())

Der Host (siehe tafel/host.py) verbindet die Tafel mit Anmeldung, Speicher und Aufgaben des ABs.
Die Tafel läuft im eigenen Socket-Namespace (/tafel) und unter eigenen HTTP-Pfaden (/tafel/…).
"""
from .ereignisse import DATEI_PREFIX, TafelServer, registriere
from .host import LEHRKRAFT, Person, TafelHost
from .http import blueprint
from .zustand import Tafel


def init_tafel(app, socketio, host, namespace="/tafel", archiv=False):
    """Tafel einhängen. `archiv=True` aktiviert „Stunde sichern/laden“ als Datei (nur ohne IServ-Snapshot)."""
    server = TafelServer(socketio, Tafel(), host, namespace=namespace)
    server.laden()
    registriere(socketio, server)
    app.register_blueprint(blueprint(server, archiv=archiv))
    app.extensions["tafel"] = server
    return server


__all__ = ["DATEI_PREFIX", "LEHRKRAFT", "Person", "Tafel", "TafelHost", "TafelServer", "init_tafel"]
