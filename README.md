# Hold'em – Texas Hold'em Sit & Go im Browser

No-Limit Texas Hold'em als Sit & Go-Turnier gegen 1–7 Computergegner. Läuft komplett im Browser
(kein Server, keine Datenbank) und ist für iPhone, iPad und Desktop optimiert. Als statische Seite
lässt es sich direkt auf GitHub Pages hosten.

## Features

- **Sit & Go**: 2–8 Spieler, steigende Blinds (Turbo/Normal/Langsam) mit Antes ab Level 6,
  Startstacks 1.000–5.000, Platzierungen, Statistik
- **Vollständige Regeln**: Side Pots, Split Pots inkl. Odd Chip, Mindest-Raise, unvollständige
  All-in-Raises (öffnen die Action nicht wieder), Rückgabe nicht gecallter Einsätze, Heads-up-Blinds,
  automatisches Aufdecken und Ausspielen bei All-in
- **KI-Gegner** in drei Stufen (Leicht/Mittel/Schwer) mit Persönlichkeiten (Fels, TAG, LAG,
  Calling Station, Maniac). Entscheidungen basieren auf Monte-Carlo-Equity (in einem Web Worker,
  damit die UI flüssig bleibt), Pot Odds, Position, Range-Modellierung und Push/Fold bei kurzem Stack
- **Schwer** (`src/ai/expert.ts`): gewichtete Ranges über alle 1.326 Startkarten-Kombinationen, die nach
  jeder Gegneraktion nachjustiert werden; Startkarten-Tabellen nach Position; Hand- und Board-Erkennung
  (Made Hands, Draws); Entscheidungen per Erwartungswert inkl. Fold Equity für mehrere Einsatzgrößen;
  Push/Fold per Erwartungswert. Benchmark: `bun scripts/bench-ai.ts hard-vs-medium 120 1`
- **Mobile first**: Hoch- und Querformat, Safe Areas, große Touch-Ziele, als Web-App auf dem
  Home-Bildschirm installierbar, offline spielbar
- **Zwei Designs** (Lobby → Design): dunkler Pokertisch (Standard) oder „Clean“ – schlicht, hell oder dunkel je nach Systemeinstellung,
  ohne Tisch, mit Gegner-Kacheln. Umschaltbar jederzeit, auch im Spiel über die Einstellungen
- **3D-Ansicht** (Lobby → Ansicht: Standard oder 3D): realistischer Pokertisch mit three.js – Filz mit
  Holzrand, Hängelampe mit Schatten, Tiefenunschärfe, animiert gegebene und aufgedeckte Karten, Chips,
  die zwischen Stack, Einsatz und Pot wandern, wandernder Dealer-Button. Ziehen schwenkt die Kamera,
  zwei Finger bzw. Mausrad zoomen, Antippen eines Chipstapels blendet die Namensschilder aus/ein.
  „Einfache 3D-Grafik“ (Einstellungen) für ältere Geräte; ohne WebGL fällt die App automatisch auf
  die Standardansicht zurück. Engine, Bots und Bedienleiste sind in beiden Ansichten dieselben;
  three.js wird nur geladen, wenn die 3D-Ansicht gewählt ist. Übernommen und angepasst aus
  [jochenhammes/rubics](https://github.com/jochenhammes/rubics) (Poker-Variante)
- **Deutsch/Englisch**, Vierfarben-Deck, synthetische Soundeffekte (keine Audiodateien),
  Handstärke-Anzeige, Spielverlauf, Spieltempo
- **Gewinnchance-Anzeige** (optional, Einstellungen): deine Chance, die Hand zu gewinnen, z. B. „63 % Gewinnchance“ –
  Monte-Carlo gegen zufällige Hände der Gegner im Spiel, nutzt nur deine eigenen Karten und das Board
- **Vorauswahl-Aktionen**: Während andere am Zug sind, kannst du schon Check/Fold, Check, Fold,
  Call, Call Any oder Raise vormerken. Betragsgebundene Vorauswahlen verfallen, wenn sich der
  Einsatz ändert
- **Einsatz per Tastatur**: Zahlenfeld neben dem Slider (am Rechner direkt fokussiert, Enter setzt)
- Turnier wird automatisch im Browser gespeichert und kann fortgesetzt werden
- Klein und schnell: ca. 55 KB JS (gzip) für die Standardansicht, keine Web-Fonts; three.js (ca. 140 KB gzip)
  nur für die 3D-Ansicht

## Entwicklung

```bash
npm install
npm run dev      # Dev-Server auf http://localhost:5173
npm test         # Engine- und KI-Tests (Vitest)
npm run check    # Typprüfung (svelte-check)
npm run build    # Produktions-Build nach dist/
```

## Deployment

`.github/workflows/deploy.yml` prüft, testet und baut jeden Push. Pushes auf den **Default-Branch**
des Repos werden automatisch auf GitHub Pages veröffentlicht
(Settings → Pages → Source: „GitHub Actions“).

## Architektur

```
src/
  engine/   Reine Spiellogik in TypeScript – kein DOM, keine Timer, deterministischer Seed-RNG
            cards, evaluator (schneller 7-Karten-Bewerter), pots, engine (Zustandsautomat),
            tournament (Blind-Struktur), view (Spieler-Sicht ohne fremde Karten)
  ai/       Bot-Logik: Monte-Carlo-Equity, Profile/Persönlichkeiten, Entscheidung, Web Worker
  game/     GameController-Schnittstelle, LocalGameController (Engine + Bots + Pacing),
            Speicherung (localStorage), Einstellungen
  i18n/     Übersetzungen (de/en)
  ui/       Svelte-5-Komponenten; ui/three: 3D-Tisch (Szene, Karten/Chips, prozedurale Texturen)
```

### Vorbereitet für Multiplayer

Die Architektur ist so geschnitten, dass sich ein Server ergänzen lässt, ohne die UI umzubauen:

- **Engine ist serverfähig**: `TableState` ist reines JSON, alle Regeln sind pure Funktionen
  (`startHand`, `applyAction`, `advance`), der Zufall kommt aus einem gespeicherten Seed. Die
  Engine kann unverändert in Node/Deno/Workers als autoritativer Server laufen.
- **UI sieht nur `PlayerView`**: `toView(state, playerId)` blendet fremde Hole Cards aus. Genau
  diese Projektion würde ein Server pro Spieler über WebSocket senden.
- **`GameController`-Interface** (`src/game/types.ts`): Heute implementiert durch
  `LocalGameController`. Ein `RemoteGameController` (WebSocket) kann dieselbe Schnittstelle
  bedienen: `subscribe`, `act`, …
- **Events**: Jede Zustandsänderung liefert eine Event-Liste (Aktionen, Board, Pots, Ausscheiden),
  die sich direkt als Netzwerk-Nachrichten eignet.
- **Spielertypen** `human | bot | remote` sind im Modell bereits vorgesehen.
- **Speicherung** liegt hinter `storage` (`src/game/storage.ts`) und kann später durch eine
  Account-API ersetzt werden.
