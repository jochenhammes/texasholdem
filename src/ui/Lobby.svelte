<script lang="ts">
  import type { Difficulty } from '../ai/profiles';
  import { HANDS_PER_LEVEL, STARTING_STACKS, type BlindSpeed } from '../engine/tournament';
  import { storage, type SavedGame } from '../game/storage';
  import type { GameSetup } from '../game/types';
  import { chips, t } from '../i18n/index.svelte';
  import Segmented from './components/Segmented.svelte';
  import Sheet from './components/Sheet.svelte';
  import SettingsPanel from './components/SettingsPanel.svelte';
  import PlayingCard from './components/PlayingCard.svelte';
  import { makeCard } from '../engine/cards';

  let {
    saved,
    onStart,
    onResume,
  }: { saved: SavedGame | null; onStart: (s: GameSetup) => void; onResume: () => void } = $props();

  const last = storage.loadSetup();
  let name = $state(last?.playerName ?? '');
  let totalPlayers = $state(last?.totalPlayers ?? 6);
  let difficulty = $state<Difficulty>(last?.difficulty ?? 'medium');
  let startingStack = $state(last?.startingStack ?? 1500);
  let blindSpeed = $state<BlindSpeed>(last?.blindSpeed ?? 'normal');
  let showSettings = $state(false);
  const stats = storage.loadStats();

  function start() {
    const setup: GameSetup = { playerName: name.trim(), totalPlayers, difficulty, startingStack, blindSpeed };
    storage.saveSetup(setup);
    onStart(setup);
  }

  const savedInfo = $derived.by(() => {
    if (!saved) return null;
    const s = saved.state;
    return t('resumeHint', {
      hand: s.handNumber,
      level: s.levelIndex + 1,
      players: s.players.filter((p) => !p.eliminated).length,
    });
  });
</script>

<div class="lobby">
  <div class="inner">
    <header class="top">
      <div class="brand">
        <div class="logo" aria-hidden="true">
          <PlayingCard card={makeCard(12, 3)} size="sm" />
          <PlayingCard card={makeCard(11, 2)} size="sm" />
        </div>
        <div>
          <h1>{t('appName')}</h1>
          <p class="tag">{t('tagline')}</p>
        </div>
      </div>
      <button class="icon-btn" aria-label={t('settings')} onclick={() => (showSettings = true)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
          ><circle cx="12" cy="12" r="3" /><path
            d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"
          /></svg
        >
      </button>
    </header>

    {#if saved}
      <button class="resume card-surface" onclick={onResume}>
        <span class="resume-text">
          <span class="resume-title">{t('resume')}</span>
          <span class="resume-sub">{savedInfo}</span>
        </span>
        <span class="arrow" aria-hidden="true">→</span>
      </button>
    {/if}

    <section class="card-surface setup">
      <h2>{t('newTournament')}</h2>

      <label class="field">
        <span class="label">{t('yourName')}</span>
        <input type="text" bind:value={name} maxlength="14" placeholder={t('namePlaceholder')} autocomplete="nickname" />
      </label>

      <div class="field">
        <span class="label">{t('players')}</span>
        <div class="stepper">
          <button class="icon-btn" aria-label="-" disabled={totalPlayers <= 2} onclick={() => totalPlayers--}>−</button>
          <div class="seats" aria-live="polite">
            <div class="dots">
              {#each Array(8) as _, i (i)}
                <span class="dot" class:on={i < totalPlayers} class:me={i === 0}></span>
              {/each}
            </div>
            <span class="count">{t('playersValue', { n: totalPlayers })}</span>
          </div>
          <button class="icon-btn" aria-label="+" disabled={totalPlayers >= 8} onclick={() => totalPlayers++}>+</button>
        </div>
      </div>

      <div class="field">
        <span class="label">{t('difficulty')}</span>
        <Segmented
          options={[
            { value: 'easy', label: t('diff_easy') },
            { value: 'medium', label: t('diff_medium') },
            { value: 'hard', label: t('diff_hard') },
          ] as { value: Difficulty; label: string }[]}
          value={difficulty}
          onChange={(v) => (difficulty = v)}
        />
        <span class="hint">{t(`diffHint_${difficulty}`)}</span>
      </div>

      <div class="field">
        <span class="label">{t('startingStack')}</span>
        <Segmented
          options={STARTING_STACKS.map((s) => ({ value: s as number, label: chips(s) }))}
          value={startingStack}
          onChange={(v) => (startingStack = v)}
        />
      </div>

      <div class="field">
        <span class="label">{t('blindSpeed')}</span>
        <Segmented
          options={(['turbo', 'normal', 'slow'] as BlindSpeed[]).map((s) => ({
            value: s,
            label: t(`speed_${s}`),
            sub: t('speedHint', { n: HANDS_PER_LEVEL[s] }),
          }))}
          value={blindSpeed}
          onChange={(v) => (blindSpeed = v)}
        />
      </div>

      <button class="btn primary block start" onclick={start}>{t('start')}</button>
    </section>

    {#if stats.tournaments > 0 || stats.handsPlayed > 0}
      <section class="stats">
        <div><span class="v num">{stats.tournaments}</span><span class="k">{t('statTournaments')}</span></div>
        <div><span class="v num">{stats.wins}</span><span class="k">{t('statWins')}</span></div>
        <div><span class="v num">{stats.bestPlace ? `#${stats.bestPlace}` : '–'}</span><span class="k">{t('statBest')}</span></div>
        <div><span class="v num">{chips(stats.handsPlayed)}</span><span class="k">{t('statHands')}</span></div>
      </section>
    {/if}

    <details class="rules">
      <summary>{t('rulesTitle')}</summary>
      <p>{t('rules')}</p>
    </details>
  </div>
</div>

{#if showSettings}
  <Sheet title={t('settings')} onClose={() => (showSettings = false)}>
    <SettingsPanel />
    <button class="btn block done" onclick={() => (showSettings = false)}>{t('done')}</button>
  </Sheet>
{/if}

<style>
  .lobby {
    height: 100%;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    background:
      radial-gradient(80% 50% at 50% -10%, rgba(61, 220, 151, 0.14), transparent 70%),
      radial-gradient(60% 40% at 100% 0%, rgba(139, 147, 255, 0.12), transparent 70%),
      var(--bg);
  }
  .inner {
    width: min(520px, 100%);
    margin: 0 auto;
    padding: calc(20px + var(--safe-t)) calc(16px + var(--safe-r)) calc(28px + var(--safe-b)) calc(16px + var(--safe-l));
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .logo {
    display: flex;
  }
  .logo :global(.card:first-child) {
    transform: rotate(-10deg);
  }
  .logo :global(.card + .card) {
    margin-left: -14px;
    transform: rotate(8deg) translateY(2px);
  }
  h1 {
    margin: 0;
    font-size: 1.7rem;
    font-weight: 800;
    letter-spacing: -0.02em;
  }
  .tag {
    margin: 0;
    color: var(--text-3);
    font-size: 0.85rem;
  }
  .card-surface {
    background: var(--bg-elev);
    border-radius: 22px;
    box-shadow: inset 0 0 0 1px var(--line);
  }
  .resume {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 16px 18px;
    text-align: left;
    background: linear-gradient(120deg, rgba(61, 220, 151, 0.16), rgba(61, 220, 151, 0.05));
    box-shadow: inset 0 0 0 1px rgba(61, 220, 151, 0.35);
  }
  .resume-text {
    display: flex;
    flex-direction: column;
  }
  .resume-title {
    font-weight: 700;
    color: var(--accent);
  }
  .resume-sub {
    font-size: 0.85rem;
    color: var(--text-2);
  }
  .arrow {
    font-size: 1.3rem;
    color: var(--accent);
  }
  .setup {
    padding: 20px 18px;
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  h2 {
    margin: 0;
    font-size: 1.2rem;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .hint {
    font-size: 0.8rem;
    color: var(--text-3);
  }
  input[type='text'] {
    min-height: 48px;
    padding: 0 14px;
    border-radius: 14px;
    border: 0;
    background: var(--panel-2);
    box-shadow: inset 0 0 0 1px var(--line);
    font-size: 1rem;
    user-select: text;
    -webkit-user-select: text;
  }
  input[type='text']:focus {
    outline: none;
    box-shadow: inset 0 0 0 2px var(--raise);
  }
  .stepper {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .stepper .icon-btn {
    width: 48px;
    height: 48px;
    font-size: 1.4rem;
    flex: none;
  }
  .stepper .icon-btn:disabled {
    opacity: 0.3;
  }
  .seats {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }
  .dots {
    display: flex;
    gap: 6px;
  }
  .dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--panel-3);
    transition:
      background-color 0.2s,
      transform 0.2s;
  }
  .dot.on {
    background: var(--text-2);
  }
  .dot.me {
    background: var(--accent);
  }
  .count {
    font-weight: 650;
    font-size: 0.92rem;
  }
  .start {
    min-height: 56px;
    font-size: 1.05rem;
    margin-top: 4px;
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
  }
  .stats > div {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 12px 4px;
    border-radius: 16px;
    background: var(--bg-elev);
    box-shadow: inset 0 0 0 1px var(--line);
  }
  .v {
    font-weight: 750;
    font-size: 1.15rem;
  }
  .k {
    font-size: 0.7rem;
    color: var(--text-3);
    text-align: center;
  }
  .rules {
    color: var(--text-2);
    font-size: 0.9rem;
    padding: 0 4px;
  }
  .rules summary {
    cursor: pointer;
    font-weight: 600;
    color: var(--text-3);
  }
  .done {
    margin-top: 18px;
  }
</style>
