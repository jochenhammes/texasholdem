<script lang="ts">
  import type { PlayerAction, PlayerId } from '../../engine/types';
  import type { TableView } from '../../engine/view';
  import { projectedLegal, type PreAction, type QueuedPreAction } from '../../game/preAction';
  import { snapRaiseTo } from '../../game/betSizing';
  import { chips, t } from '../../i18n/index.svelte';
  import { fly } from 'svelte/transition';
  import PlayingCard from './PlayingCard.svelte';

  let {
    view,
    heroId,
    thinkingName = null,
    queued = null,
    notice = null,
    onAct,
    onPreAction,
    awaitingContinue = false,
    onContinue,
  }: {
    view: TableView;
    heroId: PlayerId;
    thinkingName?: string | null;
    queued?: QueuedPreAction | null;
    notice?: string | null;
    onAct: (a: PlayerAction) => void;
    onPreAction: (a: PreAction | null) => void;
    awaitingContinue?: boolean;
    onContinue?: () => void;
  } = $props();

  /** Our turn: real legal actions. Otherwise: what we could do once it's our turn (pre-actions). */
  const legal = $derived(view.legal);
  const pre = $derived(legal ? null : projectedLegal(view, heroId));
  const L = $derived(legal ?? pre);
  const mode = $derived(legal ? 'act' : pre ? 'pre' : 'wait');

  let raising = $state(false);
  let amount = $state(0);

  const unit = $derived(Math.max(1, Math.min(view.level.sb, 25)));
  const round = (v: number) => (L ? snapRaiseTo(v, unit, L.minRaiseTo, L.maxRaiseTo) : v);

  /** Raise-to amount for a fraction of the pot (pot-size raise = call + pot after call). */
  function potFraction(f: number) {
    if (!L) return 0;
    const potAfterCall = view.potTotal + L.callAmount;
    return round(L.currentBet + potAfterCall * f);
  }

  const presets = $derived.by(() => {
    if (!L) return [];
    return [
      { label: t('minRaise'), value: L.minRaiseTo },
      { label: t('halfPot'), value: potFraction(0.5) },
      { label: t('threeQuarterPot'), value: potFraction(0.75) },
      { label: t('potSize'), value: potFraction(1) },
      { label: t('allin'), value: L.maxRaiseTo },
    ];
  });

  function openRaise() {
    if (!L) return;
    raising = true;
    const q = queued?.action;
    amount = q?.type === 'raise' ? round(q.to) : L.isBet ? potFraction(0.5) : L.minRaiseTo;
  }

  // ── keyboard entry of the amount ──
  let typed = $state<string | null>(null);
  let amountInput = $state<HTMLInputElement | null>(null);
  function onType(e: Event & { currentTarget: HTMLInputElement }) {
    const raw = e.currentTarget.value.replace(/\D/g, '');
    typed = raw;
    const n = parseInt(raw, 10);
    if (!Number.isNaN(n)) amount = n;
  }
  function commitTyped() {
    if (typed === null) return;
    typed = null;
    amount = round(amount);
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitTyped();
      confirmRaise();
    } else if (e.key === 'Escape') {
      typed = null;
      raising = false;
    }
  }
  // On computers, focus the field right away so you can just type the amount.
  $effect(() => {
    if (raising && amountInput && matchMedia('(pointer: fine)').matches) {
      amountInput.focus();
      amountInput.select();
    }
  });

  function send(a: PlayerAction) {
    raising = false;
    onAct(a);
  }

  function confirmRaise() {
    if (!L) return;
    typed = null;
    if (mode === 'act') send({ type: 'raise', amount: round(amount) });
    else {
      raising = false;
      onPreAction({ type: 'raise', level: L.currentBet, to: round(amount) });
    }
  }

  /** Toggle a pre-action: tapping the selected one again clears it. */
  function togglePre(a: PreAction) {
    onPreAction(sel(a.type) ? null : a);
  }
  // Check/Fold and Fold do the same thing (check if free, else fold) – show either as selected
  const sel = (type: PreAction['type']) => {
    const q = queued?.action.type;
    if (type === 'fold' || type === 'checkFold') return q === 'fold' || q === 'checkFold';
    return q === type;
  };

  // close the raise panel whenever we switch between "my turn" and "pre-select"
  let lastMode = '';
  $effect(() => {
    if (mode !== lastMode) {
      raising = false;
      lastMode = mode;
    }
  });

  const isAllIn = $derived(!!L && round(amount) >= L.maxRaiseTo);
  const sliderPct = $derived(
    L && L.maxRaiseTo > L.minRaiseTo ? ((amount - L.minRaiseTo) / (L.maxRaiseTo - L.minRaiseTo)) * 100 : 100,
  );
  // shown inside the raise panel, which floats over the bottom of the table
  const myCards = $derived(view.players.find((p) => p.id === heroId)?.holeCards ?? []);
  const queuedRaise = $derived(queued?.action.type === 'raise' ? queued.action.to : null);
</script>

<!--
  Fixed layout: a status line and one button row of constant height, whatever
  the phase – the table above never moves. The raise panel floats above the dock.
-->
<div class="dock" class:pre-mode={mode === 'pre'}>
  {#if L && raising}
      <div class="raise-panel" transition:fly={{ y: 12, duration: 160 }}>
        <div class="row presets">
          {#each presets as p (p.label)}
            <button class="chip-btn" class:on={amount === p.value} onclick={() => (amount = p.value)}>{p.label}</button>
          {/each}
        </div>
        <div class="row slider-row">
          {#if myCards.length}
            <div class="my-cards" aria-hidden="true">
              {#each myCards as card, i (i)}<PlayingCard {card} size="sm" />{/each}
            </div>
          {/if}
          <button class="step" aria-label="-" onclick={() => (amount = round(amount - Math.max(unit, view.level.bb)))}>−</button>
          <input
            type="range"
            min={L.minRaiseTo}
            max={L.maxRaiseTo}
            step="1"
            bind:value={amount}
            style="--p:{sliderPct}%"
            aria-label={t('raiseTo')}
          />
          <button class="step" aria-label="+" onclick={() => (amount = round(amount + Math.max(unit, view.level.bb)))}>+</button>
          <input
            bind:this={amountInput}
            class="amount-input num"
            type="text"
            inputmode="numeric"
            enterkeyhint="done"
            autocomplete="off"
            aria-label={t('amount')}
            title={`${chips(L.minRaiseTo)} – ${chips(L.maxRaiseTo)}`}
            value={typed ?? String(round(amount))}
            oninput={onType}
            onblur={commitTyped}
            onkeydown={onKey}
            onfocus={(e) => e.currentTarget.select()}
          />
        </div>
      </div>
  {/if}

  <div class="status-line">
    {#if notice}
      <span class="notice">{notice}</span>
    {:else if mode === 'pre' && !raising}
      {#if thinkingName}<span class="pulse"></span><span>{t('waiting', { name: thinkingName })}</span>{:else}<span>{t('preHint')}</span>{/if}
    {/if}
  </div>

  <div class="row-main">
    {#if L && raising}
      <div class="buttons">
        <button class="btn ghost" onclick={() => (raising = false)}>{t('cancel')}</button>
        <button class="btn raise wide" onclick={confirmRaise}>
          <span>
            {#if mode === 'pre'}{t('preSelect')} ·{/if}
            {isAllIn ? t('allin') : L.isBet ? t('bet') : t('raiseTo')}
          </span>
          <span class="num amt">{chips(round(amount))}</span>
        </button>
      </div>
    {:else if mode === 'act' && legal}
      <div class="buttons">
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
          <button class="btn raise" onclick={openRaise}>{legal.isBet ? t('bet') : t('raise')}</button>
        {:else}
          <button class="btn raise" disabled>{t('raise')}</button>
        {/if}
      </div>
    {:else if mode === 'pre' && pre}
      <div class="buttons pre">
        {#if pre.canCheck}
          <button class="pre-btn fold" class:on={sel('checkFold')} aria-pressed={sel('checkFold')} onclick={() => togglePre({ type: 'checkFold' })}>
            {t('checkFold')}
          </button>
          <button
            class="pre-btn call"
            class:on={sel('check')}
            aria-pressed={sel('check')}
            onclick={() => togglePre({ type: 'check', level: pre.currentBet })}
          >
            {t('check')}
          </button>
        {:else}
          <button class="pre-btn fold" class:on={sel('fold')} aria-pressed={sel('fold')} onclick={() => togglePre({ type: 'fold' })}>
            {t('fold')}
          </button>
          <button
            class="pre-btn call"
            class:on={sel('call')}
            aria-pressed={sel('call')}
            onclick={() => togglePre({ type: 'call', level: pre.currentBet, amount: pre.callAmount })}
          >
            {pre.callAmount >= pre.maxRaiseTo - pre.playerBet ? t('allin') : t('call')}
            <span class="num amt">{chips(pre.callAmount)}</span>
          </button>
        {/if}
        <button
          class="pre-btn raise"
          class:on={queuedRaise !== null}
          aria-pressed={queuedRaise !== null}
          disabled={!pre.canRaise}
          onclick={() => (queuedRaise !== null ? onPreAction(null) : openRaise())}
        >
          {pre.isBet ? t('bet') : t('raise')}
          {#if queuedRaise !== null}<span class="num amt">{chips(queuedRaise)}</span>{/if}
        </button>
      </div>
    {:else if awaitingContinue}
      <div class="buttons continue">
        <button class="btn primary" onclick={() => onContinue?.()}>{t('nextHand')}</button>
      </div>
    {:else}
      <div class="waiting">
        {#if thinkingName}<span class="pulse"></span>{t('waiting', { name: thinkingName })}{/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .dock {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 6px;
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

  /* floats above the dock so the table does not move when it opens */
  .raise-panel {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 100%;
    z-index: 20;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 12px calc(12px + var(--safe-r)) 10px calc(12px + var(--safe-l));
    background: var(--panel-solid);
    border-top: 1px solid var(--line);
    box-shadow: 0 -10px 30px rgba(0, 0, 0, 0.25);
  }
  .raise-panel > .row {
    width: min(560px, 100%);
  }
  .my-cards {
    flex: none;
    display: flex;
    gap: 3px;
    margin-right: 4px;
  }
  /* wide screens (iPad, desktop): one compact row */
  @media (min-width: 900px) {
    .raise-panel {
      flex-direction: row;
      justify-content: center;
      padding-top: 10px;
    }
    .raise-panel > .row {
      width: auto;
    }
    .raise-panel > .presets {
      flex: none;
    }
    .raise-panel > .slider-row {
      flex: 1;
      max-width: 560px;
    }
  }
  /* constant heights, whatever is shown */
  .status-line {
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    font-size: 0.8rem;
    color: var(--text-3);
    white-space: nowrap;
    overflow: hidden;
  }
  .row-main {
    height: 54px;
    width: 100%;
  }
  .row-main > .buttons,
  .row-main > .waiting {
    height: 100%;
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
    background: color-mix(in srgb, var(--raise) 18%, transparent);
    color: var(--raise);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--raise) 50%, transparent);
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
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.4), 0 0 0 1px var(--line-2);
  }
  input[type='range']::-moz-range-thumb {
    width: 28px;
    height: 28px;
    border: 0;
    border-radius: 50%;
    background: #fff;
  }

  .notice {
    color: var(--gold);
    font-weight: 600;
  }
  .pre-btn {
    position: relative;
    min-height: 54px;
    padding: 0 4px;
    border-radius: 14px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    line-height: 1.1;
    font-size: 0.86rem;
    font-weight: 650;
    color: var(--text-2);
    background: transparent;
    box-shadow: inset 0 0 0 1.5px var(--line-2);
    transition:
      background-color 0.2s,
      color 0.2s,
      box-shadow 0.2s,
      transform 0.12s var(--ease);
  }
  .pre-btn:active:not(:disabled) {
    transform: scale(0.97);
  }
  .pre-btn:disabled {
    opacity: 0.35;
  }
  .pre-btn.on::after {
    content: '✓';
    position: absolute;
    top: 3px;
    right: 7px;
    font-size: 0.7rem;
  }
  .pre-btn.fold.on {
    background: var(--panel-3);
    color: var(--text);
    box-shadow: inset 0 0 0 1.5px var(--text-2);
  }
  .pre-btn.call.on {
    background: color-mix(in srgb, var(--accent) 16%, transparent);
    color: var(--accent);
    box-shadow: inset 0 0 0 1.5px var(--accent);
  }
  .pre-btn.raise.on {
    background: color-mix(in srgb, var(--raise) 18%, transparent);
    color: var(--raise);
    box-shadow: inset 0 0 0 1.5px var(--raise);
  }

  .amount-input {
    flex: none;
    width: 92px;
    height: 40px;
    padding: 0 10px;
    border: 0;
    border-radius: 12px;
    background: var(--panel-2);
    box-shadow: inset 0 0 0 1px var(--line-2);
    text-align: right;
    font-size: 1rem;
    font-weight: 700;
    user-select: text;
    -webkit-user-select: text;
  }
  .amount-input:focus {
    outline: none;
    box-shadow: inset 0 0 0 2px var(--raise);
  }

  .buttons.continue {
    grid-template-columns: 1fr;
  }

  .waiting {
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
    .row-main,
    .status-line {
      width: min(560px, 100%);
    }
  }
</style>
