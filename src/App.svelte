<script lang="ts">
  import { LocalGameController, newGame } from './game/localController';
  import { settings, SPEED_FACTOR } from './game/settings.svelte';
  import { storage, type SavedGame } from './game/storage';
  import type { GameController, GameSetup } from './game/types';
  import { i18n } from './i18n/index.svelte';
  import Game from './ui/Game.svelte';
  import Lobby from './ui/Lobby.svelte';
  import { unlockAudio } from './ui/sound';

  let controller = $state<GameController | null>(null);
  let saved = $state<SavedGame | null>(storage.loadGame());

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
    controller?.dispose();
    controller = null;
    if (reason !== 'lobby') storage.clearGame();
    saved = storage.loadGame();
    if (reason === 'new') {
      const setup = storage.loadSetup();
      if (setup) start(setup);
    }
  }
</script>

{#if controller}
  {#key controller}
    <Game {controller} onExit={exit} />
  {/key}
{:else}
  <Lobby {saved} onStart={start} onResume={resume} />
{/if}
