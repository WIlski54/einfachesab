"""Anbindung der digitalen Tafel (Paket `tafel/`) an dieses Arbeitsblatt.

Hier – und nur hier – steht, was die Tafel über dieses AB wissen muss:
- Wer ist wer? Schüler:innen über die Flask-Session (`schueler_id`), die Lehrkraft über `is_lehrer`.
- Wo wird gespeichert? In der AB-Datenbank (Tabellen tafel_zustand / tafel_dateien). Sie werden wie
  alle anderen Daten beim Start, bei „Alle löschen“ und automatisch nach Inaktivität geleert.
- Aufgaben und Lösungen liegen auf dem Server (tafel_aufgaben.py) – nie bei den Schüler:innen.
- „Möchte ich vorstellen“ im AB ist ein Angebot an der Tafel: Die Lehrkraft nimmt es dort an.
"""
from flask import render_template, session

from tafel import LEHRKRAFT, Person, TafelHost, init_tafel
from tafel.speicher import SQL_SCHEMA, SQL_TABELLEN, SqliteSpeicher
from tafel_aufgaben import AbAdapter

TAFEL_SCHEMA = SQL_SCHEMA
TAFEL_TABELLEN = SQL_TABELLEN


class ABHost(TafelHost):
    def __init__(self, get_db, anzahl_aufgaben):
        self.get_db = get_db
        self.speicher = SqliteSpeicher(get_db)
        self.ab = AbAdapter(get_db, anzahl_aufgaben)

    def _person(self, als_schueler=False):
        """Lehrkraft (is_lehrer) oder Schüler:in. `als_schueler`: die Schülerseite meldet sich ausdrücklich so an –
        wichtig, wenn dieselbe Browser-Sitzung (Test am eigenen Gerät) beides ist; es nimmt nur Rechte weg."""
        if session.get("is_lehrer") and not als_schueler:
            return LEHRKRAFT
        sid = session.get("schueler_id")
        return self.schueler(sid) if sid else None

    def person_socket(self, auth):
        return self._person(isinstance(auth, dict) and auth.get("rolle") == "schueler")

    def person_http(self, anfrage):
        return self._person(anfrage.headers.get("X-Rolle") == "schueler")

    def schueler(self, schueler_id):
        if not schueler_id:
            return None
        db = self.get_db()
        try:
            z = db.execute("SELECT id, pseudonym, klasse FROM schueler WHERE id=?", (str(schueler_id),)).fetchone()
        finally:
            db.close()
        return Person(z[0], "schueler", z[1], z[2]) if z else None

    def schueler_liste(self):
        db = self.get_db()
        try:
            zeilen = db.execute("SELECT id, pseudonym, klasse FROM schueler ORDER BY pseudonym").fetchall()
        finally:
            db.close()
        return [Person(z[0], "schueler", z[1], z[2]) for z in zeilen]

    def vor_start(self):
        """Es gibt keinen zweiten Präsentationsmodus mehr – nichts zu beenden."""


def einbinden(app, socketio, *, get_db, anzahl_aufgaben, lehrer_required, asset_version, titel, bei_angeboten):
    """Tafel einhängen und die Lehrer-Seiten registrieren. Gibt den TafelServer zurück.

    `bei_angeboten()` wird nach jeder Änderung der „Möchte ich vorstellen“-Angebote aufgerufen
    (Dashboard und Detailansicht aktualisieren sich damit).
    """
    server = init_tafel(app, socketio, ABHost(get_db, anzahl_aufgaben))

    ursprung = server.angebote_senden

    def angebote_senden():
        ursprung()
        try:
            bei_angeboten()
        except Exception:  # Anzeige-Fehler dürfen die Tafel nie stören
            app.logger.exception("Angebote konnten nicht gemeldet werden")

    server.angebote_senden = angebote_senden

    def seite(vorlage):
        return render_template(vorlage, v=asset_version, titel=titel)

    @app.route("/lehrer/tafel")
    @lehrer_required
    def tafel_lehrer():
        return seite("tafel_lehrer.html")

    @app.route("/lehrer/tafel/rueckblick")
    @lehrer_required
    def tafel_rueckblick():
        return seite("tafel_rueckblick.html")

    @app.route("/lehrer/tafel/beamer")
    @lehrer_required
    def tafel_beamer():
        return seite("tafel_beamer.html")

    return server
