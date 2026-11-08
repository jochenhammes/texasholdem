<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { fly } from 'svelte/transition';
  import type { GameController, GameSnapshot } from '../game/types';
  import { HERO_ID } from '../game/localController';
  import { settings } from '../game/settings.svelte';
  import { chips, t } from '../i18n/index.svelte';
  import { play, setSoundEnabled, unlockAudio } from './sound';
  import Table from './components/Table.svelte';
  import CleanTable from './components/CleanTable.svelte';
  import ActionBar from './components/ActionBar.svelte';
  import Sheet from './components/Sheet.svelte';
  import SettingsPanel from './components/SettingsPanel.svelte';
  import LogList from './components/LogList.svelte';
  import type { PlayerAction } from '../engine/types';
  import { isStillValid, resolvePreAction, type PreAction, type QueuedPreAction } from '../game/preAction';

  let {
    controller,
    onExit,
  }: { controller: GameController; onExit: (reason: 'lobby' | 'quit' | 'new') => void } = $props();

  let snap = $state<GameSnapshot | null>(null);
  let sheet = $state<'menu' | 'log' | 'settings' | null>(null);
  let toast = $state<string | null>(null);
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  let lastEvents: unknown = null;
  let lastToAct: string | null = null;

  $effect(() => setSoundEnabled(settings.sound));

  // ── pre-selected actions ──
  let queued = $state<QueuedPreAction | null>(null);
  let preNotice = $state<string | null>(null);
  let preNoticeTimer: ReturnType<typeof setTimeout> | undefined;
  let preTimer: ReturnType<typeof setTimeout> | undefined;

  function setPreAction(a: PreAction | null) {
    unlockAudio();
    preNotice = null;
    queued = a && snap ? { action: a, hand: snap.view.handNumber, street: snap.view.street } : null;
  }

  function cancelPre(withNotice: boolean) {
    queued = null;
    if (withNotice) {
      preNotice = t('preCancelled');
      clearTimeout(preNoticeTimer);
      preNoticeTimer = setTimeout(() => (preNotice = null), 3000);
    }
  }

  /** Returns true if a queued pre-action was fired for this snapshot. */
  function handlePreAction(s: GameSnapshot): boolean {
    if (!queued) return false;
    const v = s.view;
    if (!isStillValid(queued, v, HERO_ID)) {
      // a changed bet on the same street is worth telling; a new street/hand is not
      cancelPre(queued.hand === v.handNumber && queued.street === v.street && v.phase === 'betting');
      return false;
    }
    if (!v.legal) return false;
    const action = resolvePreAction(queued.action, v.legal);
    queued = null;
    if (!action) {
      cancelPre(true);
      return false;
    }
    // short pause so you can see your turn coming; skipped if anything changes meanwhile
    const seq = v.seq;
    clearTimeout(preTimer);
    preTimer = setTimeout(() => {
      if (snap?.view.seq === seq && snap.view.toActId === HERO_ID) controller.act(action);
    }, 260);
    return true;
  }

  $effect(() =>
    untrack(() =>
      controller.subscribe((s) => {
        snap = s;
        if (s.events !== lastEvents) {
          lastEvents = s.events;
          react(s);
        }
        const fired = handlePreAction(s);
        if (!fired && s.view.toActId === HERO_ID && lastToAct !== HERO_ID) play('turn');
        lastToAct = s.view.toActId;
      }),
    ),
  );
  onDestroy(() => {
    clearTimeout(preTimer);
    clearTimeout(preNoticeTimer);
  });
  onDestroy(() => clearTimeout(toastTimer));

  function react(s: GameSnapshot) {
    for (const e of s.events) {
      switch (e.type) {
        case 'dealHole':
        case 'board':
          play('deal');
          break;
        case 'action':
          play(e.action.type === 'fold' ? 'fold' : e.action.type === 'check' ? 'check' : e.action.type === 'allin' ? 'allin' : 'chip');
          break;
        case 'potAwarded':
          play(e.winners.some((w) => w.playerId === HERO_ID) ? 'win' : 'chip');
          break;
        case 'levelUp':
          showToast(t('levelUp', { sb: chips(e.level.sb), bb: chips(e.level.bb) }));
          break;
      }
    }
  }

  // switching the mode off while the table waits simply continues
  $effect(() => {
    if (!settings.pauseAtShowdown && snap?.awaitingContinue) controller.continueAfterShowdown();
  });

  /** Enter or space continues after a paused showdown (desktop). */
  function onKey(e: KeyboardEvent) {
    if (!snap?.awaitingContinue || sheet) return;
    if (e.key === 'Enter' || e.key === ' ') {
      const target = e.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' || target?.tagName === 'BUTTON') return;
      e.preventDefault();
      controller.continueAfterShowdown();
    }
  }

  function showToast(msg: string) {
    toast = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = null), 2600);
  }

  function act(a: PlayerAction) {
    unlockAudio();
    queued = null;
    clearTimeout(preTimer);
    controller.act(a);
  }

  function openSheet(s: 'menu' | 'log' | 'settings') {
    unlockAudio();
    sheet = s;
    if (s === 'menu') controller.setPaused(true);
  }
  function closeSheet() {
    sheet = null;
    controller.setPaused(false);
  }

  const view = $derived(snap?.view);
  const thinkingName = $derived(snap?.thinkingId ? (view?.players.find((p) => p.id === snap!.thinkingId)?.name ?? null) : null);
  const total = $derived(view?.players.length ?? 0);
  const heroPlace = $derived(view?.placements.find((p) => p.playerId === HERO_ID)?.place ?? null);
  const showResult = $derived(!!snap && ((snap.heroEliminated && !snap.spectating) || view?.phase === 'tournamentComplete'));
  const standings = $derived(
    view
      ? [...view.placements]
          .sort((a, b) => a.place - b.place)
          .map((p) => ({ ...p, name: p.playerId === HERO_ID ? t('you') : (view.players.find((x) => x.id === p.playerId)?.name ?? '') }))
      : [],
  );
  const winnerName = $derived(standings.find((s) => s.place === 1)?.name ?? '');
</script>

<svelte:document onpointerdown={unlockAudio} />
<svelte:window onkeydown={onKey} />

{#if snap && view}
  <div class="game">
    <header class="bar">
      <button class="icon-btn" aria-label={t('menu')} onclick={() => openSheet('menu')}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
      </button>
      <div class="level">
        <div class="blinds num">
          <span class="lv">{t('level', { n: view.levelIndex + 1 })}</span>
          <span>{chips(view.level.sb)}/{chips(view.level.bb)}</span>
          {#if view.level.ante}<span class="ante">{t('ante', { n: chips(view.level.ante) })}</span>{/if}
        </div>
        {#if view.nextLevel}
          <div class="next">
            {t('nextLevelIn', { n: view.handsUntilNextLevel + 1, hands: view.handsUntilNextLevel === 0 ? t('hand_one') : t('hand_other') })}
          </div>
        {/if}
      </div>
      <button class="icon-btn" aria-label={t('log')} onclick={() => openSheet('log')}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
          ><path d="M12 8v4l2.5 2.5" /><path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" /><path d="M3 4v4h4" /></svg
        >
      </button>
    </header>

    <main class="stage">
      {#if settings.theme === 'clean'}
        <CleanTable {snap} />
      {:else}
        <Table {snap} />
      {/if}
      {#if toast}
        <div class="toast" transition:fly={{ y: -16, duration: 220 }}>{toast}</div>
      {/if}
    </main>

    <ActionBar
      {view}
      heroId={HERO_ID}
      {thinkingName}
      {queued}
      notice={preNotice}
      onAct={act}
      onPreAction={setPreAction}
      awaitingContinue={snap.awaitingContinue}
      onContinue={() => controller.continueAfterShowdown()}
    />
  </div>

  {#if sheet === 'menu'}
    <Sheet title={t('menu')} onClose={closeSheet}>
      <div class="menu">
        <button class="btn primary block" onclick={closeSheet}>{t('continue')}</button>
        <button class="btn block" onclick={() => (sheet = 'settings')}>{t('settings')}</button>
        <button class="btn block" onclick={() => (sheet = 'log')}>{t('log')}</button>
        <button class="btn ghost block" onclick={() => onExit('lobby')}>{t('saveAndExit')}</button>
        <button class="btn danger block" onclick={() => confirm(t('quitConfirm')) && onExit('quit')}>{t('quit')}</button>
      </div>
    </Sheet>
  {:else if sheet === 'settings'}
    <Sheet title={t('settings')} onClose={closeSheet}>
      <SettingsPanel />
      <button class="btn block done" onclick={closeSheet}>{t('done')}</button>
    </Sheet>
  {:else if sheet === 'log'}
    <Sheet title={t('log')} onClose={closeSheet}>
      <LogList log={snap.log} {view} />
    </Sheet>
  {/if}

  {#if showResult}
    <Sheet dismissable={false}>
      <div class="result">
        {#if heroPlace === 1}
          <div class="trophy" aria-hidden="true">🏆</div>
          <h2>{t('victoryTitle')}</h2>
          <p>{t('victoryText')}</p>
        {:else if heroPlace}
          <div class="place-big num">#{heroPlace}</div>
          <h2>{view.phase === 'tournamentComplete' ? t('tournamentOver') : t('eliminatedTitle')}</h2>
          <p>{t('eliminatedText', { place: heroPlace, total })}</p>
          {#if view.phase === 'tournamentComplete'}<p class="muted">{t('tournamentOverText', { name: winnerName })}</p>{/if}
        {/if}

        {#if standings.length}
          <ol class="standings">
            {#each standings as s (s.playerId)}
              <li class:me={s.playerId === HERO_ID}><span class="num">{s.place}.</span> {s.name}</li>
            {/each}
          </ol>
        {/if}

        <div class="result-actions">
          {#if view.phase !== 'tournamentComplete'}
            <button class="btn ghost block" onclick={() => controller.spectate()}>{t('watchOn')}</button>
          {/if}
          <button class="btn primary block" onclick={() => onExit('new')}>{t('playAgain')}</button>
          <button class="btn block" onclick={() => onExit('quit')}>{t('backToLobby')}</button>
        </div>
      </div>
    </Sheet>
  {/if}
{/if}

<style>
  .game {
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: calc(8px + var(--safe-t)) calc(12px + var(--safe-r)) 8px calc(12px + var(--safe-l));
  }
  .level {
    text-align: center;
    line-height: 1.2;
    min-width: 0;
  }
  .blinds {
    display: flex;
    gap: 8px;
    justify-content: center;
    align-items: baseline;
    font-weight: 700;
    font-size: 0.95rem;
  }
  .lv {
    color: var(--text-3);
    font-weight: 600;
    font-size: 0.8rem;
  }
  .ante {
    color: var(--text-2);
    font-weight: 600;
    font-size: 0.8rem;
  }
  .next {
    font-size: 0.72rem;
    color: var(--text-3);
  }
  .stage {
    position: relative;
    flex: 1;
    min-height: 0;
  }
  .toast {
    position: absolute;
    top: 6px;
    left: 50%;
    translate: -50% 0;
    padding: 8px 16px;
    border-radius: 999px;
    background: var(--accent);
    color: var(--accent-ink);
    font-weight: 700;
    font-size: 0.88rem;
    z-index: 10;
    white-space: nowrap;
    box-shadow: var(--shadow);
  }
  .menu {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .done {
    margin-top: 18px;
  }
  .result {
    text-align: center;
    padding-top: 12px;
  }
  .result h2 {
    margin: 6px 0 4px;
    font-size: 1.5rem;
  }
  .result p {
    margin: 0 0 6px;
    color: var(--text-2);
  }
  .result .muted {
    color: var(--text-3);
    font-size: 0.9rem;
  }
  .trophy {
    font-size: 3rem;
  }
  .place-big {
    font-size: 3rem;
    font-weight: 800;
    color: var(--gold);
    line-height: 1;
  }
  .standings {
    list-style: none;
    margin: 16px auto;
    padding: 0;
    max-width: 260px;
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .standings li {
    padding: 6px 12px;
    border-radius: 10px;
    color: var(--text-2);
  }
  .standings li.me {
    background: var(--panel-2);
    color: var(--text);
    font-weight: 650;
  }
  .result-actions {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 8px;
  }

  /* Landscape phones: action dock moves to the side to give the table height. */
  @media (orientation: landscape) and (max-height: 500px) {
    .game {
      display: grid;
      grid-template-columns: 1fr min(280px, 34vw);
      grid-template-rows: auto 1fr;
    }
    .bar {
      grid-column: 1 / -1;
      padding-top: calc(4px + var(--safe-t));
      padding-bottom: 0;
    }
    .game > :global(.dock) {
      grid-column: 2;
      grid-row: 2;
      justify-content: flex-end;
      border-top: 0;
      border-left: 1px solid var(--line);
    }
    .game > :global(.dock .buttons) {
      grid-template-columns: 1fr;
    }
    .game > :global(.dock .buttons .btn) {
      min-height: 46px;
    }
    .game > :global(.dock .presets) {
      flex-wrap: wrap;
    }
    .game > :global(.dock .buttons.pre) {
      grid-template-columns: 1fr 1fr;
    }
    /* side dock: heights are fixed by the column, so content may flow */
    .game > :global(.dock .row-main) {
      height: auto;
    }
    /* the side column never grows the page, it scrolls internally if needed */
    .game > :global(.dock) {
      min-height: 0;
      overflow-y: auto;
    }
    .game > :global(.dock .raise-panel) {
      position: static;
      padding: 0;
      background: none;
      border: 0;
      box-shadow: none;
    }
  }
</style>
