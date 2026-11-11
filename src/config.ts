import type { FirebaseOptions } from 'firebase/app';

/**
 * Firebase project for "Mit Freunden spielen".
 * Paste the web app config from the Firebase console here (it is public, not a secret).
 * While this is `null`, multiplayer stays hidden – single player works as before.
 */
export const firebaseConfig: FirebaseOptions | null = null;

/** Local development / tests: `VITE_FIREBASE_EMULATOR=1` uses the Database emulator on 127.0.0.1:9000. */
export const useFirebaseEmulator = import.meta.env.VITE_FIREBASE_EMULATOR === '1';

export const multiplayerAvailable = useFirebaseEmulator || firebaseConfig !== null;
