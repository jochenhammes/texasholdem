// Browser side of the home-network multiplayer: finds the LAN server, keeps the
// event stream open (reconnects on its own) and sends commands.

import { LAN_API, type LanCommand, type LanMessage, type LanResult } from './protocol';

const CLIENT_KEY = 'holdem.lan.client.v1';

/** Stable random id of this browser – keeps the seat (and the admin role) across reloads. */
export function clientId(): string {
  try {
    const known = localStorage.getItem(CLIENT_KEY);
    if (known && /^[A-Za-z0-9_-]{8,64}$/.test(known)) return known;
  } catch {
    /* private mode – a fresh id per visit is fine */
  }
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const id = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  try {
    localStorage.setItem(CLIENT_KEY, id);
  } catch {
    /* ignore */
  }
  return id;
}

/** Is this page served by the LAN server (`npm run preview`)? On GitHub Pages it is not. */
export async function detectLan(timeoutMs = 1500): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`./${LAN_API}/hello`, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) return false;
    const body = (await res.json()) as { lan?: boolean };
    return body.lan === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export class LanConnection {
  readonly id = clientId();
  private source: EventSource | null = null;
  private listeners = new Set<(m: LanMessage) => void>();
  private statusListeners = new Set<(online: boolean) => void>();
  last: LanMessage | null = null;
  online = false;

  open() {
    if (this.source) return;
    const es = new EventSource(`./${LAN_API}/stream?client=${encodeURIComponent(this.id)}`);
    es.onmessage = (e) => {
      let msg: LanMessage;
      try {
        msg = JSON.parse(e.data) as LanMessage;
      } catch {
        return;
      }
      this.last = msg;
      this.setOnline(true);
      for (const l of this.listeners) l(msg);
    };
    es.onerror = () => this.setOnline(false); // EventSource reconnects by itself
    this.source = es;
    // Closing the tab says goodbye, so the server can tell it from a short connection loss.
    // (A reload says goodbye too – it reconnects within the grace period.)
    window.addEventListener('pagehide', this.sayBye);
  }

  onMessage(run: (m: LanMessage) => void) {
    this.listeners.add(run);
    if (this.last) run(this.last);
    return () => this.listeners.delete(run);
  }

  onStatus(run: (online: boolean) => void) {
    this.statusListeners.add(run);
    return () => this.statusListeners.delete(run);
  }

  async send(command: LanCommand): Promise<LanResult> {
    try {
      const res = await fetch(`./${LAN_API}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client: this.id, ...command }),
      });
      return (await res.json()) as LanResult;
    } catch {
      return { ok: false, error: 'badRequest' };
    }
  }

  private sayBye = (e: PageTransitionEvent) => {
    if (e.persisted) return; // kept in the back/forward cache, not closed
    const body = JSON.stringify({ client: this.id, cmd: 'bye' });
    try {
      navigator.sendBeacon(`./${LAN_API}/command`, new Blob([body], { type: 'application/json' }));
    } catch {
      /* the long grace period still applies */
    }
  };

  close() {
    window.removeEventListener('pagehide', this.sayBye);
    this.source?.close();
    this.source = null;
    this.listeners.clear();
    this.statusListeners.clear();
  }

  private setOnline(v: boolean) {
    if (this.online === v) return;
    this.online = v;
    for (const l of this.statusListeners) l(v);
  }
}
