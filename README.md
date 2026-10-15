# Einfaches digitales Arbeitsblatt

Ein einziges Arbeitsblatt im Papier-Look, das Schüler:innen digital ausfüllen.
Die Lehrkraft sieht alles live im Dashboard. Flask + SocketIO + SQLite.

## Lokal starten

```bash
pip install -r requirements.txt
cp .env.example .env        # LEHRER_PASSWORD setzen
python app.py               # http://localhost:5000
```

- Schüler:innen: `/` (nur Pseudonym)
- Lehrkraft: `/lehrer` (Link „🏫 Lehrerbereich“ unten auf der Login-Seite)
- Ohne `LEHRER_PASSWORD` wird beim Start ein Zufallspasswort in der Konsole ausgegeben.

## Neues Arbeitsblatt erstellen

1. `AB_META` in `app.py` anpassen (Titel, Fach, Klasse).
2. `templates/ab_inhalt.html` ersetzen. Die Regeln stehen als Kommentar am Dateianfang.
   Eingabefelder bekommen ihre IDs automatisch (`a3.f2` = 2. Feld in Aufgabe 3).

## Struktur

| Datei | Zweck |
|---|---|
| `app.py` | Routen, SocketIO-Events, SQLite |
| `templates/ab_inhalt.html` | **Nur der Inhalt des ABs** |
| `templates/ab_blatt.html` | Kopf + Personalien, gemeinsam für Schüler- und Lehrer-Ansicht |
| `templates/ab.html` | Schüler-Seite (bearbeiten) |
| `templates/schueler_detail.html` | Lehrer sieht das AB einer Schülerin / eines Schülers live (nur lesen) |
| `tafel/` | **Digitale Tafel** (Python-Baustein aus dem Skill `ab-bauen`, **nicht ändern**, nur ersetzen) |
| `tafel_anbindung.py` | Hängt die Tafel an dieses AB: Login (Session), Speicher (SQLite), Seiten `/lehrer/tafel…` |
| `tafel_aufgaben.py` | Tafel-Fassungen der Aufgaben (eine je Aufgabe) mit Lösungen **nur auf dem Server** + wie AB-Antworten als Karten an die Tafel kommen |
| `templates/tafel_lehrer.html`, `tafel_rueckblick.html`, `tafel_beamer.html`, `_tafel.html` | Tafel-Seiten für Lehrkraft, Rückblick, Beamer |
| `static/tafel/`, `static/vendor/` | Tafel-Oberfläche und Bibliotheken (Konva, MathJax, pdf.js, jsPDF, socket.io) – alles lokal, kein CDN nötig |
| `static/js/tafel_schueler.js` | Schülerseite: Tafel-Overlay und „Tafelbild der Stunde“ |
| `static/js/ab.js` | Felder, Live-Speichern, Schalenmodell, „Möchte ich vorstellen“ |
| `static/js/ebene.js` | Lehrer-Ebene: Zeichnen, Stempel, Bilder (Canvas über der Aufgabe), Werkzeugleiste, Breiten-Abgleich |
| `static/js/ab.js` (KI-Teil) | KI-Box je Aufgabe (Verlauf, Frage-Formular), nur sichtbar bei Hilfe-Status `ki` |
| `static/css/ab.css` | Papier-Look (Blau = Schüler, Türkis = Lehrer) |

## Datenmodell

- `antworten(schueler_id, feld, wert)` – aktueller Stand jedes Feldes
- „Möchte ich vorstellen“ ist kein eigener Datensatz mehr, sondern ein **Angebot an der digitalen Tafel** (liegt im Tafelzustand).
- `tafel_zustand`, `tafel_dateien` – Zustand der digitalen Tafel (Seiten, Karten, Momentaufnahmen) und hochgeladene Fotos; wird vom Baustein verwaltet.
- `hilfe(schueler_id, aufgabe_nr, status, angefragt_at)` – „Ich brauche Hilfe“, solange die Anfrage läuft.
  Status: `offen` → `kommentiert` | `ki` (KI-Hilfe für diese Aufgabe freigegeben) | `unterwegs` (Lehrkraft kommt); „erledigt“ löscht die Zeile
- `annotationen(...)` – die Lehrer-Ebene. Bisher genutzt: `typ='kommentar'` (Text in `daten.text`, max. 400 Zeichen,
  höchstens 20 je Aufgabe). Vorbereitet für Markierungen, Zeichnungen, Bilder; Koordinaten dann relativ (0..1)

## Socket-Räume (jedes Event geht an genau einen Raum)

- `lehrer_room`: `neuer_schueler`, `schueler_online/offline`, `aktivitaet`, `vorstellen_update`, `hilfe_update`, `schueler_geloescht`, `alle_geloescht`
- `watch_<id>`: `antwort_live` (Feldinhalte), `annotation_neu`, `annotation_weg` (für die Detailansicht der Lehrkraft)
- `schueler_<id>`: `sitzung_beendet`, `vorstellen_liste`, `annotation_neu`, `annotation_weg`, `hilfe_status`
- Namespace `/tafel`: die digitale Tafel hat einen **eigenen** Kanal (Räume `lehrer`, `schueler`); im Standard-Kanal gibt es keine Tafel-Events.

## Digitale Tafel und „Möchte ich vorstellen“

Die Tafel (Sicherungsphase) kommt aus Deinem Skill `ab-bauen` (`references/tafel.md`). **Status: Pilotphase** – im Browser vollständig getestet,
an echten iPads im Schul-WLAN noch nicht. Vor dem Einsatz die Praxistest-Checkliste aus `D:\KI Projekte\Tafel für AB Skill\README.md` durchgehen.

- **Ansehen, dann an die Tafel (Normalfall):** Im Dashboard steht ✋ bei der Person und in der Liste „✋ Vorstellen“. Ein Klick auf das ✋ in der Matrix (oder „👁 Ansehen“ in der Liste)
  öffnet **das AB der Person** über dem Dashboard – Du kannst die Aufgabe lesen, kommentieren, zeichnen. Oben in der Leiste steht „🖍️ Aufgabe N an die Tafel“: Ein Klick darauf (oder „🖍️ An die Tafel“ direkt in der Liste)
  startet die Tafel für **alle**: Alle iPads wechseln zur Tafel (nichts anderes bedienbar), die bearbeitete Aufgabe liegt als Karte auf der Tafel, und nur die vorstellende Person darf mit den
  freigegebenen Werkzeugen (Stift, Marker, Radierer, Text, Formel, Formen, Laser, „Melden“) schreiben. „← Zurück“ schließt das AB wieder.
- **Drei Ansichten für Dich (Schalter im Dashboard-Kopf, solange die Tafel läuft):** **🖍️ Tafel** (Vollbild), **◫ Geteilt** (Tafel links, Dashboard rechts – die Matrix bleibt im Blick, ein Klick auf einen Namen
  öffnet dessen AB) und **▦ Klasse** (nur das Dashboard; die Tafel läuft für die Klasse unsichtbar weiter). Auch in der Tafel selbst: „◫“ = geteilt, „▦“ = Klasse. „✕“ schließt die Tafel-Ansicht
  (die Klasse bleibt an der Tafel, „🖍️ Tafel läuft ●“ im Kopf). Der nächste Klick auf „an die Tafel“ holt die nächste Person ran (die vorige wird abgezogen).
- **Manuell:** Dashboard → „🖍️ Tafel“ (`/lehrer/tafel`). Dort ☰ öffnen → „▶ Für Klasse starten“, Personen zuschalten/abziehen, 15 Werkzeuge, Aufgaben leer holen (Knopf „an die Tafel“ je Aufgabe) und live lösen lassen.
- **Beamer:** `/lehrer/tafel/beamer` (nur Zuschauen). **Rückblick:** `/lehrer/tafel/rueckblick`.
- **„Möchte ich vorstellen“** im AB-Rand legt ein **Angebot** an die Tafel (erst nach einer Eingabe in der Aufgabe). Im Dashboard steht die Warteschlange;
  **annehmen** = ein Klick im Dashboard (siehe oben). Ablehnen geht im Dashboard, in der Detailansicht oder an der Tafel.
- **Aufgaben für die Tafel** stehen in `tafel_aufgaben.py` (`VARIANTEN`: Lückentext, Zuordnung, Multiple Choice, Richtig/Falsch, Freitext). Es gibt bewusst **nur eine Fassung je Aufgabe**, keine Niveaus A/B/C.
  Aufgabe 4 (Schalenmodell) gibt es nur als AB-Antwort-Karte. Die Lösungen verlassen den Server nie in Richtung Schüler:innen.
  Für ein neues AB: `VARIANTEN` und die Karten-Zuordnung (`AbAdapter.aufgaben_des_schuelers`, Feldnummern wie in `ab_inhalt.html`) anpassen.
- Alles wird wie die übrigen Daten gelöscht: beim Start, bei „Sitzung beenden“, pro Person (deren Beiträge verschwinden von der Tafel) und automatisch,
  wenn niemand mehr angemeldet ist.

## Hilfe-Anfragen und Dashboard

Unter „Möchte ich vorstellen“ hat jede Aufgabe **🙋 Ich brauche Hilfe**. Im Dashboard entscheidest Du pro Anfrage:
💬 **Kommentar** (Schnellantwort oder Text, geht direkt vom Dashboard), 🤖 **KI freigeben** (nur für diese Aufgabe – der
einzige Weg, die KI-Hilfe zu aktivieren; die KI selbst folgt in Schritt 6), 🚶 **Komme** (Schüler:in bekommt einen Hinweis)
oder ✓ **Erledigt**. Ein Kommentar markiert eine offene Anfrage automatisch als „kommentiert“.

Das Dashboard hat zwei Teile:
- **links die Warteschlange:** Hilfe-Anfragen (am längsten Wartende oben) und Vorstellen-Wünsche mit Freigeben/Ablehnen
- **rechts die Matrix** Schüler:innen × Aufgaben mit Symbolen (🙋 Hilfe, 💬, 🤖, 🚶, 🖍️ Tafel, ✋ Vorstellen, ● bearbeitet).
  Die Kopfzeile zeigt je Aufgabe, wie viele schon etwas geschrieben haben und wo Hilfe offen ist. Ein Tipp auf eine Zelle
  öffnet die Detailansicht direkt an dieser Aufgabe. Die Zeilen bleiben alphabetisch, damit nichts unter dem Finger springt.
  😶 = online, aber seit 5 Minuten ohne Eingabe (nur ein Hinweis, `RUHIG_MIN` in `dashboard.html`).

## Lehrerkommentare

In der Detailansicht steht unter dem Vorstellen-Feld jeder Aufgabe **💬 Kommentar**: Schnellantworten
(„Sehr gut ✓“, „Bitte genauer“ …) mit einem Tipp oder freier Text. Der Kommentar erscheint sofort in der Randspalte
der Schülerin / des Schülers, **türkis, in eigener Schrift mit „✎ Lehrkraft“** (Schülertext ist blau). Er liegt neben der
Aufgabe und verdeckt keine Antworten. Bei neuen Kommentaren erscheint unten ein Hinweis, der zum Kommentar springt.
**Farben:** Jeder Kommentar einer Aufgabe bekommt automatisch eine eigene Pastellfarbe (türkis, rosa, blau, orange, violett, grün; der erste ist türkis wie bisher).
Beim Zeichnen springt die Stiftfarbe automatisch auf die Farbe des Kommentars, den Du gerade geschrieben hast; ein Antippen eines Kommentars wählt dessen Farbe (und startet das Zeichnen in dieser Aufgabe).
In der Zeichenleiste stehen die Kommentarfarben der Aufgabe, dazu rot und gelb (Marker) ohne Kommentarbezug. So sehen die Schüler:innen, welche Markierung zu welchem Kommentar gehört.
Die Zeichnung nutzt denselben Farbton in kräftiger Form (lesbar auf weißem Blatt), das Kommentarfeld die Pastellfassung. Gelöschte Farben werden beim nächsten Kommentar wieder frei.

Kommentare, Zeichnungen und Bilder der Lehrer-Ebene erscheinen nur in der AB-Ansicht der Person, nie an der digitalen Tafel oder im Beamer. Gelöschte Kommentare werden wirklich aus der Datenbank entfernt.
Nach Verbindungsabbruch (iPad schläft) holt sich die Schülerseite den aktuellen Stand per `annotationen_laden`.

## Zeichnen, Stempel, Bilder (Lehrer-Ebene)

In der Detailansicht hat jede Aufgabe oben in der Randspalte **✏️ Zeichnen**. Danach erscheint unten eine Werkzeugleiste:
Stift, Marker (türkis/rot/gelb), Stempel (✓ ✗ ? ! ★ 💡), 🖼️ Bild, 🧽 Radierer (antippen = Objekt löschen), S/M/L,
↶ Rückgängig, 🗑 Alles in dieser Aufgabe, Fertig. Zeichnen geht mit Finger, Apple Pencil und Maus; solange der Zeichenmodus
einer Aufgabe an ist, scrollt die Seite dort nicht – zum Scrollen die Randspalte benutzen oder „Fertig“ tippen.

- Die Ebene liegt **über** den Antworten, ist türkis/rot/gelb (Schülertext ist blau) und der Marker wirkt wie ein Textmarker
  (`mix-blend-mode: multiply`), die Schrift darunter bleibt lesbar. Eingaben der Schüler:innen gehen durch die Ebene hindurch.
- Bilder: werden im Browser auf ≤ 900 px verkleinert (PNG/JPEG, ≤ 300 KB), max. 3 je Aufgabe, mit türkisem Rahmen.
- Koordinaten sind auf die **Breite** der Aufgabe bezogen (x = px/Breite, y = px/Breite). Das Schüler-Gerät meldet seine Blattbreite
  (`breite`), die Lehrer-Ansicht passt ihre Blattbreite daran an. Ist der Lehrer-Bildschirm zu schmal, erscheint ein Hinweis.
- Grenzen (serverseitig geprüft): 200 Objekte je Aufgabe, 400 Punkte je Strich, nur Typen `zeichnung|stempel|bild`, Bildinhalt
  muss zu PNG/JPEG passen (Magic Bytes). Bilder werden nur per `/ebene-bild/<id>` ausgeliefert (Lehrer oder die eigene Person).
- Events: `ebene_neu`, `ebene_loeschen`, `ebene_leeren` (Lehrer → Server), `breite` (Schüler → Server);
  `annotation_neu`, `annotation_weg`, `ebene_geleert` (an `schueler_<id>` und `watch_<id>`), `schueler_breite` (an `watch_<id>`).
- Die Lehrer-Ebene bleibt im AB der Person (nicht an der digitalen Tafel). Alles wird mit „Daten löschen“ / Sitzungsende wirklich gelöscht.

## KI-Lernhilfe (Schritt 6)

Die KI gibt es **nur** bei Aufgaben, bei denen Du in einer Hilfe-Anfrage **🤖 KI** gewählt hast (Hilfe-Status `ki`).
Unter der Aufgabe erscheint dann eine magenta KI-Box mit Fragefeld (Enter sendet). Die KI soll Denkanstöße geben, keine Lösungen
(Systemprompt in `KI_SYSTEM`, `app.py`), antwortet in höchstens 4 Sätzen und bleibt bei der Aufgabe. Nimmst Du die Freigabe
zurück („Erledigt“, „Ich komme“), verschwindet das Fragefeld, der Verlauf bleibt lesbar. In der Detailansicht liest Du jeden Verlauf live mit
(die Schüler:innen sehen den Hinweis „Deine Lehrkraft kann mitlesen“).

**Einrichten** – im Dashboard oben auf **🤖 KI**: Anbieter (Claude oder Gemini), optional Modell, API-Key → „Testen & speichern“.
Der Key wird mit einer Testanfrage geprüft und nur übernommen, wenn sie klappt. Er liegt **nur im Arbeitsspeicher**
(nie in der Datenbank, nie in einer Seite oder einem Event) und ist nach einem Neustart weg. Alternativ per Umgebungsvariable:
`KI_API_KEY`, optional `KI_PROVIDER` (`anthropic`|`gemini`) und `KI_MODEL`. „Ausschalten“ sperrt sofort alle Fragen; ohne Key
oder bei „aus“ lehnt der Server auch „KI freigeben“ ab.

**Was an den Anbieter geht:** Aufgabentext (automatisch aus `ab_inhalt.html`, Felder als „[Feld n]“), die aktuellen Eingaben
dieser einen Aufgabe, der bisherige Dialog (letzte 12 Nachrichten) und die Frage. **Keine Namen, keine Klasse, keine anderen Aufgaben.**
Prompt-Injection: Schülertext ist als Daten gekennzeichnet; Ausgabe wird nur als Text (textContent) angezeigt, max. 400 Tokens.

Grenzen: 10 Fragen je Person und Aufgabe, 500 Zeichen je Frage, 2 s Pause zwischen Fragen, eine offene Anfrage je Aufgabe.
Events: `ki_frage` (Schüler), `ki_einstellung` (Lehrer); `ki_nachricht`, `ki_denkt`, `ki_fehler` (an `schueler_<id>` + `watch_<id>`),
`ki_verfuegbar` (an Schüler), `ki_status` (an `lehrer_room`, ohne Key). Tabelle `ki_verlauf`, wird wie alles andere gelöscht.

## Wo liegen die Daten?

- **SQLite-Datei `data/ab.db`** im Container der App: Antworttexte (`antworten`), Hilfe-Status, Kommentare, Zeichnungen und Bilder
  (`annotationen`), Zustand und Fotos der digitalen Tafel (`tafel_zustand`, `tafel_dateien`), KI-Verläufe (`ki_verlauf`), Pseudonym (`schueler`).
- **Arbeitsspeicher** (weg bei Neustart): Online-Status, Blattbreiten, KI-Einstellungen inkl. Key.
- Es gibt **kein Docker-Volume** für `data/`: Die Daten liegen im Container-Dateisystem, werden beim Start der App gelöscht und sind nach einem
  Redeploy ohnehin weg. Nicht ein Volume für `data/` in Coolify anlegen, sonst bleibt die Datei auf dem Server liegen (gelöscht wird sie dann trotzdem beim Start).
- Ausnahme: Geht eine Frage an die KI, liegen Aufgabentext, Eingaben und Frage kurzzeitig beim Anbieter (Claude/Gemini) – dort gelten dessen Regeln.
  Für den Schulbetrieb vorher klären (Datenschutzbeauftragte:r, API-Vertrag/Auftragsverarbeitung).

## Datenschutz

- Login nur mit Pseudonym (keine Klasse, kein echter Name).
- Anders als beim Standard-Blueprint **werden die Antworttexte gespeichert**, weil die Lehrkraft sie live sehen und kommentieren soll.
  Alles wird beim Start der App gelöscht, per Knopf „Sitzung beenden“ (alle), pro Schüler:in in der Detailansicht und **automatisch
  4 Stunden nach der letzten Aktivität** einer Person (`AUTO_LOESCHEN_STUNDEN`, `0` = aus; der Dienst prüft alle 5 Minuten).
  Es wird nichts über die Stunde hinaus aufbewahrt und nichts aus früheren Stunden fortgesetzt.

## Deployment (Coolify)

`Dockerfile` liegt bei. Es läuft genau **ein** Worker (`-w 1`, gunicorn `gthread` mit 100 Threads, `ASYNC_MODE=threading`), weil Online-Status, Räume und der Tafelzustand im Arbeitsspeicher liegen.
Der Reverse-Proxy (Traefik in Coolify) muss WebSocket-Upgrades durchlassen; die Tafel startet bewusst mit Polling und wechselt dann selbst zu WebSocket.
Umgebungsvariablen: `LEHRER_PASSWORD`, `SECRET_KEY` (fest setzen, sonst sind nach jedem Neustart alle abgemeldet), optional `KI_API_KEY`, `AUTO_LOESCHEN_STUNDEN`.

## Stand

1. Login, AB-Layout ✔  2. Antworten live im Dashboard ✔  3. Vorstellen ✔ (jetzt über die digitale Tafel)  4. Lehrerkommentare ✔  4b. Hilfe-Knopf + neues Dashboard ✔  5. Zeichnen, Stempel, Bilder ✔  6. KI-Lernhilfe (zuschaltbar) ✔

## Offen

- Digitale Tafel an echten iPads im Schul-WLAN erproben (Pilotphase).
- Datenschutz-Freigabe (Speicherung der Antworttexte, KI-Anbieter) mit der Schule klären.
