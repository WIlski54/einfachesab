"""Ablage für Tafelzustand und hochgeladene Dateien.

- `DateiSpeicher`: JSON + Dateien in einem Ordner (Prototyp).
- `SqliteSpeicher`: zwei Tabellen in der Datenbank des ABs → landen automatisch in
  Snapshot, IServ-Archiv und Fortsetzungsstunde (Dateien als Base64-Text, damit der
  JSON-Snapshot sie aufnehmen kann).
"""
import base64
import json
import os
import re
import shutil
import tempfile
import time
from contextlib import contextmanager
from pathlib import Path

DATEINAME = re.compile(r"^[a-f0-9]{32}\.(jpg|png|pdf)$")

SQL_SCHEMA = """
CREATE TABLE IF NOT EXISTS tafel_zustand (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    zustand_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tafel_dateien (
    name TEXT PRIMARY KEY,
    daten_b64 TEXT NOT NULL,
    erstellt_at TEXT NOT NULL
);
"""
SQL_TABELLEN = ("tafel_zustand", "tafel_dateien")


def _jetzt():
    return time.strftime("%Y-%m-%dT%H:%M:%S")


class DateiSpeicher:
    def __init__(self, ordner, beim_start_leeren=False):
        self.ordner = Path(ordner)
        if beim_start_leeren:
            shutil.rmtree(self.ordner, ignore_errors=True)
        (self.ordner / "dateien").mkdir(parents=True, exist_ok=True)
        self.pfad = self.ordner / "tafel.json"

    def laden(self):
        try:
            return json.loads(self.pfad.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None

    def speichern(self, daten):
        fd, tmp = tempfile.mkstemp(dir=self.ordner, suffix=".tmp")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(daten, f, ensure_ascii=False)
        os.replace(tmp, self.pfad)

    def datei_speichern(self, name, daten):
        (self.ordner / "dateien" / name).write_bytes(daten)

    def datei_lesen(self, name):
        pfad = self.ordner / "dateien" / name
        return pfad.read_bytes() if DATEINAME.match(name) and pfad.exists() else None


class SqliteSpeicher:
    """`get_db` ist die Verbindungsfabrik des ABs (gibt eine sqlite3-Verbindung zurück)."""

    def __init__(self, get_db):
        self.get_db = get_db
        with self._db() as db:
            db.executescript(SQL_SCHEMA)

    @contextmanager
    def _db(self):
        """Verbindung öffnen, bei Erfolg festschreiben und immer schließen."""
        db = self.get_db()
        try:
            with db:
                yield db
        finally:
            db.close()

    def laden(self):
        with self._db() as db:
            zeile = db.execute("SELECT zustand_json FROM tafel_zustand WHERE id = 1").fetchone()
        return json.loads(zeile[0]) if zeile else None

    def speichern(self, daten):
        text = json.dumps(daten, ensure_ascii=False)
        with self._db() as db:
            db.execute("INSERT INTO tafel_zustand (id, zustand_json, updated_at) VALUES (1, ?, ?) "
                       "ON CONFLICT(id) DO UPDATE SET zustand_json = excluded.zustand_json, "
                       "updated_at = excluded.updated_at", (text, _jetzt()))

    def datei_speichern(self, name, daten):
        with self._db() as db:
            db.execute("INSERT OR REPLACE INTO tafel_dateien (name, daten_b64, erstellt_at) VALUES (?, ?, ?)",
                       (name, base64.b64encode(daten).decode("ascii"), _jetzt()))

    def datei_lesen(self, name):
        if not DATEINAME.match(name):
            return None
        with self._db() as db:
            zeile = db.execute("SELECT daten_b64 FROM tafel_dateien WHERE name = ?", (name,)).fetchone()
        return base64.b64decode(zeile[0]) if zeile else None
