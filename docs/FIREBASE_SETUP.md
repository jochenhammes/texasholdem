# Firebase einrichten (für „Mit Freunden spielen“)

Einmalig, ca. 5 Minuten. Kostenlos (Spark-Plan), keine Kreditkarte nötig.
Firebase dient nur als Briefkasten zwischen den Browsern – das Spiel läuft beim Gastgeber.

## 1. Projekt anlegen
1. <https://console.firebase.google.com> öffnen und mit deinem Google-Konto anmelden.
2. **Projekt erstellen** → Name z. B. `holdem` → Google Analytics kannst du **ausschalten** → **Projekt erstellen**.

## 2. Anonyme Anmeldung einschalten
1. Links **Build → Authentication** → **Jetzt starten**.
2. Reiter **Anmeldemethode** → **Anonym** → **Aktivieren** → **Speichern**.
3. Reiter **Einstellungen** → **Autorisierte Domains** → **Domain hinzufügen** → `jochenhammes.github.io`.

## 3. Realtime Database anlegen
1. Links **Build → Realtime Database** → **Datenbank erstellen**.
2. Standort **Belgien (europe-west1)** → **Weiter**.
3. **Im gesperrten Modus starten** → **Aktivieren**.
4. Reiter **Regeln**: den gesamten Inhalt ersetzen durch den Inhalt von
   [`firebase/database.rules.json`](../firebase/database.rules.json) → **Veröffentlichen**.
5. Oben im Reiter **Daten** steht die Datenbank-Adresse, z. B.
   `https://holdem-1234-default-rtdb.europe-west1.firebasedatabase.app` – die brauche ich gleich.

## 4. Web-App registrieren
1. Zahnrad oben links → **Projekteinstellungen** → ganz unten **Meine Apps** → Symbol **`</>`** (Web).
2. Spitzname z. B. `holdem-web` → **App registrieren** (Firebase Hosting **nicht** ankreuzen).
3. Es erscheint ein Block `const firebaseConfig = { apiKey: …, authDomain: …, projectId: …, … }`.

## 5. Mir schicken
Den `firebaseConfig`-Block aus Schritt 4 **und** die Datenbank-Adresse aus Schritt 3.
Diese Werte sind **öffentlich** (sie stehen später ohnehin im Code der Webseite) – kein Passwort, kein Geheimnis.
Die Sicherheit kommt aus den Regeln aus Schritt 3.4.

Ich trage sie in `src/config.ts` ein, danach erscheint in der Lobby der Button **„Mit Freunden spielen“**.

## Gut zu wissen
- **Kostenlos-Grenze** (Spark): 100 gleichzeitige Verbindungen, 1 GB Daten, 10 GB Download pro Monat – für private Runden mehr als genug.
  Wird eine Grenze erreicht, funktioniert der Mehrspielermodus kurz nicht; es entstehen **keine Kosten**.
- **Gastgeber** = wer den Tisch eröffnet. Sein Browser mischt und spielt die Bots. Er sollte die App offen lassen
  (am besten iPad oder Rechner). Der Bildschirm wird während des Spiels wachgehalten.
- Der Gastgeber könnte mit technischem Aufwand die Karten der anderen auslesen – unter Freunden okay.
  Gäste sehen nie fremde Karten (durch die Regeln erzwungen).

## Für Entwickler
- Lokal ohne Google-Konto: `npm run emulator` (Database-Emulator, braucht Java) und `npm run dev:mp`.
- Regeln testen: `npm run test:rules`.
