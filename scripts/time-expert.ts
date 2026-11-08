import { advance, applyAction, createTournament, startHand } from '../src/engine/engine';
import { makeTournamentConfig } from '../src/engine/tournament';
import { toView } from '../src/engine/view';
import { decide, type HandAction } from '../src/ai/decide';
import { makeProfile } from '../src/ai/profiles';
const prof = makeProfile('hard', 'tag');
const times: Record<string, number[]> = { preflop: [], flop: [], turn: [], river: [] };
for (let t = 0; t < 30; t++) {
  const s = createTournament(makeTournamentConfig(1500, 'normal'), Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, name: '', kind: 'bot' as const })), t);
  startHand(s);
  const history: HandAction[] = [];
  let g = 0;
  while (s.phase !== 'handComplete' && g++ < 200) {
    if (s.phase === 'betting') {
      const p = s.players[s.toAct];
      const t0 = performance.now();
      const { action } = decide({ view: toView(s, p.id), profile: prof, history, seed: g });
      times[s.street].push(performance.now() - t0);
      applyAction(s, p.id, action);
      history.push({ playerId: p.id, street: s.street, type: p.lastAction!.type, amount: p.lastAction!.amount });
    } else advance(s);
  }
}
for (const [k, v] of Object.entries(times)) {
  v.sort((a, b) => a - b);
  console.log(k.padEnd(8), 'n=' + v.length, 'median', (v[v.length >> 1] ?? 0).toFixed(1) + 'ms', 'p90', (v[Math.floor(v.length * 0.9)] ?? 0).toFixed(1) + 'ms', 'max', (v[v.length - 1] ?? 0).toFixed(1) + 'ms');
}
