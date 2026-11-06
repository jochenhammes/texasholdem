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
- **Mobile first**: Hoch- und Querformat, Safe Areas, große Touch-Ziele, als Web-App auf dem
  Home-Bildschirm installierbar, offline spielbar
- **Deutsch/Englisch**, Vierfarben-Deck, synthetische Soundeffekte (keine Audiodateien),
  Handstärke-Anzeige, Spielverlauf, Spieltempo
- Turnier wird automatisch im Browser gespeichert und kann fortgesetzt werden
- Klein und schnell: ca. 45 KB JS (gzip), keine Web-Fonts, keine Laufzeit-Abhängigkeiten außer Svelte

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
  ui/       Svelte-5-Komponenten
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
