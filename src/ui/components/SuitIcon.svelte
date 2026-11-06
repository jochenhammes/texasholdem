<script lang="ts">
  let { suit }: { suit: number } = $props();
</script>

<svg viewBox="0 0 24 24" aria-hidden="true" class="suit-icon">
  {#if suit === 0}
    <circle cx="12" cy="7.2" r="4.3" />
    <circle cx="6.9" cy="13.4" r="4.3" />
    <circle cx="17.1" cy="13.4" r="4.3" />
    <path d="M11 12h2l1.6 9.5H9.4z" />
  {:else if suit === 1}
    <path d="M12 1.5 20.2 12 12 22.5 3.8 12z" />
  {:else if suit === 2}
    <path
      d="M12 21.6S2.6 15.8 2.1 9.4C1.8 5.9 4.3 3 7.3 3c2 0 3.5 1.1 4.7 2.9C13.2 4.1 14.7 3 16.7 3c3 0 5.5 2.9 5.2 6.4-.5 6.4-9.9 12.2-9.9 12.2z"
    />
  {:else}
    <path
      d="M12 1.8C9.2 6 2.4 9.2 2.4 14.2c0 2.9 2.3 5 5 5 1.6 0 2.9-.7 3.7-1.8L9.9 22.2h4.2l-1.2-4.8c.8 1.1 2.1 1.8 3.7 1.8 2.7 0 5-2.1 5-5C21.6 9.2 14.8 6 12 1.8z"
    />
  {/if}
</svg>

<style>
  .suit-icon {
    width: 1em;
    height: 1em;
    fill: currentColor;
    display: block;
  }
</style>
