<script lang="ts">
  import { settings, updateSettings, type TableView3D } from '../../game/settings.svelte';
  import { t } from '../../i18n/index.svelte';
  import Segmented from './Segmented.svelte';
</script>

<Segmented
  options={[
    { value: '2d', label: t('view_2d') },
    { value: '3d', label: t('view_3d') },
  ] as { value: TableView3D; label: string }[]}
  value={settings.view}
  onChange={(v) => updateSettings({ view: v })}
/>
<span class="hint">{t(`viewHint_${settings.view}`)}</span>

<style>
  .hint {
    display: block;
    margin-top: 6px;
    font-size: 0.78rem;
    color: var(--text-3);
  }
</style>
