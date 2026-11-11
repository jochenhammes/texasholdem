<script lang="ts">
  import { onDestroy } from 'svelte';
  import { connectFirebase } from '../game/mp/firebase';
  import { GuestController } from '../game/mp/guestController';
  import { HostController, hostSaves, newMultiplayerGame } from '../game/mp/hostController';
  import { createRoom, inviteLink, joinRoom, parseSetup, paths, watchRoom, type RoomState } from '../game/mp/room';
  import type { Transport, Unsubscribe } from '../game/mp/transport';
  import { storage } from '../game/storage';
  import type { GameController, GameSetup } from '../game/types';
  import { t } from '../i18n/index.svelte';

  let {
    mode,
    onGame,
    onLeave,
    speed,
  }: {
    mode: { kind: 'create'; setup: GameSetup } | { kind: 'join'; code: string };
    onGame: (c: GameController) => void;
    onLeave: () => void;
    speed: () => number;
  } = $props();

  let transport = $state<Transport | null>(null);
  let code = $state<string | null>(null);
  let room = $state<RoomState | null>(null);
  let error = $state<string | null>(null);
  let joined = $state(false);
  let busy = $state(false);
  let copied = $state(false);
  let name = $state(storage.loadSetup()?.playerName ?? '');
  let unwatch: Unsubscribe | null = null;
  let unpresence: Unsubscribe | null = null;
  let guest: GuestController | null = null;
  let handedOver = false;

  const isHost = $derived(!!transport && !!room?.meta && room.meta.host === transport.uid);
  const setup = $derived(room?.meta ? parseSetup(room.meta) : null);
  const members = $derived(
    room
      ? Object.entries(room.members)
          .sort(([a, x], [b, y]) => (a === room!.meta?.host ? -1 : b === room!.meta?.host ? 1 : x.joinedAt - y.joinedAt))
          .map(([uid, m]) => ({ uid, ...m, online: !!room!.presence[uid] }))
      : [],
  );
  const seats = $derived(setup ? Math.max(2, setup.totalPlayers) : 0);
  const humans = $derived(Math.min(members.length, seats));
  const bots = $derived(Math.max(0, seats - humans));

  async function init() {
    try {
      transport = await connectFirebase();
    } catch (e) {
      console.warn(e);
      error = t('connectionFailed');
      return;
    }
    if (mode.kind === 'create') {
      busy = true;
      try {
        code = await createRoom(transport, mode.setup);
        history.replaceState(null, '', `#room=${code}`);
        joined = true;
        watch();
      } catch (e) {
        console.warn(e);
        error = t('connectionFailed');
      } finally {
        busy = false;
      }
    } else {
      code = mode.code;
      // host coming back after a reload → resume the running table
      const save = hostSaves.load();
      if (save && save.room === code && save.uid === transport.uid) {
        const meta = await transport.get<{ host: string; status: string }>(paths.meta(code)).catch(() => null);
        if (meta?.host === transport.uid && meta.status === 'playing') {
          handOver(new HostController(transport, code, save.data, { speed }));
          return;
        }
      }
      // returning member (same browser) → straight back to the table
      const meta = await transport.get<{ host: string; status: string }>(paths.meta(code)).catch(() => null);
      if (!meta) {
        error = t('roomNotFound');
        return;
      }
      if (meta.host === transport.uid) {
        joined = true;
        watch();
        return;
      }
      const isMember = (await transport.get(paths.member(code, transport.uid)).catch(() => null)) !== null;
      if (isMember) await join();
    }
  }

  async function join() {
    if (!transport || !code) return;
    busy = true;
    const res = await joinRoom(transport, code, name.trim() || t('namePlaceholder'));
    busy = false;
    if (res === 'notFound') error = t('roomNotFound');
    else if (res === 'started') error = t('roomStarted');
    else if (res === 'closed') error = t('roomClosed');
    else {
      joined = true;
      const s = storage.loadSetup();
      if (name.trim()) storage.saveSetup({ ...(s ?? { totalPlayers: 6, difficulty: 'medium', startingStack: 1500, blindSpeed: 'normal' }), playerName: name.trim() });
      watch();
    }
  }

  function watch() {
    if (!transport || !code) return;
    unpresence ??= transport.presence(paths.presenceOf(code, transport.uid));
    unwatch ??= watchRoom(transport, code, (s) => {
      room = s;
      if (!s.meta) {
        if (!handedOver) error = t('roomClosed');
        return;
      }
      if (s.meta.status === 'closed') error = t('roomClosed');
      // guests: once the host started, wait for our personal view
      if (s.meta.status === 'playing' && !isHost && !guest && transport) {
        guest = new GuestController(transport, code!, s.meta.host, () => handOver(guest!));
        setTimeout(() => {
          if (!handedOver && guest) error = t('tableFull');
        }, 8000);
      }
    });
  }

  function handOver(c: GameController) {
    if (handedOver) return;
    handedOver = true;
    cleanup(false);
    onGame(c);
  }

  async function start() {
    if (!transport || !code || !room?.meta || !setup) return;
    busy = true;
    const data = newMultiplayerGame(setup, transport.uid, room.members);
    handOver(new HostController(transport, code, data, { speed }));
  }

  async function invite() {
    if (!code) return;
    const url = inviteLink(code);
    const text = t('inviteText', { code });
    try {
      if (navigator.share) {
        await navigator.share({ title: "Hold'em", text, url });
        return;
      }
    } catch {
      /* cancelled → fall back to copying */
    }
    await copy();
  }

  async function copy() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(inviteLink(code));
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch {
      prompt(t('copyLink'), inviteLink(code));
    }
  }

  async function leave() {
    if (transport && code && !handedOver) {
      if (isHost) await transport.remove(paths.room(code)).catch(() => {});
      else if (joined && room?.meta?.status === 'lobby') await transport.remove(paths.member(code, transport.uid)).catch(() => {});
    }
    cleanup(true);
    history.replaceState(null, '', location.pathname);
    onLeave();
  }

  function cleanup(disposeGuest: boolean) {
    unwatch?.();
    unwatch = null;
    if (disposeGuest) {
      unpresence?.();
      guest?.dispose();
    }
    unpresence = null;
  }

  onDestroy(() => {
    if (!handedOver) cleanup(true);
  });

  void init();
</script>

<div class="room">
  <div class="inner">
    <header class="top">
      <button class="icon-btn" aria-label={t('back')} onclick={leave}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
      </button>
      <h1>{t('privateTable')}</h1>
      <span class="spacer"></span>
    </header>

    {#if error}
      <section class="card msg">
        <p>{error}</p>
        <button class="btn primary block" onclick={leave}>{t('backToLobby')}</button>
      </section>
    {:else if !transport || (busy && !code)}
      <section class="card msg"><p class="muted">{t('connecting')}</p></section>
    {:else if !joined}
      <section class="card">
        <div class="code-block">
          <span class="label">{t('roomCode')}</span>
          <span class="code num">{code}</span>
        </div>
        <label class="field">
          <span class="label">{t('yourName')}</span>
          <input type="text" bind:value={name} maxlength="14" placeholder={t('namePlaceholder')} autocomplete="nickname" />
        </label>
        <button class="btn primary block" disabled={busy} onclick={join}>{t('joinTable')}</button>
      </section>
    {:else}
      <section class="card">
        <div class="code-block">
          <span class="label">{t('roomCode')}</span>
          <span class="code num">{code}</span>
        </div>
        <div class="row">
          <button class="btn primary grow" onclick={invite}>{t('invite')}</button>
          <button class="btn grow" onclick={copy}>{copied ? t('linkCopied') : t('copyLink')}</button>
        </div>
      </section>

      <section class="card">
        <div class="list-head">
          <span class="label">{t('players')}</span>
          {#if setup}<span class="muted small">{t('seatsInfo', { humans, bots })}</span>{/if}
        </div>
        <ul class="members">
          {#each members as m, i (m.uid)}
            <li class:extra={i >= seats}>
              <span class="dot" class:on={m.online}></span>
              <span class="name">{m.name}</span>
              {#if m.uid === room?.meta?.host}<span class="tag">{t('hostTag')}</span>{/if}
              {#if m.uid === transport.uid}<span class="tag you">{t('you')}</span>{/if}
            </li>
          {/each}
        </ul>
        {#if isHost}
          <button class="btn primary block start" disabled={busy} onclick={start}>{t('startGame')}</button>
          <p class="muted small center">{t('startHint')}</p>
        {:else}
          <p class="muted center wait"><span class="pulse"></span>{t('waitingForHost')}</p>
        {/if}
      </section>
    {/if}
  </div>
</div>

<style>
  .room {
    height: 100%;
    overflow-y: auto;
    background: var(--bg);
  }
  .inner {
    width: min(520px, 100%);
    margin: 0 auto;
    padding: calc(16px + var(--safe-t)) calc(16px + var(--safe-r)) calc(24px + var(--safe-b)) calc(16px + var(--safe-l));
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .top {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  h1 {
    margin: 0;
    font-size: 1.3rem;
  }
  .spacer {
    flex: 1;
  }
  .card {
    background: var(--bg-elev);
    border-radius: 22px;
    box-shadow: inset 0 0 0 1px var(--line);
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .msg p {
    margin: 0;
  }
  .code-block {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }
  .code {
    font-size: 2.2rem;
    font-weight: 800;
    letter-spacing: 0.18em;
    user-select: text;
    -webkit-user-select: text;
  }
  .row {
    display: flex;
    gap: 8px;
  }
  .grow {
    flex: 1;
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
  .list-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  .members {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .members li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border-radius: 12px;
    background: var(--panel-2);
  }
  .members li.extra {
    opacity: 0.45;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--text-3);
  }
  .dot.on {
    background: var(--accent);
  }
  .name {
    font-weight: 600;
  }
  .tag {
    font-size: 0.7rem;
    font-weight: 700;
    padding: 1px 7px;
    border-radius: 999px;
    color: var(--text-2);
    box-shadow: inset 0 0 0 1px var(--line-2);
  }
  .tag.you {
    color: var(--accent);
  }
  .muted {
    color: var(--text-3);
  }
  .small {
    font-size: 0.82rem;
  }
  .center {
    text-align: center;
    margin: 0;
  }
  .start {
    min-height: 54px;
  }
  .wait {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
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
</style>
