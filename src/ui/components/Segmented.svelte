<script lang="ts" generics="T extends string | number">
  let {
    options,
    value,
    onChange,
    compact = false,
  }: { options: { value: T; label: string; sub?: string }[]; value: T; onChange: (v: T) => void; compact?: boolean } = $props();
</script>

<div class="seg" class:compact role="radiogroup" style="--count:{options.length}">
  {#each options as o (o.value)}
    <button role="radio" aria-checked={o.value === value} class:on={o.value === value} onclick={() => onChange(o.value)}>
      <span>{o.label}</span>
      {#if o.sub}<small>{o.sub}</small>{/if}
    </button>
  {/each}
</div>

<style>
  .seg {
    display: grid;
    grid-template-columns: repeat(var(--count), 1fr);
    gap: 4px;
    padding: 4px;
    border-radius: 14px;
    background: var(--panel-2);
    box-shadow: inset 0 0 0 1px var(--line);
  }
  button {
    min-height: 40px;
    border-radius: 10px;
    font-weight: 600;
    font-size: 0.9rem;
    color: var(--text-2);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    line-height: 1.15;
    padding: 4px 2px;
    transition:
      background-color 0.2s,
      color 0.2s;
  }
  button {
    min-width: 0;
  }
  .compact button {
    font-size: 0.8rem;
    letter-spacing: -0.01em;
    padding: 4px 0;
  }
  .compact small {
    font-size: 0.64rem;
  }
  button.on {
    background: var(--text);
    color: var(--bg);
  }
  small {
    font-size: 0.68rem;
    font-weight: 500;
    opacity: 0.7;
  }
</style>
