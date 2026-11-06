<script lang="ts">
  import type { Snippet } from 'svelte';
  import { fade, fly } from 'svelte/transition';

  let {
    title,
    onClose,
    children,
    dismissable = true,
  }: { title?: string; onClose?: () => void; children: Snippet; dismissable?: boolean } = $props();

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && dismissable) onClose?.();
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="backdrop" transition:fade={{ duration: 180 }} onclick={() => dismissable && onClose?.()} role="presentation"></div>
<div class="sheet" role="dialog" aria-modal="true" aria-label={title} transition:fly={{ y: 40, duration: 260 }}>
  {#if title}
    <header>
      <h2>{title}</h2>
      {#if dismissable && onClose}
        <button class="icon-btn" aria-label="Close" onclick={onClose}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      {/if}
    </header>
  {/if}
  <div class="content">
    {@render children()}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    z-index: 50;
  }
  .sheet {
    position: fixed;
    z-index: 51;
    left: 50%;
    bottom: 0;
    transform: translateX(-50%);
    width: min(520px, 100%);
    max-height: min(86dvh, 760px);
    display: flex;
    flex-direction: column;
    background: var(--panel-solid);
    border-radius: 22px 22px 0 0;
    box-shadow: 0 -10px 40px rgba(0, 0, 0, 0.5), 0 0 0 1px var(--line);
    padding-bottom: var(--safe-b);
  }
  @media (min-width: 700px) and (min-height: 560px) {
    .sheet {
      bottom: auto;
      top: 50%;
      transform: translate(-50%, -50%);
      border-radius: 22px;
      padding-bottom: 0;
    }
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 16px 4px 20px;
  }
  h2 {
    margin: 0;
    font-size: 1.15rem;
    font-weight: 700;
  }
  .content {
    padding: 12px 20px 20px;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }
</style>
