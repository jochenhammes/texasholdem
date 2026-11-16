/**
 * Security rules tests – run against the Database emulator:
 *   npm run test:rules   (starts the emulator via firebase-tools)
 */
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { get, ref, remove, set, update } from 'firebase/database';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

let env: RulesTestEnvironment;
const ROOM = 'K7QX92';
const meta = (host: string, status = 'lobby') => ({ host, createdAt: 1, status, setup: '{}' });

beforeAll(async () => {
  const [host, port] = (process.env.FIREBASE_DATABASE_EMULATOR_HOST ?? '127.0.0.1:9000').split(':');
  env = await initializeTestEnvironment({
    projectId: 'demo-holdem',
    database: { host, port: Number(port), rules: readFileSync('firebase/database.rules.json', 'utf8') },
  });
});
afterAll(() => env?.cleanup());
beforeEach(() => env.clearDatabase());

const db = (uid: string | null) => (uid ? env.authenticatedContext(uid).database() : env.unauthenticatedContext().database());

async function seed(status = 'playing') {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await set(ref(ctx.database(), `rooms/${ROOM}`), {
      meta: meta('host', status),
      members: { host: { name: 'H', joinedAt: 1 }, anna: { name: 'A', joinedAt: 2 } },
      views: { anna: { data: '{"secret":"anna"}' }, bert: { data: '{"secret":"bert"}' } },
      inbox: { anna: { data: '{}' } },
    });
  });
}

describe('rooms', () => {
  it('signed-in users can create a room for themselves only', async () => {
    await assertSucceeds(set(ref(db('host'), `rooms/${ROOM}/meta`), meta('host')));
    await assertFails(set(ref(db('mallory'), `rooms/ABCDEF/meta`), meta('someoneElse')));
    await assertFails(set(ref(db(null), `rooms/ABCDEF/meta`), meta('x')));
  });

  it('only the host can change meta or delete the room', async () => {
    await seed();
    await assertFails(set(ref(db('anna'), `rooms/${ROOM}/meta/status`), 'closed'));
    await assertSucceeds(update(ref(db('host'), `rooms/${ROOM}/meta`), { status: 'closed' }));
    await assertFails(remove(ref(db('anna'), `rooms/${ROOM}`)));
    await assertSucceeds(remove(ref(db('host'), `rooms/${ROOM}`)));
  });

  it('nobody can list rooms', async () => {
    await seed();
    await assertFails(get(ref(db('anna'), 'rooms')));
  });
});

describe('members', () => {
  it('anyone signed in may join a room in the lobby, but not a running game', async () => {
    await seed('lobby');
    await assertSucceeds(set(ref(db('carl'), `rooms/${ROOM}/members/carl`), { name: 'C', joinedAt: 3 }));
    await seed('playing');
    await assertFails(set(ref(db('dora'), `rooms/${ROOM}/members/dora`), { name: 'D', joinedAt: 3 }));
    // existing members may rejoin
    await assertSucceeds(set(ref(db('anna'), `rooms/${ROOM}/members/anna`), { name: 'A2', joinedAt: 5 }));
  });

  it('cannot add other people', async () => {
    await seed('lobby');
    await assertFails(set(ref(db('carl'), `rooms/${ROOM}/members/zed`), { name: 'Z', joinedAt: 3 }));
  });

  it('member list is visible to members only', async () => {
    await seed();
    await assertSucceeds(get(ref(db('anna'), `rooms/${ROOM}/members`)));
    await assertFails(get(ref(db('stranger'), `rooms/${ROOM}/members`)));
  });
});

describe('hidden cards', () => {
  it('a guest reads only its own view', async () => {
    await seed();
    await assertSucceeds(get(ref(db('anna'), `rooms/${ROOM}/views/anna`)));
    await assertFails(get(ref(db('anna'), `rooms/${ROOM}/views/bert`)));
    await assertFails(get(ref(db('anna'), `rooms/${ROOM}/views`)));
  });

  it('only the host writes views', async () => {
    await seed();
    await assertSucceeds(set(ref(db('host'), `rooms/${ROOM}/views/anna`), { data: '{}' }));
    await assertFails(set(ref(db('anna'), `rooms/${ROOM}/views/anna`), { data: '{"fake":1}' }));
  });

  it('guests write only their own inbox, only the host reads inboxes', async () => {
    await seed();
    await assertSucceeds(set(ref(db('anna'), `rooms/${ROOM}/inbox/anna`), { data: '{"seq":1}' }));
    await assertFails(set(ref(db('anna'), `rooms/${ROOM}/inbox/bert`), { data: '{"seq":1}' }));
    await assertFails(set(ref(db('stranger'), `rooms/${ROOM}/inbox/stranger`), { data: '{"seq":1}' }));
    await assertSucceeds(get(ref(db('host'), `rooms/${ROOM}/inbox`)));
    await assertFails(get(ref(db('anna'), `rooms/${ROOM}/inbox`)));
  });

  it('rejects oversized messages', async () => {
    await seed();
    await assertFails(set(ref(db('anna'), `rooms/${ROOM}/inbox/anna`), { data: 'x'.repeat(2000) }));
  });
});
