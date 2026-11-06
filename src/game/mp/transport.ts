/**
 * Minimal realtime key/value transport used by multiplayer. Implemented by
 * Firebase Realtime Database in the app and by an in-memory store in tests.
 * Paths are absolute ("rooms/K7QX92/meta").
 */
export type Unsubscribe = () => void;

export interface Transport {
  readonly uid: string;
  get<T>(path: string): Promise<T | null>;
  set(path: string, value: unknown): Promise<void>;
  /** Multi-path update, atomic. Keys are absolute paths. */
  update(values: Record<string, unknown>): Promise<void>;
  remove(path: string): Promise<void>;
  /** Value subscription; called with the current value and on every change. */
  on<T>(path: string, cb: (value: T | null) => void): Unsubscribe;
  /** Sets `path` to true while connected; removed automatically on disconnect. */
  presence(path: string): Unsubscribe;
}

// ───────────── in-memory implementation (tests, offline demos) ─────────────

type Tree = Record<string, unknown>;

/** Shared store: create one per test and a `MemoryTransport` per simulated device. */
export class MemoryStore {
  root: Tree = {};
  private listeners = new Set<{ path: string; fire: () => void }>();

  read(path: string): unknown {
    let node: unknown = this.root;
    for (const k of split(path)) {
      if (!node || typeof node !== 'object') return null;
      node = (node as Tree)[k];
    }
    return node === undefined ? null : clone(node);
  }

  write(path: string, value: unknown) {
    const keys = split(path);
    if (keys.length === 0) {
      this.root = (clone(value) as Tree) ?? {};
    } else {
      let node = this.root;
      for (const k of keys.slice(0, -1)) {
        if (!node[k] || typeof node[k] !== 'object') node[k] = {};
        node = node[k] as Tree;
      }
      const last = keys[keys.length - 1];
      if (value === null || value === undefined) delete node[last];
      else node[last] = clone(value);
    }
    this.notify(path);
  }

  subscribe(path: string, fire: () => void) {
    const l = { path, fire };
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private notify(changed: string) {
    for (const l of [...this.listeners]) {
      if (related(l.path, changed)) queueMicrotask(l.fire);
    }
  }
}

export class MemoryTransport implements Transport {
  constructor(
    private store: MemoryStore,
    readonly uid: string,
  ) {}
  async get<T>(path: string) {
    return this.store.read(path) as T | null;
  }
  async set(path: string, value: unknown) {
    this.store.write(path, value);
  }
  async update(values: Record<string, unknown>) {
    for (const [p, v] of Object.entries(values)) this.store.write(p, v);
  }
  async remove(path: string) {
    this.store.write(path, null);
  }
  on<T>(path: string, cb: (value: T | null) => void): Unsubscribe {
    let last = JSON.stringify(this.store.read(path));
    queueMicrotask(() => cb(JSON.parse(last) as T | null));
    return this.store.subscribe(path, () => {
      const now = JSON.stringify(this.store.read(path));
      if (now === last) return;
      last = now;
      cb(JSON.parse(now) as T | null);
    });
  }
  presence(path: string): Unsubscribe {
    this.store.write(path, true);
    return () => this.store.write(path, null);
  }
}

const split = (p: string) => p.split('/').filter(Boolean);
const related = (a: string, b: string) => {
  const x = split(a).join('/');
  const y = split(b).join('/');
  return x === y || x.startsWith(y + '/') || y.startsWith(x + '/') || x === '' || y === '';
};
const clone = (v: unknown) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
