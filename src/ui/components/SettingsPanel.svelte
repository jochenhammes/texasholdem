<script lang="ts">
  import { settings, updateSettings, type AnimSpeed } from '../../game/settings.svelte';
  import { i18n, setLocale, t, type Locale } from '../../i18n/index.svelte';
  import Segmented from './Segmented.svelte';
  import Toggle from './Toggle.svelte';
</script>

<div class="settings">
  <div class="group">
    <div class="label">{t('language')}</div>
    <Segmented
      options={[
        { value: 'de', label: 'Deutsch' },
        { value: 'en', label: 'English' },
      ] as { value: Locale; label: string }[]}
      value={i18n.locale}
      onChange={setLocale}
    />
  </div>
  <div class="group">
    <div class="label">{t('animSpeed')}</div>
    <Segmented
      options={[
        { value: 'relaxed', label: t('anim_relaxed') },
        { value: 'normal', label: t('anim_normal') },
        { value: 'fast', label: t('anim_fast') },
      ] as { value: AnimSpeed; label: string }[]}
      value={settings.animSpeed}
      onChange={(v) => updateSettings({ animSpeed: v })}
    />
  </div>
  <div class="list">
    <Toggle checked={settings.sound} label={t('sound')} onChange={(v) => updateSettings({ sound: v })} />
    <Toggle
      checked={settings.fourColor}
      label={t('fourColor')}
      hint={t('fourColorHint')}
      onChange={(v) => updateSettings({ fourColor: v })}
    />
    <Toggle
      checked={settings.handHints}
      label={t('handHints')}
      hint={t('handHintsHint')}
      onChange={(v) => updateSettings({ handHints: v })}
    />
  </div>
</div>

<style>
  .settings {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  .group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .list {
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--line);
  }
  .list :global(.toggle-row) {
    border-bottom: 1px solid var(--line);
  }
</style>
