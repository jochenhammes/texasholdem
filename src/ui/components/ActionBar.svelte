<script lang="ts">
  import type { PlayerAction } from '../../engine/types';
  import type { TableView } from '../../engine/view';
  import { chips, t } from '../../i18n/index.svelte';
  import { slide } from 'svelte/transition';

  let {
    view,
    thinkingName = null,
    onAct,
  }: { view: TableView; thinkingName?: string | null; onAct: (a: PlayerAction) => void } = $props();

  const legal = $derived(view.legal);
  let raising = $state(false);
  let amount = $state(0);

  const unit = $derived(Math.max(1, Math.min(view.level.sb, 25)));
  const round = (v: number) => {
    if (!legal) return v;
    const r = Math.round(v / unit) * unit;
    return Math.max(legal.minRaiseTo, Math.min(legal.maxRaiseTo, r));
  };

  /** Raise-to amount for a fraction of the pot (pot-size raise = call + pot after call). */
  function potFraction(f: number) {
    if (!legal) return 0;
    const potAfterCall = view.potTotal + legal.callAmount;
    return round(legal.currentBet + potAfterCall * f);
  }

  const presets = $derived.by(() => {
    if (!legal) return [];
    const list = [
      { label: t('minRaise'), value: legal.minRaiseTo },
      { label: t('halfPot'), value: potFraction(0.5) },
      { label: t('threeQuarterPot'), value: potFraction(0.75) },
      { label: t('potSize'), value: potFraction(1) },
      { label: t('allin'), value: legal.maxRaiseTo },
    ];
    return list;
  });

  function openRaise() {
    if (!legal) return;
    raising = true;
    amount = legal.isBet ? potFraction(0.5) : legal.minRaiseTo;
  }

  function send(a: PlayerAction) {
    raising = false;
    onAct(a);
  }

  // close raise panel when it's no longer our turn
  $effect(() => {
    if (!legal) raising = false;
  });

  const isAllIn = $derived(!!legal && amount >= legal.maxRaiseTo);
  const sliderPct = $derived(
    legal && legal.maxRaiseTo > legal.minRaiseTo ? ((amount - legal.minRaiseTo) / (legal.maxRaiseTo - legal.minRaiseTo)) * 100 : 100,
  );
</script>

<div class="dock">
  {#if legal}
    {#if raising}
      <div class="raise-panel" transition:slide={{ duration: 180 }}>
        <div class="row presets">
          {#each presets as p (p.label)}
            <button class="chip-btn" class:on={amount === p.value} onclick={() => (amount = p.value)}>{p.label}</button>
          {/each}
        </div>
        <div class="row slider-row">
          <button class="step" aria-label="-" onclick={() => (amount = round(amount - Math.max(unit, view.level.bb)))}>−</button>
          <input
            type="range"
            min={legal.minRaiseTo}
            max={legal.maxRaiseTo}
            step={unit}
            bind:value={amount}
            style="--p:{sliderPct}%"
            aria-label={t('raiseTo')}
          />
          <button class="step" aria-label="+" onclick={() => (amount = round(amount + Math.max(unit, view.level.bb)))}>+</button>
        </div>
      </div>
    {/if}

    <div class="buttons">
      {#if raising}
        <button class="btn ghost" onclick={() => (raising = false)}>{t('cancel')}</button>
        <button class="btn raise wide" onclick={() => send({ type: 'raise', amount: round(amount) })}>
          {isAllIn ? t('allin') : legal.isBet ? t('bet') : t('raiseTo')}
          <span class="num amt">{chips(round(amount))}</span>
        </button>
      {:else}
        <button class="btn fold" onclick={() => send({ type: 'fold' })}>{t('fold')}</button>
        {#if legal.canCheck}
          <button class="btn primary" onclick={() => send({ type: 'check' })}>{t('check')}</button>
        {:else}
          <button class="btn primary" onclick={() => send({ type: 'call' })}>
            {legal.callAmount >= legal.maxRaiseTo - legal.playerBet ? t('allin') : t('call')}
            <span class="num amt">{chips(legal.callAmount)}</span>
          </button>
        {/if}
        {#if legal.canRaise}
          <button class="btn raise" onclick={openRaise}>
            {legal.isBet ? t('bet') : t('raise')}
          </button>
        {:else}
          <button class="btn raise" disabled>{t('raise')}</button>
        {/if}
      {/if}
    </div>
  {:else}
    <div class="waiting">
      {#if thinkingName}
        <span class="pulse"></span>{t('waiting', { name: thinkingName })}
      {:else}
        &nbsp;
      {/if}
    </div>
  {/if}
</div>

<style>
  .dock {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 10px 12px calc(10px + var(--safe-b));
    padding-left: calc(12px + var(--safe-l));
    padding-right: calc(12px + var(--safe-r));
    background: var(--panel);
    backdrop-filter: blur(18px) saturate(1.4);
    -webkit-backdrop-filter: blur(18px) saturate(1.4);
    border-top: 1px solid var(--line);
  }
  .buttons {
    display: grid;
    grid-template-columns: 1fr 1.25fr 1fr;
    gap: 8px;
  }
  .buttons:has(.wide) {
    grid-template-columns: 1fr 2.25fr;
  }
  .buttons .btn {
    min-height: 54px;
    font-size: 1rem;
    flex-direction: column;
    gap: 0;
    line-height: 1.1;
  }
  .amt {
    font-size: 0.82em;
    font-weight: 700;
    opacity: 0.8;
  }
  .btn.fold {
    background: var(--panel-3);
  }

  .raise-panel {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .row {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .presets {
    overflow-x: auto;
    scrollbar-width: none;
  }
  .chip-btn {
    flex: 1 0 auto;
    min-height: 36px;
    padding: 0 10px;
    border-radius: 10px;
    font-size: 0.85rem;
    font-weight: 650;
    background: var(--panel-2);
    color: var(--text-2);
    box-shadow: inset 0 0 0 1px var(--line);
  }
  .chip-btn.on {
    background: rgba(139, 147, 255, 0.18);
    color: var(--raise);
    box-shadow: inset 0 0 0 1px rgba(139, 147, 255, 0.5);
  }
  .step {
    width: 40px;
    height: 40px;
    border-radius: 12px;
    background: var(--panel-2);
    font-size: 1.3rem;
    font-weight: 600;
    flex: none;
  }
  input[type='range'] {
    flex: 1;
    appearance: none;
    -webkit-appearance: none;
    height: 40px;
    background: transparent;
    margin: 0;
  }
  input[type='range']::-webkit-slider-runnable-track {
    height: 6px;
    border-radius: 3px;
    background: linear-gradient(90deg, var(--raise) var(--p), var(--panel-3) var(--p));
  }
  input[type='range']::-moz-range-track {
    height: 6px;
    border-radius: 3px;
    background: linear-gradient(90deg, var(--raise) var(--p), var(--panel-3) var(--p));
  }
  input[type='range']::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 28px;
    height: 28px;
    margin-top: -11px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.4);
  }
  input[type='range']::-moz-range-thumb {
    width: 28px;
    height: 28px;
    border: 0;
    border-radius: 50%;
    background: #fff;
  }

  .waiting {
    min-height: 54px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    color: var(--text-2);
    font-size: 0.92rem;
  }
  .pulse {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent);
    animation: pulse 1.2s infinite ease-in-out;
  }
  @keyframes pulse {
    50% {
      opacity: 0.3;
      transform: scale(0.7);
    }
  }

  @media (min-width: 700px) {
    .dock {
      align-items: center;
    }
    .buttons,
    .raise-panel {
      width: min(560px, 100%);
    }
  }
</style>
