/**
 * AI benchmark: plays many complete Sit & Go tournaments bot vs bot.
 *   bun scripts/bench-ai.ts <lineup> <tournaments> <seed>
 * lineup: "<hero>-vs-<easy|medium|hard>" or "<hero>-vs-<personality>" (hero = easy|medium|hard)
 */
// optional tuning overrides, e.g. TUNE='{"temp":0.01,"risk":0.1}'
if (process.env.TUNE) (globalThis as { __expertTune?: unknown }).__expertTune = JSON.parse(process.env.TUNE);
const { advance, applyAction, createTournament } = await import('../src/engine/engine');
const { makeTournamentConfig } = await import('../src/engine/tournament');
const { toView } = await import('../src/engine/view');
const { decide } = await import('../src/ai/decide');
const { makeProfile } = await import('../src/ai/profiles');
const { trackStats } = await import('../src/ai/opponentStats');
import type { HandAction } from '../src/ai/decide';
import type { BotProfile, Difficulty, Personality } from '../src/ai/profiles';
import type { StatsTable } from '../src/ai/opponentStats';

const [lineup = 'hard-vs-medium', nArg = '50', seedArg = '1'] = process.argv.slice(2);
const N = Number(nArg);
const SEATS = 6;

function players(): { label: string; profile: BotProfile }[] {
  const [hero, , field] = lineup.split('-');
  if (field === 'easy' || field === 'medium' || field === 'hard') {
    // one hero vs five of the field level (mixed personalities)
    const fieldPers: Personality[] = ['tag', 'lag', 'rock', 'tag', 'lag'];
    return Array.from({ length: SEATS }, (_, i) =>
      i === 0
        ? { label: hero, profile: makeProfile(hero as Difficulty, 'tag') }
        : { label: `field-${field}`, profile: makeProfile(field as Difficulty, fieldPers[i - 1]) },
    );
  }
  // one hero vs five of a single personality (medium strength)
  return Array.from({ length: SEATS }, (_, i) =>
    i === 0 ? { label: hero, profile: makeProfile(hero as Difficulty, 'tag') } : { label: field, profile: makeProfile('easy', field as Personality) },
  );
}

const stats = new Map<string, { places: number[]; wins: number }>();
let seed = Number(seedArg) * 100000;
const t0 = Date.now();
for (let t = 0; t < N; t++) {
  const base = players();
  // rotate seats so nobody always has the same position
  const rot = base.map((_, i) => base[(i + t) % SEATS]);
  const s = createTournament(makeTournamentConfig(1500, 'turbo'), rot.map((_, i) => ({ id: `s${i}`, name: '', kind: 'bot' as const })), seed + t);
  let history: HandAction[] = [];
  const oppStats: StatsTable = {};
  const perHand = { vpip: new Set<string>(), pfr: new Set<string>() };
  const track = (events: Parameters<typeof trackStats>[1]) =>
    trackStats(oppStats, events, s.street, () => s.players.filter((p) => !p.eliminated).map((p) => p.id), perHand);
  let g = 0;
  while (s.phase !== 'tournamentComplete' && g++ < 60000) {
    if (s.phase === 'betting') {
      const p = s.players[s.toAct];
      const prof = rot[p.seat].profile;
      const { action } = decide({ view: toView(s, p.id), profile: prof, history, seed: seed++, stats: oppStats });
      track(applyAction(s, p.id, action));
      history.push({ playerId: p.id, street: s.street, type: p.lastAction!.type, amount: p.lastAction!.amount });
    } else {
      if (s.phase === 'handComplete') history = [];
      track(advance(s));
    }
  }
  for (const pl of s.placements) {
    const label = rot[Number(pl.playerId.slice(1))].label;
    const st = stats.get(label) ?? { places: [], wins: 0 };
    st.places.push(pl.place);
    if (pl.place === 1) st.wins++;
    stats.set(label, st);
  }
}
const out: Record<string, unknown> = { lineup, tune: process.env.TUNE ?? '', tournaments: N, seconds: Math.round((Date.now() - t0) / 1000) };
for (const [label, st] of stats) {
  const per = st.places.length / N; // seats per tournament with this label
  out[label] = {
    avgPlace: +(st.places.reduce((a, b) => a + b, 0) / st.places.length).toFixed(2),
    winShare: +((st.wins / N) * 100).toFixed(1) + '%',
    winSharePerSeat: +((st.wins / N / per) * 100).toFixed(1) + '%',
  };
}
console.log(JSON.stringify(out));
