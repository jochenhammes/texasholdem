<script lang="ts">
  import type { LanConnection } from '../game/lan/client';
  import type { LanMessage } from '../game/lan/protocol';
  import { storage } from '../game/storage';
  import { chips, t } from '../i18n/index.svelte';
  import { makeCard } from '../engine/cards';
  import PlayingCard from './components/PlayingCard.svelte';
  import Sheet from './components/Sheet.svelte';
  import SettingsPanel from './components/SettingsPanel.svelte';
  import ViewPicker from './components/ViewPicker.svelte';

  let {
    msg,
    conn,
    onWatch,
  }: {
    msg: LanMessage;
    conn: LanConnection;
    /** Show the running table (as player back at the seat, or as spectator). */
    onWatch: () => void;
  } = $props();

  let name = $state(storage.loadSetup()?.playerName ?? '');
  let busy = $state(false);
  let error = $state<string | null>(null);
  let showSettings = $state(false);

  const admin = $derived(msg.members.find((m) => m.isAdmin));
  const adminName = $derived(admin?.name || t('admin'));
  const playing = $derived(msg.phase === 'playing');
  const finished = $derived(msg.game?.view.phase === 'tournamentComplete');
  const full = $derived(!msg.you.member && msg.members.length >= 8);
  const setup = $derived(msg.setup);
  const seats = $derived(setup ? Math.max(setup.totalPlayers, msg.members.length) : msg.members.length);

  async function join() {
    const clean = name.trim();
    if (!clean) return;
    busy = true;
    error = null;
    const prev = storage.loadSetup();
    if (prev) storage.saveSetup({ ...prev, playerName: clean });
    const r = await conn.send({ cmd: 'join', name: clean });
    busy = false;
    if (!r.ok) error = r.error === 'full' ? t('tableFull') : t('connectionFailed');
  }

  function leave() {
    void conn.send({ cmd: 'leave' });
  }
</script>

<div class="room">
  <div class="inner">
    <header class="top">
      <div class="brand">
        <div class="logo" aria-hidden="true">
          <PlayingCard card={makeCard(12, 3)} size="sm" />
          <PlayingCard card={makeCard(11, 2)} size="sm" />
        </div>
        <div>
          <h1>{t('appName')}</h1>
          <p class="tag">{t('lanTournament')}</p>
        </div>
      </div>
      <button class="icon-btn" aria-label={t('settings')} onclick={() => (showSettings = true)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
          ><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></svg
        >
      </button>
    </header>

    <section class="card-surface panel">
      {#if msg.adminAway && !msg.you.isAdmin}
        <p class="error">{t('adminAway', { s: Math.ceil(msg.adminAway.resetInMs / 1000) })}</p>
      {/if}
      {#if !msg.you.member}
        <!-- not signed up yet -->
        {#if playing}
          <h2>{t('lanRunning')}</h2>
          <p class="hint">{t('lanRunningHint')}</p>
        {:else}
          <h2>{t('lanJoinTitle')}</h2>
          <p class="hint">{t('lanSetsUp', { name: adminName })}</p>
        {/if}
        {#if full}
          <p class="error">{t('tableFull')}</p>
        {:else}
          <label class="field">
            <span class="label">{t('yourName')}</span>
            <input
              type="text"
              bind:value={name}
              maxlength="14"
              placeholder={t('namePlaceholder')}
              autocomplete="nickname"
              onkeydown={(e) => e.key === 'Enter' && join()}
            />
          </label>
          <button class="btn primary block" disabled={busy || !name.trim()} onclick={join}>
            {playing ? t('lanJoinNext') : t('joinTable')}
          </button>
        {/if}
        {#if error}<p class="error">{error}</p>{/if}
        {#if playing}
          <button class="btn ghost block" onclick={onWatch}>{t('lanWatch')}</button>
        {/if}
      {:else if playing}
        <!-- signed up while a tournament runs, or stepped away from the table -->
        {#if msg.you.seated && !finished}
          <h2>{t('lanAway')}</h2>
          <p class="hint">{t('lanAwayHint')}</p>
          <button class="btn primary block" onclick={onWatch}>{t('lanBackToTable')}</button>
        {:else}
          <h2>{finished ? t('tournamentOver') : t('lanRunning')}</h2>
          <p class="hint">{finished ? t('lanWaitNew', { name: adminName }) : t('lanNextOne')}</p>
          <button class="btn ghost block" onclick={onWatch}>{t('lanWatch')}</button>
        {/if}
      {:else}
        <!-- foyer: waiting for the admin -->
        <h2 class="waiting"><span class="pulse"></span>{t('waitingFor', { name: adminName })}</h2>
        <p class="hint">{t('lanWaitHint')}</p>
        {#if setup}
          <p class="summary num">
            {t('playersValue', { n: seats })} · {t(`diff_${setup.difficulty}`)} · {chips(setup.startingStack)} ·
            {setup.turnTimeSec ? t('secondsShort', { n: setup.turnTimeSec }) : t('timeLimitOff')}
          </p>
        {/if}
      {/if}

      {#if msg.members.length}
        <ul class="members">
          {#each msg.members as m (m.id)}
            <li class:off={!m.online} class:me={m.id === msg.you.id}>
              <span class="dot-online" aria-hidden="true"></span>
              <span>{m.id === msg.you.id ? `${m.name || t('you')} (${t('you')})` : m.name || t('admin')}</span>
              {#if m.isAdmin}<span class="tag-admin">{t('admin')}</span>{/if}
            </li>
          {/each}
        </ul>
        {#if !playing && setup}
          <p class="hint small">{t('seatsInfo', { humans: Math.min(seats, msg.members.length), bots: Math.max(0, seats - msg.members.length) })}</p>
        {/if}
      {/if}

      {#if msg.you.member && !playing}
        <button class="btn ghost block" onclick={leave}>{t('lanLeave')}</button>
      {/if}
    </section>

    <!-- every player chooses the table view for their own device -->
    <section class="card-surface panel">
      <span class="label">{t('view')}</span>
      <ViewPicker />
    </section>
  </div>
</div>

{#if showSettings}
  <Sheet title={t('settings')} onClose={() => (showSettings = false)}>
    <SettingsPanel sharedTable />
    <button class="btn block done" onclick={() => (showSettings = false)}>{t('done')}</button>
  </Sheet>
{/if}

<style>
  .room {
    height: 100%;
    overflow-y: auto;
    background:
      radial-gradient(80% 50% at 50% -10%, var(--glow-1), transparent 70%),
      radial-gradient(60% 40% at 100% 0%, var(--glow-2), transparent 70%),
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
  .panel {
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  h2 {
    margin: 0;
    font-size: 1.2rem;
  }
  .waiting {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .pulse {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--accent);
    animation: pulse 1.4s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.3;
    }
  }
  .hint {
    margin: 0;
    color: var(--text-2);
    font-size: 0.9rem;
  }
  .hint.small {
    font-size: 0.8rem;
    color: var(--text-3);
  }
  .summary {
    margin: 0;
    font-weight: 650;
  }
  .error {
    margin: 0;
    color: var(--danger);
    font-size: 0.9rem;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 8px;
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
  .members {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .members li {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border-radius: 999px;
    background: var(--panel-2);
    font-size: 0.9rem;
    font-weight: 600;
  }
  .members li.me {
    box-shadow: inset 0 0 0 1px var(--raise);
  }
  .members li.off {
    opacity: 0.5;
  }
  .dot-online {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent);
  }
  .members li.off .dot-online {
    background: var(--text-3);
  }
  .tag-admin {
    font-size: 0.7rem;
    padding: 1px 6px;
    border-radius: 6px;
    background: var(--panel-3);
    color: var(--text-2);
  }
  .done {
    margin-top: 12px;
  }
</style>
