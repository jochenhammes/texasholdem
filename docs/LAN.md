# Turnier im Heimnetz

Mehrere Leute spielen gemeinsam an einem Tisch – jeder auf seinem eigenen Handy, Tablet oder Rechner.
Ein Rechner im Heimnetz (z. B. Ubuntu) dient als Server. Keine Datenbank, kein Konto, keine Konfiguration.

## Starten (auf dem Server-Rechner)

Voraussetzung: Node.js 22 oder neuer (`node -v`). Ubuntus eigenes `nodejs`-Paket ist oft zu alt –
am einfachsten über [nvm](https://github.com/nvm-sh/nvm): `nvm install 22`.

```bash
git clone -b localmultiplayer https://github.com/jochenhammes/texasholdem.git
cd texasholdem
npm install
npm run build
npm run preview
```

Die Konsole zeigt die Adresse im Heimnetz, z. B.

```
➜  Network: http://192.168.1.20:4173/
```

Diese Adresse auf allen Geräten im selben WLAN/Netz öffnen. Beenden mit `Strg+C`.

Ist auf Ubuntu die Firewall (ufw) aktiv, den Port einmalig freigeben: `sudo ufw allow 4173/tcp`.

## Ablauf

1. **Wer die Adresse zuerst öffnet, ist Admin.** Er sieht das gewohnte Foyer (Name, Spieler am Tisch,
   Gegnerstärke, Startchips, Blinds, Tempo) und darüber die Liste der Angemeldeten.
2. **Alle anderen** geben ihren Namen ein und tippen „Beitreten“ – bis zu 7 weitere Spieler.
   Sie sehen „Warte auf …“ und die Einstellungen des Admins live.
3. **Der Admin legt die Gesamtzahl der Spieler fest** (nie weniger als angemeldet) und tippt
   **„An den Tisch“** – das Turnier startet für alle. Freie Plätze übernehmen Computergegner.
   Optional legt er ein **Zeitlimit pro Zug** fest (Schieberegler, 20 Sekunden bis 2 Minuten; Standard: kein Limit).
   Außerdem entscheidet der Admin, ob die **Gewinnchance-Anzeige** für alle Spieler an ist (Standard: aus).
4. **Am Tisch:** Jeder wählt für sein Gerät selbst **Standard- oder 3D-Ansicht** (im Warteraum oder in den
   Einstellungen). Ist ein Zeitlimit gesetzt, wird nach Ablauf automatisch gecheckt bzw. gefoldet.
   Wer die Seite schließt oder die Verbindung verliert, sitzt nach dem erneuten Öffnen wieder am Platz.
5. **Später Hinzukommende** können zuschauen und sich fürs nächste Turnier anmelden.
6. **Turnierende:** Der Admin kommt über „Neues Turnier“ zurück ins Foyer – mit denselben Spielern.
   Über das Menü kann er das Turnier jederzeit für alle beenden.

### Wenn der Admin geht

- **Browser bzw. Tab geschlossen:** Nach 15 Sekunden wird das Turnier zurückgesetzt – ohne Neustart des
  Servers. Alle landen wieder im Foyer, der nächste angemeldete Spieler wird Admin (die übrigen bleiben angemeldet).
  Ein Neuladen der Seite zählt nicht: Der Admin ist nach einer Sekunde wieder da.
- **Nur die Verbindung weg** (WLAN-Aussetzer, Handy im Standby, leerer Akku): Das Turnier läuft weiter, der Admin
  checkt/foldet automatisch. Erst wenn er **2 Minuten** lang nicht zurückkommt, wird zurückgesetzt.
- Die anderen sehen in beiden Fällen einen Hinweis mit Countdown.

## Gut zu wissen

- Das Turnier läuft auf dem Server, nicht im Browser des Admins – Handys dürfen zwischendurch in den Standby.
- Der Turnierstand liegt nur im Speicher: `Strg+C` bzw. ein Neustart des Servers beendet das Turnier.
- Jeder Browser bekommt nur seine eigenen Karten zu sehen; fremde verdeckte Karten verlassen den Server nie.
- Ohne Server (z. B. auf GitHub Pages) startet die App wie gewohnt im Einzelspielermodus.
- `npm run dev` startet denselben Server mit Live-Neuladen (für die Entwicklung).
- Alles läuft unverschlüsselt im eigenen Netz – nicht ins Internet freigeben.
