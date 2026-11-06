import { describe, expect, it } from 'vitest';
import { parseCards } from './cards';
import { advance, applyAction, createTournament, legalActions, startHand, totalChips, type Entrant } from './engine';
import { computePots } from './pots';
import { nextFloat, nextInt, seedRng } from './rng';
import type { TableState, TournamentConfig } from './types';
import { toView } from './view';

const cfg = (stack = 1000, ante = 0): TournamentConfig => ({
  startingStack: stack,
  handsPerLevel: 1000,
  levels: [{ sb: 10, bb: 20, ante }],
});
const entrants = (n: number): Entrant[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, kind: i === 0 ? 'human' : 'bot' }));

function table(n: number, opts: { stack?: number; ante?: number; button?: number } = {}): TableState {
  const s = createTournament(cfg(opts.stack, opts.ante), entrants(n), 42);
  s.buttonSeat = opts.button ?? 0;
  return s;
}
const toActId = (s: TableState) => s.players[s.toAct].id;

/** Overwrite the deck so the given cards are dealt next (deck pops from the end). */
function rigDeck(s: TableState, holes: string[], board: string) {
  // hole cards: dealt one at a time starting left of the button
  const living = s.players.filter((p) => !p.eliminated);
  const order = [...living.slice(s.buttonSeat + 1), ...living.slice(0, s.buttonSeat + 1)];
  const h = holes.map(parseCards);
  const used = new Set<number>();
  for (const p of order) p.holeCards = [...h[p.seat]];
  h.flat().forEach((c) => used.add(c));
  const b = parseCards(board);
  b.forEach((c) => used.add(c));
  const filler = Array.from({ length: 52 }, (_, i) => i).filter((c) => !used.has(c));
  // pop order: burn, flop×3, burn, turn, burn, river
  const seq = [filler[0], b[0], b[1], b[2], filler[1], b[3], filler[2], b[4]];
  s.deck = [...filler.slice(3), ...seq.reverse()];
}

describe('pots', () => {
  it('builds side pots', () => {
    const pots = computePots([
      { id: 'a', amount: 100, folded: false },
      { id: 'b', amount: 300, folded: false },
      { id: 'c', amount: 300, folded: false },
      { id: 'd', amount: 50, folded: true },
    ]);
    expect(pots).toEqual([
      { amount: 350, eligible: ['a', 'b', 'c'] },
      { amount: 400, eligible: ['b', 'c'] },
    ]);
  });
});

describe('blinds and order', () => {
  it('hand 1 keeps the drawn button seat', () => {
    const s = createTournament(cfg(), entrants(4), 7);
    const b = s.buttonSeat;
    startHand(s);
    expect(s.buttonSeat).toBe(b);
    expect(s.sbSeat).toBe((b + 1) % 4);
    expect(s.bbSeat).toBe((b + 2) % 4);
    expect(s.toAct).toBe((b + 3) % 4);
    expect(s.players[s.sbSeat].bet).toBe(10);
    expect(s.players[s.bbSeat].bet).toBe(20);
  });

  it('heads-up: button is small blind and acts first pre-flop, last post-flop', () => {
    const s = createTournament(cfg(), entrants(2), 1);
    startHand(s);
    expect(s.sbSeat).toBe(s.buttonSeat);
    expect(s.toAct).toBe(s.buttonSeat);
    applyAction(s, toActId(s), { type: 'call' });
    // big blind has the option
    expect(s.toAct).toBe(s.bbSeat);
    expect(legalActions(s, s.bbSeat)!.canCheck).toBe(true);
    applyAction(s, toActId(s), { type: 'check' });
    expect(s.phase).toBe('streetComplete');
    advance(s);
    expect(s.board).toHaveLength(3);
    expect(s.toAct).toBe(s.bbSeat);
  });
});

describe('betting rules', () => {
  it('enforces the minimum raise', () => {
    const s = createTournament(cfg(), entrants(3), 3);
    startHand(s);
    const l = legalActions(s, s.toAct)!;
    expect(l.minRaiseTo).toBe(40);
    expect(() => applyAction(s, toActId(s), { type: 'raise', amount: 30 })).toThrow();
    applyAction(s, toActId(s), { type: 'raise', amount: 70 }); // raise by 50
    expect(legalActions(s, s.toAct)!.minRaiseTo).toBe(120);
  });

  it('an incomplete all-in raise does not re-open the betting', () => {
    const s = createTournament(cfg(), entrants(3), 5);
    startHand(s);
    // seat order: utg (toAct), sb, bb
    const utg = s.toAct;
    const sb = s.sbSeat;
    s.players[sb].stack = 90; // after posting 10 → total 100 behind
    applyAction(s, toActId(s), { type: 'raise', amount: 80 }); // UTG raises to 80 (raise by 60)
    applyAction(s, toActId(s), { type: 'raise', amount: 100 }); // SB all-in to 100: +20 < 60
    expect(s.players[sb].allIn).toBe(true);
    applyAction(s, toActId(s), { type: 'call' }); // BB calls 100
    expect(s.toAct).toBe(utg);
    const l = legalActions(s, utg)!;
    expect(l.callAmount).toBe(20);
    expect(l.canRaise).toBe(false);
  });

  it('returns an uncalled bet', () => {
    const s = createTournament(cfg(), entrants(2), 9);
    startHand(s);
    const sb = s.players[s.sbSeat];
    applyAction(s, sb.id, { type: 'raise', amount: 500 });
    applyAction(s, toActId(s), { type: 'fold' });
    expect(s.phase).toBe('handComplete');
    expect(sb.stack).toBe(1020);
    expect(totalChips(s)).toBe(2000);
  });
});

describe('showdown', () => {
  it('splits a pot between equal hands and gives the odd chip left of the button', () => {
    const s = table(3, { button: 0, stack: 1000 });
    s.buttonSeat = 2; // hand 1 keeps it → sb = 0, bb = 1, utg = 2
    startHand(s);
    rigDeck(s, ['Ac Kd', 'Ad Kc', '2c 7d'], 'Qs Jh Td 3c 4s');
    applyAction(s, 'p2', { type: 'raise', amount: 41 }); // odd amount → odd pot
    applyAction(s, 'p0', { type: 'call' });
    applyAction(s, 'p1', { type: 'call' });
    while (s.phase !== 'handComplete') {
      if (s.phase === 'betting') applyAction(s, toActId(s), { type: s.players[s.toAct].id === 'p2' ? 'fold' : 'check' });
      else advance(s);
    }
    const r = s.lastResult!;
    expect(r.showdown).toBe(true);
    expect(r.pots[0].winners.map((w) => w.playerId).sort()).toEqual(['p0', 'p1']);
    expect(r.pots[0].handKey).toBe('straight');
    // pot = 41*3 = 123 → 62 / 61, odd chip to seat 0 (first left of button seat 2)
    expect(s.players[0].stack).toBe(1000 - 41 + 62);
    expect(s.players[1].stack).toBe(1000 - 41 + 61);
    expect(totalChips(s)).toBe(3000);
  });

  it('handles side pots with an all-in short stack', () => {
    const s = table(3, { button: 2 });
    s.players[0].stack = 100; // sb, short
    startHand(s);
    rigDeck(s, ['Ah Ad', 'Kh Kd', 'Qh Qd'], '2c 7s 9d Jc 3h');
    applyAction(s, 'p2', { type: 'raise', amount: 300 });
    applyAction(s, 'p0', { type: 'call' }); // all-in for 100
    applyAction(s, 'p1', { type: 'call' });
    while (s.phase !== 'handComplete') {
      if (s.phase === 'betting') applyAction(s, toActId(s), { type: 'check' });
      else advance(s);
    }
    // main pot 300 → p0 (AA); side pot 400 → p1 (KK)
    expect(s.players[0].stack).toBe(300);
    expect(s.players[1].stack).toBe(1000 - 300 + 400);
    expect(s.players[2].stack).toBe(700);
  });

  it('runs out the board when everybody is all-in and reveals cards', () => {
    const s = table(2, { button: 0 });
    startHand(s);
    applyAction(s, toActId(s), { type: 'raise', amount: 1000 });
    applyAction(s, toActId(s), { type: 'call' });
    expect(s.phase).toBe('streetComplete');
    expect(s.revealed).toHaveLength(2);
    advance(s); // flop
    expect(s.phase).toBe('streetComplete');
    advance(s); // turn
    advance(s); // river
    advance(s); // showdown
    expect(s.phase).toBe('showdown');
    advance(s);
    expect(['handComplete', 'tournamentComplete']).toContain(s.phase);
    expect(totalChips(s)).toBe(2000);
  });
});

describe('antes', () => {
  it('collects antes into the pot', () => {
    const s = table(4, { ante: 5 });
    startHand(s);
    expect(s.pots[0].amount).toBe(20);
    expect(totalChips(s)).toBe(4000);
  });
});

describe('view', () => {
  it('hides opponents hole cards', () => {
    const s = table(3);
    startHand(s);
    const v = toView(s, 'p0');
    expect(v.players[0].holeCards.every((c) => c !== null)).toBe(true);
    expect(v.players[1].holeCards).toEqual([null, null]);
    expect(JSON.stringify(v)).not.toContain('"deck"');
  });
});

describe('random tournaments (fuzz)', () => {
  it('keeps chips constant and always finishes', () => {
    for (let t = 0; t < 40; t++) {
      const n = 2 + (t % 7);
      const s = createTournament(
        { startingStack: 500, handsPerLevel: 5, levels: [{ sb: 5, bb: 10, ante: 0 }, { sb: 10, bb: 20, ante: 2 }, { sb: 25, bb: 50, ante: 5 }, { sb: 50, bb: 100, ante: 10 }, { sb: 100, bb: 200, ante: 25 }] },
        entrants(n),
        1000 + t,
      );
      const rng = seedRng(t);
      const total = 500 * n;
      let steps = 0;
      while (s.phase !== 'tournamentComplete') {
        if (++steps > 200000) throw new Error('tournament did not finish');
        if (s.phase === 'betting') {
          const l = legalActions(s, s.toAct)!;
          const r = nextFloat(rng);
          const id = toActId(s);
          if (r < 0.15) applyAction(s, id, { type: 'fold' });
          else if (r < 0.65 || !l.canRaise) applyAction(s, id, l.canCheck ? { type: 'check' } : { type: 'call' });
          else {
            const span = l.maxRaiseTo - l.minRaiseTo;
            const to = r > 0.93 ? l.maxRaiseTo : l.minRaiseTo + nextInt(rng, span + 1);
            applyAction(s, id, { type: 'raise', amount: to });
          }
        } else advance(s);
        expect(totalChips(s)).toBe(total);
        expect(s.players.every((p) => p.stack >= 0)).toBe(true);
      }
      const places = s.placements.map((p) => p.place).sort((a, b) => a - b);
      expect(places).toEqual(Array.from({ length: n }, (_, i) => i + 1));
    }
  });
});

describe('starting blinds', () => {
  it('starts the structure at the chosen level', async () => {
    const { makeTournamentConfig } = await import('./tournament');
    expect(makeTournamentConfig(1500, 'normal').levels[0]).toEqual({ sb: 10, bb: 20, ante: 0 });
    const c = makeTournamentConfig(1500, 'normal', 3);
    expect(c.levels[0]).toEqual({ sb: 50, bb: 100, ante: 0 });
    expect(c.levels[1]).toEqual({ sb: 75, bb: 150, ante: 0 });
    // out-of-range values are clamped
    expect(makeTournamentConfig(1500, 'normal', 99).levels[0].bb).toBe(150);
    const s = createTournament(c, entrants(3), 1);
    startHand(s);
    expect(s.players[s.bbSeat].bet).toBe(100);
  });
});
