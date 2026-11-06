<script lang="ts">
  let { checked, label, hint, onChange }: { checked: boolean; label: string; hint?: string; onChange: (v: boolean) => void } =
    $props();
</script>

<button class="toggle-row" role="switch" aria-checked={checked} onclick={() => onChange(!checked)}>
  <span class="text">
    <span>{label}</span>
    {#if hint}<small>{hint}</small>{/if}
  </span>
  <span class="switch" class:on={checked}><span class="knob"></span></span>
</button>

<style>
  .toggle-row {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 52px;
    text-align: left;
  }
  .text {
    display: flex;
    flex-direction: column;
    font-weight: 550;
  }
  small {
    color: var(--text-3);
    font-weight: 450;
    font-size: 0.8rem;
  }
  .switch {
    flex: none;
    width: 50px;
    height: 30px;
    border-radius: 999px;
    background: var(--panel-3);
    position: relative;
    transition: background-color 0.2s;
  }
  .switch.on {
    background: var(--accent);
  }
  .knob {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
    transition: transform 0.22s var(--ease);
  }
  .on .knob {
    transform: translateX(20px);
  }
</style>
