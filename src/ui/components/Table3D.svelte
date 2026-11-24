<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import type { GameSnapshot } from '../../game/types';
  import { settings } from '../../game/settings.svelte';
  import { chips, handName, t } from '../../i18n/index.svelte';
  import { tableInfo } from '../tableInfo';
  import type { Scene3D } from '../three/scene';
  import type { LabelText } from '../three/pokerTable';
  import { reportProblem } from '../../game/lan/client';

  let { snap, onFail }: { snap: GameSnapshot; onFail?: (reason: string) => void } = $props();

  let host: HTMLDivElement;
  let scene3d = $state<Scene3D | null>(null);
  let disposed = false;

  const text = (): LabelText => ({
    action: (type) => t(type === 'allin' ? 'allin' : type),
    allIn: t('allin'),
    out: t('out'),
    pot: t('pot'),
    money: chips,
    hand: handName,
  });

  onMount(async () => {
    try {
      // three.js is only downloaded when the 3D view is actually used
      const { createScene3D } = await import('../three/scene');
      if (disposed) return;
      scene3d = createScene3D(host, { lite: settings.lite3d, text, fourColor: () => settings.fourColor });
      host.querySelector('canvas')?.addEventListener('webglcontextlost', () => fail('WebGL context lost'));
    } catch (err) {
      fail(err);
    }
  });

  let failed = false;
  function fail(err: unknown) {
    if (failed) return;
    failed = true;
    const reason = err instanceof Error ? err.message : String(err);
    console.error('3D view unavailable', err);
    // tell the server's console which device failed and why (home network only)
    void reportProblem(`3D: ${reason} · ${navigator.userAgent}`);
    onFail?.(reason);
  }

  onDestroy(() => {
    disposed = true;
    scene3d?.dispose();
  });

  // Every snapshot (and every language / four-colour change read inside) re-syncs the table.
  $effect(() => {
    try {
      scene3d?.setSnapshot(snap);
    } catch (err) {
      fail(err);
    }
  });

  const info = $derived(tableInfo(snap.view, settings.handHints, snap.winChanceMode ?? settings.winChance));
</script>

<div class="table3d" bind:this={host}>
  {#if !scene3d}
    <div class="loading">{t('loading3d')}</div>
  {/if}
  {#if info.winnerLine}
    <div class="winner" transition:fade={{ duration: 200 }}>{info.winnerLine}</div>
  {/if}
  {#if info.heroHint}
    <div class="hint" transition:fade={{ duration: 200 }}>{info.heroHint}</div>
  {/if}
</div>

<style>
  .table3d {
    position: absolute;
    inset: 0;
    overflow: hidden;
    background: #050403;
    color: #fff;
  }
  .table3d :global(.canvas3d) {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
    touch-action: none;
    cursor: grab;
  }
  .table3d :global(.canvas3d.grabbing) {
    cursor: grabbing;
  }
  .loading {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: rgba(255, 255, 255, 0.6);
    font-size: 0.9rem;
  }
  .winner,
  .hint {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    max-width: calc(100% - 24px);
    padding: 5px 14px;
    border-radius: 999px;
    background: rgba(8, 10, 14, 0.78);
    font-size: 0.82rem;
    text-align: center;
    pointer-events: none;
    z-index: 2;
  }
  .winner {
    top: 10px;
    color: #ffd76a;
    font-weight: 650;
    box-shadow: 0 0 0 1px rgba(255, 215, 106, 0.35);
  }
  /* the own hand strength sits at the top, where the result appears later */
  .hint {
    top: 10px;
    color: rgba(255, 255, 255, 0.85);
  }

  /* HTML labels positioned over the scene (created by the 3D table) */
  .table3d :global(.labels3d) {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
    z-index: 1;
  }
  .table3d :global(.labels3d.hidden) {
    display: none;
  }
  .table3d :global(.seat3d),
  .table3d :global(.bet3d),
  .table3d :global(.pot3d) {
    position: absolute;
    left: 0;
    top: 0;
    white-space: nowrap;
    will-change: transform;
  }
  .table3d :global(.seat3d) {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 3px 9px;
    border: 1.5px solid rgba(255, 255, 255, 0.16);
    border-radius: 9px;
    background: rgba(10, 12, 17, 0.82);
    font-size: 12px;
    line-height: 1.25;
    transition:
      border-color 0.2s,
      box-shadow 0.2s,
      opacity 0.2s;
  }
  .table3d :global(.seat3d b i) {
    margin-left: 5px;
    padding: 0 4px;
    border-radius: 4px;
    background: #f3f0e6;
    color: #111;
    font-size: 10px;
    font-style: normal;
  }
  .table3d :global(.seat3d span) {
    color: #ffd76a;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .table3d :global(.seat3d em) {
    color: #9fe3ff;
    font-size: 11px;
    font-style: normal;
  }
  .table3d :global(.seat3d.to-act) {
    border-color: #3ddc97;
    box-shadow: 0 0 0 2px rgba(61, 220, 151, 0.35);
  }
  .table3d :global(.seat3d.folded) {
    opacity: 0.55;
  }
  .table3d :global(.seat3d.out) {
    opacity: 0.35;
  }
  .table3d :global(.seat3d.winner) {
    border-color: #ffd76a;
    box-shadow: 0 0 12px rgba(255, 215, 106, 0.6);
  }
  .table3d :global(.bet3d) {
    padding: 1px 7px;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.62);
    font-size: 11px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .table3d :global(.pot3d) {
    padding: 3px 10px;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.68);
    color: #ffd76a;
    font-size: 13px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
</style>
