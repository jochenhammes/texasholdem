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

  const pacing = { speed: () => SPEED_FACTOR[settings.animSpeed] };

  $effect(() => {
    document.documentElement.lang = i18n.locale;
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
