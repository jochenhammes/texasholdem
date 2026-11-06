<script lang="ts">
  import type { PlayerView } from '../../engine/view';
  import type { GameSnapshot } from '../../game/types';
  import { HERO_ID } from '../../game/localController';
  import { settings } from '../../game/settings.svelte';
  import { chips, handName, t } from '../../i18n/index.svelte';
  import { tableInfo } from '../tableInfo';
  import { pop } from '../transitions';
  import PlayingCard from './PlayingCard.svelte';

  /**
   * "Clean" design: a calm, light layout without a poker table.
   * Opponents are listed as tiles in acting order, the board sits in a plain
   * panel and your own hand is shown below.
   */
  let { snap }: { snap: GameSnapshot } = $props();

  const view = $derived(snap.view);
  const n = $derived(view.players.length);
  const hero = $derived(view.players.find((p) => p.id === HERO_ID)!);
  // opponents in acting order, starting left of the hero
  const opponents = $derived(
    view.players
      .filter((p) => p.id !== HERO_ID)
      .sort((a, b) => ((a.seat - hero.seat + n) % n) - ((b.seat - hero.seat + n) % n)),
  );
  const info = $derived(tableInfo(view, settings.handHints));

  function role(p: PlayerView): string | null {
    if (p.eliminated) return null;
    if (p.isButton) return 'D';
    if (p.isSmallBlind) return 'SB';
    if (p.isBigBlind) return 'BB';
    return null;
  }

  function status(p: PlayerView): string {
    if (p.eliminated) return t('out');
    const a = p.lastAction;
    if (!a) return '';
    switch (a.type) {
      case 'fold':
        return t('fold');
      case 'check':
        return t('check');
      case 'call':
        return `${t('call')} ${chips(a.amount)}`;
      case 'bet':
        return `${t('bet')} ${chips(a.amount)}`;
      case 'raise':
        return `${t('raise')} ${chips(a.amount)}`;
      case 'allin':
        return `${t('allin')} ${chips(a.amount)}`;
    }
  }

  const faceUp = (p: PlayerView) => p.holeCards.some((c) => c !== null);
</script>

<div class="clean">
  <section class="opponents" aria-label="Gegner">
    {#each opponents as p (p.id)}
      {@const won = info.wonBy[p.id] ?? 0}
      {@const hand = info.showdownDone && faceUp(p) && !p.folded ? info.result?.hands[p.id] : null}
      <div
        class="opp"
        class:active={p.isToAct}
        class:folded={p.folded && !p.eliminated}
        class:out={p.eliminated}
        class:winner={won > 0}
      >
        <div class="line">
          <span class="name">{p.name}</span>
          {#if role(p)}<span class="role">{role(p)}</span>{/if}
          <span class="spacer"></span>
          {#if snap.thinkingId === p.id}
            <span class="thinking" aria-label={t('thinking')}><i></i><i></i><i></i></span>
          {:else if p.holeCards.length && !p.eliminated && (!p.folded || faceUp(p))}
            <span class="mini-cards">
              {#each p.holeCards as c, i (i)}
                <PlayingCard
                  card={c}
                  size="xs"
                  delay={i * 80}
                  highlight={info.showdownDone && c !== null && won > 0 && (info.result?.hands[p.id]?.best ?? []).includes(c)}
                />
              {/each}
            </span>
          {/if}
        </div>
        <div class="line">
          <span class="stack num">{p.allIn && !p.eliminated ? t('allin') : chips(p.stack)}</span>
          <span class="spacer"></span>
          {#if won > 0}
            <span class="won num" in:pop|global>+{chips(won)}</span>
          {:else if hand}
            <span class="muted">{handName(hand.key)}</span>
          {:else if p.bet > 0}
            <span class="bet num" in:pop|global>{chips(p.bet)}</span>
          {:else}
            <span class="status {p.lastAction?.type ?? ''}">{status(p)}</span>
          {/if}
        </div>
      </div>
    {/each}
  </section>

  <section class="board-panel">
    <div class="pot-line">
      <span class="label">{t('pot')}</span>
      <span class="pot num">{chips(view.potTotal)}</span>
      {#if info.potLabel}<span class="muted num">({info.potLabel})</span>{/if}
    </div>
    <div class="board">
      {#each [0, 1, 2, 3, 4] as i (i)}
        <div class="slot">
          {#if view.board[i] !== undefined}
            <PlayingCard
              card={view.board[i]}
              size="md"
              delay={i < 3 ? i * 110 : 0}
              highlight={info.showdownDone && info.bestCards.includes(view.board[i])}
              dim={info.showdownDone && !info.bestCards.includes(view.board[i])}
            />
          {/if}
        </div>
      {/each}
    </div>
    <div class="result-line">
      {#if info.winnerLine}
        <span class="winner-text" in:pop|global>{info.winnerLine}</span>
      {:else if view.handNumber > 0}
        <span class="muted">{t('handNo', { n: view.handNumber })}</span>
      {/if}
    </div>
  </section>

  <section class="me" class:active={hero.isToAct} class:winner={(info.wonBy[HERO_ID] ?? 0) > 0} class:folded={hero.folded}>
    <div class="my-cards">
      {#if hero.holeCards.length && !hero.eliminated}
        {#each hero.holeCards as c, i (i)}
          <PlayingCard
            card={c}
            size="lg"
            delay={i * 90}
            highlight={info.showdownDone && c !== null && (info.result?.hands[HERO_ID]?.best ?? []).includes(c)}
          />
        {/each}
      {/if}
    </div>
    <div class="my-info">
      <div class="line">
        <span class="name">{t('you')}</span>
        {#if role(hero)}<span class="role">{role(hero)}</span>{/if}
        <span class="stack num">{hero.allIn && !hero.eliminated ? t('allin') : chips(hero.stack)}</span>
      </div>
      <div class="line">
        {#if (info.wonBy[HERO_ID] ?? 0) > 0}
          <span class="won num" in:pop|global>+{chips(info.wonBy[HERO_ID])}</span>
        {:else if info.showdownDone && info.result?.hands[HERO_ID]}
          <span class="muted">{handName(info.result.hands[HERO_ID].key)}</span>
        {:else if info.heroHint}
          <span class="hint">{info.heroHint}</span>
        {:else}
          <span class="status {hero.lastAction?.type ?? ''}">{status(hero)}</span>
        {/if}
        {#if hero.bet > 0}<span class="bet num" in:pop|global>{chips(hero.bet)}</span>{/if}
      </div>
    </div>
  </section>
</div>

<style>
  .clean {
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 4px calc(12px + var(--safe-r)) 12px calc(12px + var(--safe-l));
    overflow-y: auto;
    width: min(1100px, 100%);
    margin: 0 auto;
  }

  /* ── opponents ── */
  .opponents {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    min-width: 0;
    gap: 8px;
    flex: none;
  }

  .opp {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 10px 12px;
    border-radius: 14px;
    background: var(--bg-elev);
    box-shadow: inset 0 0 0 1px var(--line);
    transition:
      box-shadow 0.2s,
      opacity 0.2s;
  }
  .opp.active {
    box-shadow: inset 0 0 0 2px var(--accent);
  }
  .opp.winner {
    box-shadow: inset 0 0 0 2px var(--gold);
  }
  .opp.folded {
    opacity: 0.5;
  }
  .opp.out {
    opacity: 0.35;
  }
  .line {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 26px;
    min-width: 0;
  }
  .spacer {
    flex: 1;
  }
  .name {
    font-weight: 650;
    font-size: 0.88rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .role {
    flex: none;
    font-size: 0.64rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    padding: 1px 5px;
    border-radius: 6px;
    color: var(--text-2);
    box-shadow: inset 0 0 0 1px var(--line-2);
  }
  .stack {
    font-size: 1.05rem;
    font-weight: 700;
  }
  .mini-cards {
    flex: none;
    margin-left: auto;
    display: flex;
    gap: 3px;
  }
  .status,
  .muted,
  .won {
    white-space: nowrap;
  }
  /* second tile line may wrap (e.g. "Zwei Paare" under the stack at showdown) */
  .opp .line {
    flex-wrap: wrap;
    row-gap: 2px;
  }
  .opp {
    overflow: hidden;
  }
  .opp .name {
    min-width: 2.6em;
    flex: 0 1 auto;
  }
  .opp .role {
    flex: none;
  }
  .mini-cards :global(.card.xs) {
    --cw: 22px;
  }
  .status {
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--text-3);
  }
  .status.raise,
  .status.bet {
    color: var(--raise);
  }
  .status.call,
  .status.check {
    color: var(--accent);
  }
  .status.allin {
    color: var(--danger);
  }
  .muted {
    font-size: 0.78rem;
    color: var(--text-3);
  }
  .hint {
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--accent);
  }
  .won {
    font-size: 0.82rem;
    font-weight: 750;
    color: var(--gold);
  }
  .bet {
    font-size: 0.78rem;
    font-weight: 700;
    padding: 1px 8px;
    border-radius: 999px;
    background: var(--panel-3);
  }
  .thinking {
    display: flex;
    gap: 3px;
  }
  .thinking i {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--accent);
    animation: blink 1s infinite ease-in-out;
  }
  .thinking i:nth-child(2) {
    animation-delay: 0.15s;
  }
  .thinking i:nth-child(3) {
    animation-delay: 0.3s;
  }
  @keyframes blink {
    0%,
    80%,
    100% {
      opacity: 0.25;
    }
    40% {
      opacity: 1;
    }
  }

  /* ── board ── */
  .board-panel {
    flex: 1 0 auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 14px 8px;
    border-radius: 18px;
    background: var(--bg-elev);
    box-shadow: inset 0 0 0 1px var(--line);
  }
  .pot-line {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .pot {
    font-size: 1.15rem;
    font-weight: 750;
  }
  .board {
    display: flex;
    gap: clamp(4px, 1.2vw, 8px);
  }
  .slot {
    width: clamp(34px, min(10.4vw, 8.4vh), 70px);
    height: calc(clamp(34px, min(10.4vw, 8.4vh), 70px) * 1.4);
    border-radius: 8px;
    box-shadow: inset 0 0 0 1px var(--line);
    background: var(--panel-2);
  }
  .result-line {
    min-height: 22px;
    text-align: center;
  }
  .winner-text {
    font-weight: 700;
    font-size: 0.9rem;
    color: var(--gold);
  }

  /* ── my hand ── */
  .me {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 16px;
    padding: 12px 16px;
    border-radius: 18px;
    background: var(--bg-elev);
    box-shadow: inset 0 0 0 1px var(--line);
    transition: box-shadow 0.2s;
  }
  .me.active {
    box-shadow: inset 0 0 0 2px var(--accent);
  }
  .me.winner {
    box-shadow: inset 0 0 0 2px var(--gold);
  }
  .me.folded .my-cards {
    opacity: 0.45;
  }
  .my-cards {
    display: flex;
    gap: 6px;
    min-height: calc(clamp(40px, min(15vw, 10.5vh), 84px) * 1.4);
  }
  .my-info {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 120px;
  }
  .my-info .name {
    font-size: 0.95rem;
  }
  .my-info .stack {
    margin-left: auto;
    font-size: 1.2rem;
  }

  /* phones: three narrow columns of opponents */
  @media (max-width: 520px) {
    .opponents {
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 6px;
    }
    .opp {
      padding: 6px 8px;
      gap: 1px;
    }
    .name {
      font-size: 0.8rem;
    }
    .stack {
      font-size: 0.9rem;
    }
    .board-panel {
      padding: 10px 6px;
      gap: 6px;
    }
    .me {
      padding: 10px 12px;
    }
  }

  /* landscape phones: opponents left, board and hand right */
  @media (orientation: landscape) and (max-height: 500px) {
    .clean {
      display: grid;
      grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
      grid-template-rows: 1fr auto;
      gap: 8px;
    }
    .opponents {
      grid-row: 1 / span 2;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      align-content: start;
      overflow-y: auto;
    }
    .opp {
      padding: 6px 10px;
      gap: 2px;
    }
    .mini-cards :global(.card.xs) {
      --cw: 18px;
    }
    .me {
      padding: 8px 12px;
      gap: 10px;
    }
    .me :global(.card.lg) {
      --cw: 44px;
    }
    .my-cards {
      min-height: 0;
    }
    .my-info {
      min-width: 0;
    }
  }
</style>
