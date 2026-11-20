<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { LocalGameController, newGame } from './game/localController';
  import { detectLan, LanConnection } from './game/lan/client';
  import { LanController } from './game/lan/lanController';
  import type { LanMessage } from './game/lan/protocol';
  import { settings, SPEED_FACTOR } from './game/settings.svelte';
  import { storage, type SavedGame } from './game/storage';
  import type { GameController, GameSetup } from './game/types';
  import { i18n, t } from './i18n/index.svelte';
  import Game from './ui/Game.svelte';
  import LanRoom from './ui/LanRoom.svelte';
  import Lobby from './ui/Lobby.svelte';
  import { unlockAudio } from './ui/sound';

  // ───────────── single player (offline, e.g. GitHub Pages) ─────────────

  let controller = $state<GameController | null>(null);
  let saved = $state<SavedGame | null>(storage.loadGame());

  const pacing = { speed: () => SPEED_FACTOR[settings.animSpeed], holdAfterShowdown: () => settings.pauseAtShowdown };

  function start(setup: GameSetup) {
    unlockAudio();
    controller?.dispose();
    storage.clearGame();
    controller = new LocalGameController(newGame(setup), pacing);
  }

  function resume() {
    unlockAudio();
    const g = storage.loadGame();
    if (!g) return;
    controller = new LocalGameController(g, pacing);
  }

  function exit(reason: 'lobby' | 'quit' | 'new') {
    const c = controller;
    controller = null;
    c?.dispose();
    if (reason !== 'lobby') storage.clearGame();
    saved = storage.loadGame();
    if (reason === 'new') {
      const setup = storage.loadSetup();
      if (setup) start(setup);
    }
  }

  // ───────────── home network (served by `npm run preview`) ─────────────

  let mode = $state<'detect' | 'single' | 'lan'>('detect');
  let conn = $state<LanConnection | null>(null);
  let msg = $state<LanMessage | null>(null);
  /** Tournament number the player stepped away from / chose to watch. */
  let away = $state(-1);
  let watching = $state(-1);
  let lanCtl = $state<{ tournament: number; ctl: LanController } | null>(null);

  onMount(async () => {
    if (!(await detectLan())) {
      mode = 'single';
      return;
    }
    conn = new LanConnection();
    conn.onMessage((m) => (msg = m));
    conn.open();
    mode = 'lan';
  });
  onDestroy(() => {
    lanCtl?.ctl.dispose();
    conn?.close();
  });

  const showTable = $derived.by(() => {
    if (!msg?.game) return false;
    if (msg.you.seated) return away !== msg.tournament;
    return watching === msg.tournament;
  });

  // one controller per tournament; gone as soon as the foyer opens again
  $effect(() => {
    const m = msg;
    if (!m || !conn) return;
    if (m.phase === 'playing' && (!lanCtl || lanCtl.tournament !== m.tournament)) {
      lanCtl?.ctl.dispose();
      lanCtl = { tournament: m.tournament, ctl: new LanController(conn) };
    } else if (m.phase === 'lobby' && lanCtl) {
      lanCtl.ctl.dispose();
      lanCtl = null;
    }
  });

  function lanExit(reason: 'lobby' | 'quit' | 'new') {
    if (!msg || !conn) return;
    if (msg.you.isAdmin) {
      // admin: "close the table for everyone" or "new tournament" → back to the foyer
      void conn.send({ cmd: 'end' });
      return;
    }
    void reason;
    if (msg.you.seated) away = msg.tournament;
    else watching = -1;
  }

  function lanStart(setup: GameSetup) {
    unlockAudio();
    if (!conn) return;
    const c = conn;
    void c.send({ cmd: 'setup', setup }).then(() => c.send({ cmd: 'start' }));
  }

  $effect(() => {
    document.documentElement.lang = i18n.locale;
  });

  // "Clean" follows the system colour scheme (light/dark), live
  const darkQuery = window.matchMedia?.('(prefers-color-scheme: dark)');
  let systemDark = $state(darkQuery?.matches ?? false);
  $effect(() => {
    if (!darkQuery) return;
    const onChange = (e: MediaQueryListEvent) => (systemDark = e.matches);
    darkQuery.addEventListener('change', onChange);
    return () => darkQuery.removeEventListener('change', onChange);
  });

  // Design: data-theme on <html> switches the CSS tokens (see app.css)
  $effect(() => {
    const root = document.documentElement;
    if (settings.theme === 'clean') root.dataset.theme = 'clean';
    else delete root.dataset.theme;
    const color = settings.theme === 'clean' ? (systemDark ? '#111318' : '#f4f5f7') : '#07090d';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
  });
</script>

<svelte:document onpointerdown={unlockAudio} />

{#if mode === 'lan'}
  {#if !msg}
    <div class="connecting">{t('connecting')}</div>
  {:else if showTable && lanCtl}
    {#key lanCtl}
      <Game controller={lanCtl.ctl} onExit={lanExit} />
    {/key}
  {:else if msg.you.isAdmin && msg.phase === 'lobby'}
    <Lobby
      saved={null}
      onStart={lanStart}
      onResume={() => {}}
      lan={{ members: msg.members, onSetupChange: (s) => void conn?.send({ cmd: 'setup', setup: s }) }}
    />
  {:else}
    <LanRoom
      {msg}
      conn={conn!}
      onWatch={() => {
        unlockAudio();
        if (!msg) return;
        away = -1;
        watching = msg.tournament;
      }}
    />
  {/if}
{:else if mode === 'single'}
  {#if controller}
    {#key controller}
      <Game {controller} onExit={exit} />
    {/key}
  {:else}
    <Lobby {saved} onStart={start} onResume={resume} />
  {/if}
{/if}

<style>
  .connecting {
    height: 100%;
    display: grid;
    place-items: center;
    color: var(--text-3);
  }
</style>
