<script lang="ts">
  import { multiplayerAvailable } from './config';
  import { LocalGameController, newGame } from './game/localController';
  import { HostController } from './game/mp/hostController';
  import { roomFromHash } from './game/mp/room';
  import { settings, SPEED_FACTOR } from './game/settings.svelte';
  import { storage, type SavedGame } from './game/storage';
  import type { GameController, GameSetup } from './game/types';
  import { i18n } from './i18n/index.svelte';
  import Game from './ui/Game.svelte';
  import Lobby from './ui/Lobby.svelte';
  import Room from './ui/Room.svelte';
  import { unlockAudio } from './ui/sound';

  type RoomMode = { kind: 'create'; setup: GameSetup } | { kind: 'join'; code: string };

  let controller = $state<GameController | null>(null);
  let saved = $state<SavedGame | null>(storage.loadGame());
  // an invitation link (#room=K7QX92) opens the waiting room directly
  const invited = multiplayerAvailable ? roomFromHash() : null;
  let room = $state<RoomMode | null>(invited ? { kind: 'join', code: invited } : null);

  const pacing = { speed: () => SPEED_FACTOR[settings.animSpeed], holdAfterShowdown: () => settings.pauseAtShowdown };

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
    if (c instanceof HostController) void c.close();
    else c?.dispose();
    const wasMultiplayer = !!room;
    if (wasMultiplayer) {
      room = null;
      history.replaceState(null, '', location.pathname);
    } else if (reason !== 'lobby') storage.clearGame();
    saved = storage.loadGame();
    if (reason === 'new') {
      const setup = storage.loadSetup();
      if (setup) {
        if (wasMultiplayer) room = { kind: 'create', setup };
        else start(setup);
      }
    }
  }
</script>

{#if controller}
  {#key controller}
    <Game {controller} onExit={exit} />
  {/key}
{:else if room}
  {#key room}
    <Room
      mode={room}
      speed={pacing.speed}
      onGame={(c) => {
        unlockAudio();
        controller = c;
      }}
      onLeave={() => (room = null)}
    />
  {/key}
{:else}
  <Lobby
    {saved}
    onStart={start}
    onResume={resume}
    onFriends={(setup) => {
      unlockAudio();
      room = { kind: 'create', setup };
    }}
    onJoinCode={(code) => (room = { kind: 'join', code })}
  />
{/if}
