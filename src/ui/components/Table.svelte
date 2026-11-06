<script lang="ts">
  import { describeHand } from '../../engine/evaluator';
  import { rankOf } from '../../engine/cards';
  import type { GameSnapshot } from '../../game/types';
  import { HERO_ID } from '../../game/localController';
  import { settings } from '../../game/settings.svelte';
  import { chips, handName, t } from '../../i18n/index.svelte';
  import PlayingCard from './PlayingCard.svelte';
  import Seat from './Seat.svelte';
  import { pop } from '../transitions';
  import { fade } from 'svelte/transition';

  let { snap }: { snap: GameSnapshot } = $props();

  const view = $derived(snap.view);
  const n = $derived(view.players.length);
  const heroSeat = $derived(view.players.find((p) => p.id === HERO_ID)?.seat ?? 0);

  /** Squircle-ish placement: pushes diagonal seats towards the table's corners. */
  function place(idx: number, count: number, radius = 1) {
    const a = Math.PI / 2 + (idx * 2 * Math.PI) / count;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const k = 0.7;
    return {
      x: +(Math.sign(c) * Math.pow(Math.abs(c), k) * radius).toFixed(4),
      y: +(Math.sign(s) * Math.pow(Math.abs(s), k) * radius).toFixed(4),
    };
  }

  const seats = $derived(
    view.players.map((p) => {
      const idx = (p.seat - heroSeat + n) % n;
      const pos = place(idx, n);
      // seats on the left/right edge put their chips below them, not onto the board
      const side = Math.abs(pos.y) < 0.4 && idx !== 0;
      const bet =
        idx === 0
          ? { x: 0, y: 0.36 } // hero: between board and the big hole cards
          : side
            ? { x: +(pos.x * 0.78).toFixed(4), y: +(pos.y + 0.34).toFixed(4) }
            : place(idx, n, 0.6);
      const btn = side ? { x: +(pos.x * 0.92).toFixed(4), y: +(pos.y - 0.32).toFixed(4) } : place(idx + 0.32, n, 0.7);
      return { p, idx, pos, bet, btn };
    }),
  );

  const result = $derived(view.phase === 'handComplete' || view.phase === 'tournamentComplete' ? view.lastResult : null);
  const showdownDone = $derived(!!result?.showdown);
  const wonBy = $derived.by(() => {
    const m: Record<string, number> = {};
    for (const pot of result?.pots ?? []) for (const w of pot.winners) m[w.playerId] = (m[w.playerId] ?? 0) + w.amount;
    return m;
  });
  const bestCards = $derived(result?.pots[0]?.best ?? []);
  const winnerLine = $derived.by(() => {
    if (!result) return null;
    const main = result.pots[0];
    if (!main) return null;
    const names = main.winners.map((w) => (w.playerId === HERO_ID ? t('you') : view.players.find((p) => p.id === w.playerId)?.name ?? '?'));
    const amount = chips(main.amount);
    const who = names.join(' & ');
    if (main.winners.length > 1) return `${t('splitPot')} · ${who}`;
    return main.handKey ? t('winsWith', { name: who, amount, hand: handName(main.handKey) }) : t('wins', { name: who, amount });
  });

  // Hero's current hand, e.g. "Zwei Paare"
  const heroHint = $derived.by(() => {
    if (!settings.handHints) return null;
    const hero = view.players.find((p) => p.id === HERO_ID);
    if (!hero || hero.folded || hero.eliminated || result) return null;
    const cards = hero.holeCards.filter((c): c is number => c !== null);
    if (cards.length < 2) return null;
    if (view.board.length >= 3) return handName(describeHand([...cards, ...view.board]).key);
    return rankOf(cards[0]) === rankOf(cards[1]) ? handName('pair') : null;
  });

  const potLabel = $derived(view.pots.length > 1 ? view.pots.map((p) => chips(p.amount)).join(' · ') : null);
</script>

<div class="table" style="--n:{n}">
  <div class="felt">
    <div class="center">
      <div class="pot" class:empty={view.potTotal === 0}>
        <span class="label-sm">{t('pot')}</span>
        <span class="num amount">{chips(view.potTotal)}</span>
      </div>
      {#if potLabel}<div class="sidepots num" transition:fade>{potLabel}</div>{/if}

      <div class="board">
        {#each [0, 1, 2, 3, 4] as i (i)}
          <div class="slot">
            {#if view.board[i] !== undefined}
              <PlayingCard
                card={view.board[i]}
                size="md"
                delay={i < 3 ? i * 110 : 0}
                highlight={showdownDone && bestCards.includes(view.board[i])}
                dim={showdownDone && !bestCards.includes(view.board[i])}
              />
            {/if}
          </div>
        {/each}
      </div>

      <div class="result-line">
        {#if winnerLine}
          <div class="winner" in:pop|global>{winnerLine}</div>
        {:else if view.handNumber > 0}
          <div class="hand-no">{t('handNo', { n: view.handNumber })}</div>
        {/if}
      </div>
    </div>
  </div>

  {#each seats as s (s.p.id)}
    {#if s.p.bet > 0}
      <div class="bet num" style="--x:{s.bet.x};--y:{s.bet.y}" in:pop|global out:fade={{ duration: 180 }}>
        <span class="chip"></span>{chips(s.p.bet)}
      </div>
    {/if}
    {#if s.p.isButton}
      <div class="dealer" style="--x:{s.btn.x};--y:{s.btn.y}">D</div>
    {/if}
    <Seat
      player={s.p}
      x={s.pos.x}
      y={s.pos.y}
      hero={s.p.id === HERO_ID}
      thinking={snap.thinkingId === s.p.id}
      won={wonBy[s.p.id] ?? 0}
      handKey={showdownDone ? (result?.hands[s.p.id]?.key ?? null) : null}
      bestCards={showdownDone ? (result?.hands[s.p.id]?.best ?? []) : []}
      {showdownDone}
      hint={s.p.id === HERO_ID ? heroHint : null}
    />
  {/each}
</div>

<style>
  .table {
    position: relative;
    width: 100%;
    height: 100%;
    contain: layout;
  }
  .felt {
    position: absolute;
    inset: 46px 28px;
    border-radius: 999px;
    background: radial-gradient(120% 90% at 50% 40%, var(--felt-1) 0%, var(--felt-2) 70%);
    box-shadow:
      inset 0 0 0 1px var(--felt-line),
      inset 0 0 0 12px rgba(0, 0, 0, 0.12),
      inset 0 0 0 13px var(--felt-line),
      0 30px 80px rgba(0, 0, 0, 0.5);
    display: grid;
    place-items: center;
  }
  .center {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    transform: translateY(-6%);
  }
  .pot {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 5px 14px;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.28);
    transition: opacity 0.3s;
  }
  .pot.empty {
    opacity: 0;
  }
  .label-sm {
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.55);
  }
  .amount {
    font-weight: 750;
    font-size: 1.05rem;
    color: var(--gold);
  }
  .sidepots {
    margin-top: -4px;
    font-size: 0.72rem;
    color: rgba(255, 255, 255, 0.6);
  }
  .board {
    display: flex;
    gap: clamp(4px, 1.2vw, 8px);
  }
  .slot {
    width: clamp(34px, min(10.4vw, 8.4vh), 70px);
    height: calc(clamp(34px, min(10.4vw, 8.4vh), 70px) * 1.4);
    border-radius: 8px;
    background: rgba(0, 0, 0, 0.14);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.05);
  }
  .result-line {
    min-height: 28px;
    display: grid;
    place-items: center;
  }
  .winner {
    padding: 4px 12px;
    border-radius: 999px;
    background: rgba(246, 196, 83, 0.14);
    color: var(--gold);
    font-weight: 700;
    font-size: 0.82rem;
    text-align: center;
    max-width: 70vw;
  }
  .hand-no {
    font-size: 0.72rem;
    color: rgba(255, 255, 255, 0.35);
    font-weight: 600;
    letter-spacing: 0.04em;
  }

  .bet,
  .dealer {
    --mx: 42px;
    --my: 50px;
    position: absolute;
    left: calc(50% + var(--x) * (50% - var(--mx)));
    top: calc(50% + var(--y) * (50% - var(--my)));
    transform: translate(-50%, -50%);
    z-index: 1;
  }
  .bet {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 2px 8px 2px 3px;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.42);
    font-size: 0.78rem;
    font-weight: 700;
  }
  .chip {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: radial-gradient(circle, var(--gold) 0 35%, #fff 36% 48%, var(--gold) 49%);
  }
  .dealer {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: #fff;
    color: #111;
    font-weight: 800;
    font-size: 0.7rem;
    box-shadow: 0 3px 8px rgba(0, 0, 0, 0.35);
    transition:
      left 0.5s var(--ease),
      top 0.5s var(--ease);
  }

  @media (min-width: 700px) and (min-height: 600px) {
    .felt {
      inset: 58px 60px;
    }
    .bet,
    .dealer {
      --mx: 60px;
      --my: 62px;
    }
    .bet {
      font-size: 0.88rem;
    }
  }
</style>
