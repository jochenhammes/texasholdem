<script lang="ts">
  import type { PlayerView } from '../../engine/view';
  import type { CategoryKey } from '../../engine/evaluator';
  import { chips, handName, t } from '../../i18n/index.svelte';
  import PlayingCard from './PlayingCard.svelte';
  import { pop } from '../transitions';

  let {
    player,
    x,
    y,
    hero = false,
    thinking = false,
    won = 0,
    handKey = null,
    bestCards = [],
    showdownDone = false,
    hint = null,
  }: {
    player: PlayerView;
    x: number;
    y: number;
    hero?: boolean;
    thinking?: boolean;
    won?: number;
    handKey?: CategoryKey | null;
    bestCards?: number[];
    showdownDone?: boolean;
    hint?: string | null;
  } = $props();

  function hue(s: string) {
    let h = 0;
    for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return h;
  }

  const status = $derived.by(() => {
    const a = player.lastAction;
    if (player.eliminated) return t('out');
    if (!a) return '';
    switch (a.type) {
      case 'fold':
        return t('fold');
      case 'check':
        return t('check');
      case 'call':
        return `${t('call')}`;
      case 'bet':
        return `${t('bet')}`;
      case 'raise':
        return `${t('raise')}`;
      case 'allin':
        return t('allin');
    }
    return '';
  });
  const hasCards = $derived(player.holeCards.length > 0 && !player.eliminated);
  const faceUp = $derived(player.holeCards.some((c) => c !== null));
</script>

<div
  class="seat"
  class:hero
  class:bot={!hero}
  class:folded={player.folded && !player.eliminated}
  class:out={player.eliminated}
  class:active={player.isToAct}
  class:winner={won > 0}
  style="--x:{x};--y:{y};--hue:{hue(player.name)}"
>
  <div class="top">
    {#if hasCards && (hero || faceUp || !player.folded)}
      <div class="cards" class:face={faceUp}>
        {#each player.holeCards as c, i (i)}
          <PlayingCard
            card={c}
            size={hero ? 'lg' : faceUp ? 'sm' : 'xs'}
            delay={i * 90}
            highlight={showdownDone && c !== null && bestCards.includes(c)}
            dim={showdownDone && won === 0 && faceUp && !player.folded}
          />
        {/each}
      </div>
    {/if}
    {#if !hero}
      <div class="avatar" aria-hidden="true">
        {player.name.slice(0, 1).toUpperCase()}
        {#if thinking}<span class="think"><i></i><i></i><i></i></span>{/if}
      </div>
    {/if}
  </div>

  <div class="plate">
    <div class="name">{hero ? t('you') : player.name}</div>
    <div class="stack num">{player.allIn && !player.eliminated ? t('allin') : chips(player.stack)}</div>
  </div>

  <div class="badge-slot">
    {#if won > 0}
      <div class="badge win num" in:pop|global>+{chips(won)}</div>
    {:else if handKey && faceUp && !player.folded}
      <div class="badge hand">{handName(handKey)}</div>
    {:else if hero && hint}
      <div class="badge hint">{hint}</div>
    {:else if status && !player.isToAct}
      {#key status + (player.lastAction?.amount ?? '')}
        <div class="badge st {player.lastAction?.type}" in:pop|global>{status}</div>
      {/key}
    {/if}
  </div>
</div>

<style>
  .seat {
    --mx: 42px;
    --my: 50px;
    position: absolute;
    left: calc(50% + var(--x) * (50% - var(--mx)));
    top: calc(50% + var(--y) * (50% - var(--my)));
    transform: translate(-50%, -50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 80px;
    z-index: 2;
    transition: opacity 0.3s;
  }
  .out {
    opacity: 0.32;
  }
  .folded .top,
  .folded .plate {
    opacity: 0.42;
  }

  /* ── bots: avatar with cards tucked behind it ── */
  .top {
    position: relative;
    display: flex;
    justify-content: center;
  }
  .bot .cards {
    position: absolute;
    left: 50%;
    top: -6px;
    display: flex;
    z-index: 0;
  }
  .bot .cards:not(.face) {
    transform: translateX(-2px);
  }
  .bot .cards:not(.face) :global(.card:first-child) {
    transform: rotate(-6deg);
  }
  .bot .cards:not(.face) :global(.card + .card) {
    margin-left: calc(var(--cw) * -0.55);
    transform: rotate(10deg) translateX(3px);
  }
  .bot .cards.face {
    left: 50%;
    top: -10px;
    transform: translateX(-50%);
    z-index: 3;
  }
  .bot .cards.face :global(.card + .card) {
    margin-left: calc(var(--cw) * -0.16);
  }

  .avatar {
    position: relative;
    z-index: 1;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-weight: 700;
    font-size: 1rem;
    color: hsl(var(--hue) 70% 92%);
    background: linear-gradient(140deg, hsl(var(--hue) 55% 44%), hsl(calc(var(--hue) + 40) 55% 30%));
    box-shadow:
      0 0 0 2px var(--bg),
      0 4px 12px rgba(0, 0, 0, 0.4);
    transition: box-shadow 0.25s;
  }
  .active .avatar {
    box-shadow:
      0 0 0 2px var(--bg),
      0 0 0 4px var(--accent),
      0 0 20px rgba(61, 220, 151, 0.45);
  }
  .winner .avatar {
    box-shadow:
      0 0 0 2px var(--bg),
      0 0 0 4px var(--gold),
      0 0 24px rgba(246, 196, 83, 0.45);
  }
  .think {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 3px;
  }
  .think i {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: #fff;
    animation: blink 1s infinite ease-in-out;
  }
  .think i:nth-child(2) {
    animation-delay: 0.15s;
  }
  .think i:nth-child(3) {
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

  .plate {
    position: relative;
    z-index: 2;
    margin-top: -6px;
    min-width: 64px;
    max-width: 100%;
    padding: 3px 8px 4px;
    border-radius: 10px;
    text-align: center;
    line-height: 1.1;
    background: rgba(12, 15, 20, 0.9);
    box-shadow:
      0 0 0 1px var(--line-2),
      0 6px 16px rgba(0, 0, 0, 0.35);
    transition: box-shadow 0.25s;
  }
  .name {
    font-size: 0.7rem;
    font-weight: 600;
    color: var(--text-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .stack {
    font-size: 0.84rem;
    font-weight: 700;
  }

  /* ── hero: big cards above the name plate ── */
  .seat.hero {
    width: auto;
    min-width: 120px;
    transform: translate(-50%, -66%);
    z-index: 3;
  }
  .hero .cards {
    display: flex;
    margin-bottom: -14px;
  }
  .hero .cards :global(.card:first-child) {
    transform: rotate(-4deg);
  }
  .hero .cards :global(.card + .card) {
    margin-left: calc(var(--cw) * -0.12);
    transform: rotate(4deg);
  }
  .hero .cards :global(.card.hl) {
    transform: translateY(-6px);
  }
  .hero .plate {
    margin-top: 0;
    padding: 5px 16px;
    border-radius: 999px;
  }
  .hero .name {
    font-size: 0.74rem;
  }
  .hero .stack {
    font-size: 0.95rem;
  }
  .hero.active .plate {
    box-shadow:
      0 0 0 2px var(--accent),
      0 0 22px rgba(61, 220, 151, 0.35);
  }
  .hero.winner .plate {
    box-shadow:
      0 0 0 2px var(--gold),
      0 0 26px rgba(246, 196, 83, 0.4);
  }

  .badge-slot {
    height: 22px;
    margin-top: 3px;
    display: flex;
    justify-content: center;
  }
  .badge {
    position: relative;
    z-index: 3;
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.02em;
    padding: 2px 8px;
    height: 20px;
    border-radius: 999px;
    white-space: nowrap;
    background: var(--panel-solid);
    color: var(--text-2);
    box-shadow: 0 0 0 1px var(--line);
  }
  .badge.win {
    background: var(--gold);
    color: #241a00;
    box-shadow: none;
  }
  .badge.hand {
    color: var(--gold);
  }
  .badge.hint {
    color: var(--accent);
  }
  .st.raise,
  .st.bet {
    color: var(--raise);
  }
  .st.call,
  .st.check {
    color: var(--accent);
  }
  .st.allin {
    background: var(--danger);
    color: #2a0505;
    box-shadow: none;
  }

  /* landscape phones: hero cards sit beside the name plate */
  @media (max-height: 500px) {
    .seat.hero {
      flex-direction: row;
      flex-wrap: wrap;
      justify-content: center;
      align-items: center;
      gap: 0 8px;
      max-width: 260px;
      transform: translate(-50%, -64%);
    }
    .hero .top {
      order: 0;
    }
    .hero .cards {
      margin-bottom: 0;
    }
    .hero .badge-slot {
      flex-basis: 100%;
      margin-top: 2px;
    }
  }

  @media (min-width: 700px) and (min-height: 600px) {
    .seat {
      --mx: 60px;
      --my: 62px;
      width: 112px;
    }
    .avatar {
      width: 50px;
      height: 50px;
      font-size: 1.2rem;
    }
    .plate {
      min-width: 84px;
    }
    .name {
      font-size: 0.8rem;
    }
    .stack {
      font-size: 0.95rem;
    }
    .badge {
      font-size: 0.76rem;
    }
  }
</style>
