<script lang="ts">
  import { cardToString } from '../../engine/cards';
  import type { GameEvent } from '../../engine/types';
  import type { LoggedEvent } from '../../game/types';
  import type { TableView } from '../../engine/view';
  import { HERO_ID } from '../../game/localController';
  import { chips, handName, t } from '../../i18n/index.svelte';

  let { log, view }: { log: LoggedEvent[]; view: TableView } = $props();

  const nameOf = (id: string) => (id === HERO_ID ? t('you') : (view.players.find((p) => p.id === id)?.name ?? id));
  const suitGlyph = ['♣', '♦', '♥', '♠'];
  const fmtCards = (cs: number[]) =>
    cs.map((c) => cardToString(c).replace('T', '10').slice(0, -1) + suitGlyph[c & 3] + '︎').join(' ');

  function line(e: GameEvent): { text: string; kind: string } | null {
    switch (e.type) {
      case 'handStart':
        return { text: t('ev_handStart', { n: e.handNumber, level: e.levelIndex + 1 }), kind: 'head' };
      case 'levelUp':
        return { text: t('levelUp', { sb: chips(e.level.sb), bb: chips(e.level.bb) }), kind: 'level' };
      case 'blind':
        if (e.kind === 'ante') return null;
        return { text: t(e.kind === 'sb' ? 'ev_blind_sb' : 'ev_blind_bb', { name: nameOf(e.playerId), amount: chips(e.amount) }), kind: 'muted' };
      case 'action':
        return {
          text: t(`ev_${e.action.type}`, { name: nameOf(e.playerId), amount: chips(e.action.amount) }),
          kind: e.action.type,
        };
      case 'uncalledReturned':
        return { text: t('ev_uncalled', { name: nameOf(e.playerId), amount: chips(e.amount) }), kind: 'muted' };
      case 'board':
        return { text: t(`ev_board_${e.street as 'flop' | 'turn' | 'river'}`, { cards: fmtCards(e.cards) }), kind: 'board' };
      case 'reveal':
        return { text: t('ev_reveal'), kind: 'muted' };
      case 'potAwarded': {
        const who = e.winners.map((w) => nameOf(w.playerId)).join(' & ');
        const amount = chips(e.amount);
        return {
          text: e.handKey ? t('winsWith', { name: who, amount, hand: handName(e.handKey) }) : t('wins', { name: who, amount }),
          kind: 'win',
        };
      }
      case 'eliminated':
        return { text: t('ev_eliminated', { name: nameOf(e.playerId), place: e.place }), kind: 'out' };
      case 'tournamentComplete':
        return { text: t('ev_tournamentComplete', { name: nameOf(e.winnerId) }), kind: 'win' };
      default:
        return null;
    }
  }

  // newest hand first, events inside a hand in chronological order
  const lines = $derived.by(() => {
    const groups = new Map<number, { id: number; text: string; kind: string }[]>();
    for (const l of log) {
      const r = line(l.event);
      if (!r) continue;
      if (!groups.has(l.hand)) groups.set(l.hand, []);
      groups.get(l.hand)!.push({ id: l.id, ...r });
    }
    return [...groups.values()].reverse().flat();
  });
</script>

{#if lines.length === 0}
  <p class="empty">{t('noLog')}</p>
{:else}
  <ol class="log">
    {#each lines as l (l.id)}
      <li class={l.kind}>{l.text}</li>
    {/each}
  </ol>
{/if}

<style>
  .log {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 0.9rem;
  }
  li {
    padding: 5px 0;
    color: var(--text);
  }
  li.head {
    margin-top: 10px;
    padding-top: 12px;
    border-top: 1px solid var(--line);
    font-weight: 700;
    font-size: 0.8rem;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--text-3);
  }
  li.muted,
  li.fold,
  li.check {
    color: var(--text-2);
  }
  li.board {
    color: var(--text);
    font-weight: 600;
  }
  li.win {
    color: var(--gold);
    font-weight: 650;
  }
  li.raise,
  li.bet {
    color: var(--raise);
  }
  li.allin,
  li.out {
    color: var(--danger);
  }
  li.level {
    color: var(--accent);
    font-weight: 600;
  }
  .empty {
    color: var(--text-3);
  }
</style>
