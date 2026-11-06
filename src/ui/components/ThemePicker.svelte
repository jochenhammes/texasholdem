<script lang="ts">
  import { settings, updateSettings, type Theme } from '../../game/settings.svelte';
  import { t } from '../../i18n/index.svelte';

  const themes: Theme[] = ['table', 'clean'];
</script>

<div class="picker" role="radiogroup" aria-label={t('design')}>
  {#each themes as th (th)}
    <button
      class="option"
      role="radio"
      aria-checked={settings.theme === th}
      class:on={settings.theme === th}
      onclick={() => updateSettings({ theme: th })}
    >
      <span class="preview {th}" aria-hidden="true">
        {#if th === 'table'}
          <span class="felt"></span>
          <span class="c c1"></span><span class="c c2"></span><span class="c c3"></span>
        {:else}
          <span class="tiles"><i></i><i></i><i></i></span>
          <span class="panel"><span class="c c1"></span><span class="c c2"></span><span class="c c3"></span></span>
        {/if}
      </span>
      <span class="text">
        <span class="title">{t(`theme_${th}`)}</span>
        <small>{t(`themeHint_${th}`)}</small>
      </span>
    </button>
  {/each}
</div>

<style>
  .picker {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .option {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px;
    border-radius: 16px;
    text-align: left;
    background: var(--panel-2);
    box-shadow: inset 0 0 0 1px var(--line);
    transition: box-shadow 0.2s;
  }
  .option.on {
    box-shadow: inset 0 0 0 2px var(--text);
  }
  .text {
    display: flex;
    flex-direction: column;
    padding: 0 4px 2px;
    line-height: 1.2;
  }
  .title {
    font-weight: 650;
    font-size: 0.92rem;
  }
  small {
    color: var(--text-3);
    font-size: 0.75rem;
  }

  /* tiny illustrations of both designs – fixed colors on purpose */
  .preview {
    position: relative;
    height: 64px;
    border-radius: 10px;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
  }
  .preview.table {
    background: #07090d;
  }
  .felt {
    position: absolute;
    inset: 10px 14px;
    border-radius: 999px;
    background: radial-gradient(120% 90% at 50% 40%, #0f5641, #0a3d2e);
  }
  .c {
    position: relative;
    width: 12px;
    height: 17px;
    border-radius: 2px;
    background: #fff;
  }
  .preview.clean {
    background: #f4f5f7;
    flex-direction: column;
    gap: 5px;
    padding: 7px;
  }
  .tiles {
    display: flex;
    gap: 4px;
    width: 100%;
  }
  .tiles i {
    flex: 1;
    height: 12px;
    border-radius: 3px;
    background: #fff;
    box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.12);
  }
  .panel {
    flex: 1;
    width: 100%;
    display: flex;
    gap: 3px;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    background: #fff;
    box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.12);
  }
  .preview.clean .c {
    width: 10px;
    height: 14px;
    box-shadow: 0 0 0 1px rgba(15, 23, 42, 0.18);
  }
</style>
