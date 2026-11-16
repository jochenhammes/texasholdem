<script lang="ts">
  /**
   * Shrinking bar for the multiplayer decision time limit. Pure CSS animation
   * (no timers), restarted whenever the deadline changes.
   */
  let { deadline, total = 30000 }: { deadline: number; total?: number } = $props();
  const remaining = $derived(Math.max(0, deadline - Date.now()));
  const start = $derived(Math.min(1, remaining / total));
</script>

{#key deadline}
  <div class="timer" role="timer" aria-label="{Math.ceil(remaining / 1000)} s">
    <div class="fill" style="--start:{start};--dur:{remaining}ms"></div>
  </div>
{/key}

<style>
  .timer {
    width: 100%;
    height: 4px;
    border-radius: 2px;
    background: var(--panel-3);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    width: 100%;
    border-radius: 2px;
    background: var(--accent);
    transform-origin: left center;
    animation: shrink var(--dur) linear forwards;
  }
  @keyframes shrink {
    from {
      transform: scaleX(var(--start));
    }
    80% {
      background: var(--accent);
    }
    to {
      transform: scaleX(0);
      background: var(--danger);
    }
  }
</style>
