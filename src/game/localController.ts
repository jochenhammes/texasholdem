import { BotClient } from '../ai/botClient';
import { randomPersonality, type Personality } from '../ai/profiles';
import { createTournament, type Entrant } from '../engine/engine';
import { randomSeed, seedRng, shuffle } from '../engine/rng';
import { makeTournamentConfig } from '../engine/tournament';
import type { GameEvent, PlayerAction, SeatPlayer } from '../engine/types';
import { toView } from '../engine/view';
import { storage, type SavedGame } from './storage';
import { TableRunner, type GameData } from './tableRunner';
import type { GameController, GameSetup, GameSnapshot } from './types';

export const HERO_ID = 'hero';

export const BOT_NAMES = [
  'Ava', 'Ben', 'Chen', 'Dana', 'Emil', 'Fiona', 'Gus', 'Hana', 'Ivo', 'Jule', 'Kai', 'Lena',
  'Milo', 'Nora', 'Otto', 'Pia', 'Quinn', 'Rosa', 'Sam', 'Tara', 'Uli', 'Vera', 'Wes', 'Yara', 'Zoe',
];

export interface Pacing {
  /** Delay multiplier (1 = normal, < 1 = faster). Read on every step so settings apply live. */
  speed: () => number;
}

interface Internal extends GameData {
  statsRecorded?: boolean;
}

export function newGame(setup: GameSetup): Internal {
  const seed = randomSeed();
  const rng = seedRng(seed ^ 0x5bd1e995);
  const names = shuffle([...BOT_NAMES], rng).filter((n) => n.toLowerCase() !== setup.playerName.trim().toLowerCase());
  const entrants: Entrant[] = [{ id: HERO_ID, name: setup.playerName.trim() || 'Du', kind: 'human' }];
  const personalities: Record<string, Personality> = {};
  for (let i = 1; i < setup.totalPlayers; i++) {
    const id = `bot${i}`;
    entrants.push({ id, name: names[i - 1], kind: 'bot' });
    personalities[id] = randomPersonality(setup.difficulty, rng);
  }
  const state = createTournament(makeTournamentConfig(setup.startingStack, setup.blindSpeed, setup.startLevel ?? 0), entrants, seed);
  return { setup, state, personalities, history: [], log: [] };
}

/** Single player: engine + bots in the browser, saved to localStorage. */
export class LocalGameController implements GameController {
  private g: Internal;
  private runner: TableRunner;
  private bots = new BotClient();
  private listeners = new Set<(s: GameSnapshot) => void>();
  private lastEvents: GameEvent[] = [];
  private spectating = false;
  private disposed = false;

  constructor(game: Internal | SavedGame, pacing: Pacing) {
    this.g = {
      setup: game.setup,
      state: game.state,
      personalities: game.personalities,
      history: game.history ?? [],
      log: game.log ?? [],
      statsRecorded: game.statsRecorded,
    };
    this.runner = new TableRunner(this.g, {
      decideBot: (input) => this.bots.decide(input),
      speed: pacing.speed,
      fastFactor: () => (this.hero.eliminated ? 0.45 : this.hero.folded ? 0.6 : 1),
      turnTimeMs: null,
      shouldHold: () => this.hero.eliminated && !this.spectating,
      onEvents: (events) => this.onEvents(events),
      onUpdate: () => this.emit(),
    });
    this.persist();
    queueMicrotask(() => this.runner.start());
  }

  subscribe(run: (s: GameSnapshot) => void) {
    this.listeners.add(run);
    run(this.snapshot());
    return () => this.listeners.delete(run);
  }

  act(action: PlayerAction) {
    if (!this.disposed && !this.runner.act(HERO_ID, action)) console.warn('Action ignored', action);
  }

  setPaused(paused: boolean) {
    this.runner.setPaused(paused);
  }

  spectate() {
    this.spectating = true;
    this.emit();
    this.runner.nudge();
  }

  dispose() {
    this.disposed = true;
    this.runner.dispose();
    this.bots.dispose();
    this.listeners.clear();
  }

  private get hero(): SeatPlayer {
    return this.g.state.players.find((p) => p.id === HERO_ID)!;
  }

  private onEvents(events: GameEvent[]) {
    for (const e of events) {
      if (e.type === 'handStart' && !this.hero.eliminated) this.bumpStats((st) => st.handsPlayed++);
      if (e.type === 'eliminated' && e.playerId === HERO_ID) this.recordResult(e.place);
      if (e.type === 'tournamentComplete' && e.winnerId === HERO_ID) this.recordResult(1);
    }
    this.lastEvents = events;
    this.persist();
    this.emit();
  }

  private recordResult(place: number) {
    if (this.g.statsRecorded) return;
    this.g.statsRecorded = true;
    this.bumpStats((st) => {
      st.tournaments++;
      if (place === 1) st.wins++;
      st.bestPlace = st.bestPlace === null ? place : Math.min(st.bestPlace, place);
    });
  }

  private bumpStats(fn: (s: ReturnType<typeof storage.loadStats>) => void) {
    const st = storage.loadStats();
    fn(st);
    storage.saveStats(st);
  }

  private persist() {
    if (this.g.state.phase === 'tournamentComplete') {
      storage.clearGame();
      return;
    }
    storage.saveGame({
      version: 1,
      savedAt: Date.now(),
      setup: this.g.setup,
      state: this.g.state,
      personalities: this.g.personalities,
      history: this.g.history,
      log: this.g.log.slice(-150),
      statsRecorded: this.g.statsRecorded,
    });
  }

  private snapshot(): GameSnapshot {
    return {
      view: toView(this.g.state, HERO_ID),
      events: this.lastEvents,
      log: this.g.log,
      thinkingId: this.runner.thinkingId,
      heroEliminated: this.hero.eliminated,
      spectating: this.spectating,
      paused: this.runner.paused,
      personalities: this.g.personalities,
      turn: null,
      multiplayer: null,
    };
  }

  private emit() {
    if (this.disposed) return;
    const snap = this.snapshot();
    for (const l of this.listeners) l(snap);
  }
}
