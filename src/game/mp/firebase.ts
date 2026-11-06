import { firebaseConfig, useFirebaseEmulator } from '../../config';
import type { Transport, Unsubscribe } from './transport';

/**
 * Firebase Realtime Database transport. The Firebase SDK is loaded lazily
 * (dynamic import) so single player never downloads it.
 */
let connecting: Promise<Transport> | null = null;

export function connectFirebase(): Promise<Transport> {
  connecting ??= open().catch((e) => {
    connecting = null;
    throw e;
  });
  return connecting;
}

async function open(): Promise<Transport> {
  const [{ initializeApp }, db] = await Promise.all([import('firebase/app'), import('firebase/database')]);

  let uid: string;
  let database: import('firebase/database').Database;

  if (useFirebaseEmulator) {
    // Emulator: no auth service needed – use a mock token with a per-browser id.
    uid = emulatorUid();
    const app = initializeApp({ projectId: 'demo-holdem', apiKey: 'demo', databaseURL: 'http://127.0.0.1:9000?ns=demo-holdem' }, `emu-${uid}`);
    database = db.getDatabase(app);
    db.connectDatabaseEmulator(database, '127.0.0.1', 9000, { mockUserToken: { sub: uid, user_id: uid } });
  } else {
    if (!firebaseConfig) throw new Error('Firebase is not configured');
    const { getAuth, signInAnonymously, onAuthStateChanged } = await import('firebase/auth');
    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    // anonymous sign-in; the id survives reloads (stored by Firebase in the browser)
    uid = await new Promise<string>((resolve, reject) => {
      const stop = onAuthStateChanged(auth, (user) => {
        if (user) {
          stop();
          resolve(user.uid);
        }
      });
      signInAnonymously(auth).catch((e) => {
        stop();
        reject(e);
      });
    });
    database = db.getDatabase(app);
  }

  const r = (path: string) => db.ref(database, path);

  return {
    uid,
    async get<T>(path: string) {
      const snap = await db.get(r(path));
      return (snap.exists() ? snap.val() : null) as T | null;
    },
    set: (path, value) => db.set(r(path), value),
    update: (values) => db.update(db.ref(database), values),
    remove: (path) => db.remove(r(path)),
    on<T>(path: string, cb: (value: T | null) => void): Unsubscribe {
      return db.onValue(
        r(path),
        (snap) => cb((snap.exists() ? snap.val() : null) as T | null),
        () => cb(null),
      );
    },
    presence(path: string): Unsubscribe {
      const node = r(path);
      // re-announce after every reconnect
      const stop = db.onValue(r('.info/connected'), (snap) => {
        if (snap.val() !== true) return;
        db.onDisconnect(node)
          .remove()
          .then(() => db.set(node, true))
          .catch(() => {});
      });
      return () => {
        stop();
        db.remove(node).catch(() => {});
      };
    },
  };
}

function emulatorUid(): string {
  const key = 'holdem.emuUid';
  let id = sessionStorage.getItem(key);
  if (!id) {
    id = 'u' + Math.random().toString(36).slice(2, 12);
    sessionStorage.setItem(key, id);
  }
  return id;
}
