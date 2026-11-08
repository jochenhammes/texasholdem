/** Where do "hard" bots move all-in pre-flop? bun scripts/allin-stats.ts <tournaments> */
if (process.env.TUNE) (globalThis as { __expertTune?: unknown }).__expertTune = JSON.parse(process.env.TUNE);
const { advance, applyAction, createTournament } = await import('../src/engine/engine');
const { makeTournamentConfig } = await import('../src/engine/tournament');
const { toView } = await import('../src/engine/view');
const { decide } = await import('../src/ai/decide');
const { makeProfile } = await import('../src/ai/profiles');
const { trackStats } = await import('../src/ai/opponentStats');
import type { HandAction } from '../src/ai/decide';
import type { StatsTable } from '../src/ai/opponentStats';

const N = Number(process.argv[2] ?? 40);
const speed = (process.env.SPEED ?? 'normal') as 'turbo' | 'normal' | 'slow';
const rows: { bb: number; kind: string; hand: number; level: number }[] = [];
let preflopDecisions = 0;
let seed = 1;
for (let t = 0; t < N; t++) {
  const profiles = Array.from({ length: 6 }, (_, i) => (i % 2 === 0 ? makeProfile('hard', 'tag') : makeProfile('medium', (['tag', 'lag', 'rock'] as const)[i % 3])));
  const s = createTournament(makeTournamentConfig(1500, speed), profiles.map((_, i) => ({ id: `p${i}`, name: '', kind: 'bot' as const })), 500 + t);
  let history: HandAction[] = [];
  const stats: StatsTable = {};
  const per = { vpip: new Set<string>(), pfr: new Set<string>() };
  const track = (ev: Parameters<typeof trackStats>[1]) => trackStats(stats, ev, s.street, () => s.players.filter((p) => !p.eliminated).map((p) => p.id), per);
  let g = 0;
  while (s.phase !== 'tournamentComplete' && g++ < 60000) {
    if (s.phase === 'betting') {
      const p = s.players[s.toAct];
      const prof = profiles[p.seat];
      const view = toView(s, p.id);
      const { action } = decide({ view, profile: prof, history, seed: seed++, stats });
      const facing = history.filter((h) => h.street === 'preflop' && (h.type === 'raise' || h.type === 'bet' || h.type === 'allin')).length;
      const startBB = (p.stack + p.committed) / view.level.bb;
      track(applyAction(s, p.id, action));
      if (prof.difficulty === 'hard' && s.street === 'preflop') {
        preflopDecisions++;
        if (p.allIn && p.lastAction?.type === 'allin') {
          const kind = facing === 0 ? 'open-shove' : action.type === 'call' ? 'call-allin' : `reshove(vs ${facing} raise)`;
          rows.push({ bb: Math.round(startBB), kind, hand: s.handNumber, level: s.levelIndex + 1 });
        }
      }
      history.push({ playerId: p.id, street: s.street, type: p.lastAction!.type, amount: p.lastAction!.amount });
    } else {
      if (s.phase === 'handComplete') history = [];
      track(advance(s));
    }
  }
}
const byKind = new Map<string, number[]>();
for (const r of rows) (byKind.get(r.kind) ?? byKind.set(r.kind, []).get(r.kind)!).push(r.bb);
console.log(`hard pre-flop decisions: ${preflopDecisions}, all-ins: ${rows.length} (${((100 * rows.length) / preflopDecisions).toFixed(1)}%)`);
for (const [k, v] of byKind) {
  v.sort((a, b) => a - b);
  const deep = v.filter((x) => x > 25).length;
  console.log(`${k.padEnd(22)} n=${v.length}  stackBB median ${v[v.length >> 1]}  >25BB: ${deep}  >40BB: ${v.filter((x) => x > 40).length}`);
}
const early = rows.filter((r) => r.level <= 2);
console.log(`in levels 1–2: ${early.length}`, early.slice(0, 12).map((r) => `${r.kind}@${r.bb}bb`).join(', '));
