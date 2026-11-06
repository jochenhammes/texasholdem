import type { PlayerAction } from '../engine/types';
import { decideWithFallback, type BotInput } from './decide';

/** Async bot brain: uses a Web Worker when available, falls back to the main thread. */
export class BotClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (a: PlayerAction) => void; input: BotInput }>();

  constructor() {
    if (typeof Worker !== 'undefined') {
      try {
        this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
        this.worker.onmessage = (e) => {
          const { id, action, error } = e.data as { id: number; action?: PlayerAction; error?: string };
          const p = this.pending.get(id);
          if (!p) return;
          this.pending.delete(id);
          p.resolve(action && !error ? action : decideWithFallback(p.input));
        };
        this.worker.onerror = () => this.failAll();
      } catch {
        this.worker = null;
      }
    }
  }

  decide(input: BotInput): Promise<PlayerAction> {
    if (!this.worker) return Promise.resolve(decideWithFallback(input));
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, { resolve, input });
      this.worker!.postMessage({ id, input });
    });
  }

  private failAll() {
    this.worker?.terminate();
    this.worker = null;
    for (const [, p] of this.pending) p.resolve(decideWithFallback(p.input));
    this.pending.clear();
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
  }
}
