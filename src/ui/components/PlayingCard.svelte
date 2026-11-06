<script lang="ts">
  import { rankLabel, suitOf } from '../../engine/cards';
  import { settings } from '../../game/settings.svelte';
  import SuitIcon from './SuitIcon.svelte';
  import { cardIn } from '../transitions';

  let {
    card = null,
    size = 'md',
    highlight = false,
    dim = false,
    delay = 0,
  }: {
    card?: number | null;
    size?: 'xs' | 'sm' | 'md' | 'lg';
    highlight?: boolean;
    dim?: boolean;
    delay?: number;
  } = $props();

  const suit = $derived(card === null ? -1 : suitOf(card));
  const color = $derived(
    suit < 0
      ? ''
      : suit === 2
        ? 'red'
        : suit === 1
          ? settings.fourColor
            ? 'blue'
            : 'red'
          : suit === 0 && settings.fourColor
            ? 'green'
            : 'black',
  );
</script>

{#key card}
  <div
    class="card {size} {color}"
    class:back={card === null}
    class:hl={highlight}
    class:dim
    in:cardIn|global={{ delay }}
    aria-label={card === null ? 'verdeckte Karte' : undefined}
  >
    {#if card !== null}
      <span class="rank">{rankLabel(card)}</span>
      <span class="pip"><SuitIcon {suit} /></span>
      <span class="big"><SuitIcon {suit} /></span>
    {/if}
  </div>
{/key}

<style>
  .card {
    --cw: 44px;
    position: relative;
    width: var(--cw);
    height: calc(var(--cw) * 1.4);
    border-radius: calc(var(--cw) * 0.12);
    background: #fbfbfc;
    box-shadow:
      0 1px 0 rgba(255, 255, 255, 0.6) inset,
      0 4px 14px rgba(0, 0, 0, 0.3);
    flex: none;
    overflow: hidden;
    transition:
      transform 0.25s var(--ease),
      opacity 0.25s,
      box-shadow 0.25s,
      filter 0.25s;
    contain: layout paint;
  }
  .xs {
    --cw: clamp(18px, 4.6vw, 26px);
  }
  .sm {
    --cw: clamp(24px, 6.4vw, 36px);
  }
  .md {
    --cw: clamp(34px, min(10.4vw, 8.4vh), 70px);
  }
  .lg {
    --cw: clamp(40px, min(15vw, 10.5vh), 84px);
  }

  .red {
    color: var(--red);
  }
  .black {
    color: var(--black);
  }
  .blue {
    color: var(--blue);
  }
  .green {
    color: var(--green);
  }

  .rank {
    position: absolute;
    left: calc(var(--cw) * 0.09);
    top: calc(var(--cw) * 0.03);
    font-size: calc(var(--cw) * 0.44);
    font-weight: 750;
    letter-spacing: -0.04em;
    line-height: 1.05;
  }
  .pip {
    position: absolute;
    left: calc(var(--cw) * 0.1);
    top: calc(var(--cw) * 0.52);
    font-size: calc(var(--cw) * 0.3);
  }
  .big {
    position: absolute;
    right: calc(var(--cw) * -0.08);
    bottom: calc(var(--cw) * -0.06);
    font-size: calc(var(--cw) * 0.78);
    opacity: 0.95;
  }
  .xs .pip,
  .sm .pip {
    display: none;
  }
  .xs .big,
  .sm .big {
    right: calc(var(--cw) * 0.06);
    bottom: calc(var(--cw) * 0.06);
    font-size: calc(var(--cw) * 0.56);
  }

  .back {
    background:
      repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.07) 0 2px, transparent 2px 7px),
      linear-gradient(150deg, #5b67f0, #3a3fb8);
    box-shadow:
      inset 0 0 0 calc(var(--cw) * 0.06) rgba(255, 255, 255, 0.16),
      0 4px 14px rgba(0, 0, 0, 0.3);
  }

  .hl {
    box-shadow:
      0 0 0 2px var(--gold),
      0 6px 22px rgba(246, 196, 83, 0.35);
    transform: translateY(-4px);
  }
  .dim {
    filter: brightness(0.55) saturate(0.6);
  }
</style>
