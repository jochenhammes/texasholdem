// The 3D poker table: cards, chips, dealer button and seat labels follow every
// game snapshot. Cards are dealt and flipped with animation, chips fly between
// stack, bet and pot. Pure presentation – the game itself runs in the engine.

import * as THREE from 'three';
import type { GameSnapshot } from '../../game/types';
import type { PlayerView, TableView } from '../../engine/view';
import type { ActionLabel } from '../../engine/types';
import type { CategoryKey } from '../../engine/evaluator';
import {
  BLACK,
  BLUE,
  DENOMS,
  GREEN,
  RED,
  drawBack,
  drawChipSide,
  drawChipTop,
  drawDealerButton,
  drawFace,
  drawLinen,
  drawSmudges,
  rnd,
  type Painter,
  type SuitName,
} from './textures';

export type MaterialFactory = (base: THREE.MeshPhysicalMaterialParameters, extras?: THREE.MeshPhysicalMaterialParameters) => THREE.MeshStandardMaterial;
export type TextureFactory = (w: number, h: number, draw: Painter, repeatX: number, repeatY: number, srgb?: boolean) => THREE.CanvasTexture;

/** Localised strings for the HTML labels above the table. */
export interface LabelText {
  action: (type: ActionLabel) => string;
  allIn: string;
  out: string;
  pot: string;
  money: (n: number) => string;
  hand: (key: CategoryKey) => string;
}

// Sizes relative to the card width (real poker card 63 × 88 mm, chip 39 × 3.3 mm)
const CARD_W = 2.2,
  CARD_H = 3.08,
  THICK = 0.012;
const CHIP_R = 0.68,
  CHIP_H = 0.115;

const pick = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)];

function cardShape() {
  const w = CARD_W / 2,
    h = CARD_H / 2,
    r = 0.13;
  const s = new THREE.Shape();
  s.moveTo(-w + r, -h);
  s.lineTo(w - r, -h);
  s.quadraticCurveTo(w, -h, w, -h + r);
  s.lineTo(w, h - r);
  s.quadraticCurveTo(w, h, w - r, h);
  s.lineTo(-w + r, h);
  s.quadraticCurveTo(-w, h, -w, h - r);
  s.lineTo(-w, -h + r);
  s.quadraticCurveTo(-w, -h, -w + r, -h);
  return s;
}

function cardFaceGeometry() {
  const geo = new THREE.ShapeGeometry(cardShape(), 5);
  const pos = geo.attributes.position,
    uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / CARD_W + 0.5, pos.getY(i) / CARD_H + 0.5);
  return geo;
}

const easeOut = (t: number) => 1 - (1 - t) ** 3;
const easeInOut = (t: number) => t * t * (3 - 2 * t);

const DEG = Math.PI / 180;
interface Layout {
  rx: number;
  rz: number;
  angles: number[];
  deck: [number, number, number];
  /** Discard pile ("muck") for folded cards: x, z, heading. */
  muck: [number, number, number];
  potZ: number;
}
// Eight seats clockwise, seat 0 sits in front of the screen (90°).
export const LAYOUTS: Record<'landscape' | 'portrait', Layout> = {
  landscape: { rx: 12.5, rz: 6.2, angles: [90, 135, 180, 225, 270, 315, 0, 45], deck: [7.8, -0.6, -Math.PI / 2], muck: [-7.8, -0.6, -Math.PI / 2], potZ: 1.9 },
  portrait: { rx: 5.6, rz: 10, angles: [90, 130, 158, 202, 270, 338, 22, 50], deck: [1.35, -3.9, 0], muck: [-1.35, -3.9, 0], potZ: 1.7 },
};
/** Which of the eight places are taken with n players. */
const SLOTS: Record<number, number[]> = {
  2: [0, 4],
  3: [0, 3, 5],
  4: [0, 2, 4, 6],
  5: [0, 2, 3, 5, 6],
  6: [0, 1, 3, 4, 5, 7],
  7: [0, 1, 2, 3, 5, 6, 7],
  8: [0, 1, 2, 3, 4, 5, 6, 7],
};
const SUIT_NAMES: SuitName[] = ['club', 'diamond', 'heart', 'spade']; // engine order
const RANK_LABELS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

/** Stable pseudo-random numbers so chips do not jump when re-laid out. */
const hash = (a: number, b: number, c: number) => {
  const v = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453;
  return v - Math.floor(v);
};

/** Split an amount into chips: large values first, but always keep some change. */
export function chipsFor(amount: number): number[] {
  const counts = DENOMS.map(() => 0);
  let rest = amount;
  let top = DENOMS.length - 1;
  while (top > 0 && DENOMS[top].value > amount / 2) top--;
  for (let i = top; i >= 0; i--) {
    let n = Math.floor(rest / DENOMS[i].value);
    if (i > 0) n = Math.max(0, n - 2);
    counts[i] = n;
    rest -= n * DENOMS[i].value;
  }
  return counts;
}

interface Pose {
  x: number;
  y: number;
  z: number;
  heading: number;
  flip: number;
}
interface Step {
  at: number | null;
  dur: number;
  to: Pose;
  arc: number;
  ease: (t: number) => number;
  spin?: number;
  hide?: boolean;
  /** Make the card visible again when this step starts. */
  show?: boolean;
  /** Put the card here (without animation) when the step ends. */
  jumpTo?: Pose;
  from?: Pose;
}
interface Card3D {
  group: THREE.Group;
  frontMat: THREE.MeshStandardMaterial;
  value: number | null;
  faceKey: string;
  place: string;
  /** Position in the discard pile while the card lies there. */
  muckSlot: number;
  sig: string;
  queue: Step[];
  now: Pose;
}
interface Goal {
  place: 'deck' | 'seat' | 'board' | 'muck';
  up: boolean;
  value: number | null;
  x: number;
  y: number;
  z: number;
  heading: number;
}
interface SeatGeo {
  x: number;
  z: number;
  heading: number;
  radial: [number, number];
  tangent: [number, number];
}
interface Pile {
  id: number;
  amount: number;
  x: number;
  z: number;
  ax: [number, number];
  ay: [number, number];
  perRow?: number;
}
interface PrevPile {
  x: number;
  z: number;
  amount: number;
  counts: number[];
}
interface Flight {
  d: number;
  index: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
  quat: THREE.Quaternion;
  start: number;
  dur: number;
}

const LABELS_KEY = 'holdem.3d.labels';

export interface PokerTable {
  setSnapshot(snap: GameSnapshot, aspect: number): void;
  /** Advance animations; returns true while something moves (redraw needed). */
  update(now: number): boolean;
  layoutLabels(camera: THREE.Camera, w: number, h: number): void;
  /** Tap on a chip pile toggles the labels. Returns true when a pile was hit. */
  tapChips(x: number, y: number, camera: THREE.Camera, w: number, h: number): boolean;
  /** Re-draw card faces (e.g. after switching the four-colour deck). */
  refreshFaces(): void;
}

export function createPokerTable(opts: {
  scene: THREE.Scene;
  material: MaterialFactory;
  canvasTexture: TextureFactory;
  lite: boolean;
  /** Texture resolution factor (1 = phones / simple graphics, 2 = full). */
  res?: number;
  center: THREE.Vector3;
  labels: HTMLElement;
  text: () => LabelText;
  fourColor: () => boolean;
}): PokerTable {
  const { scene, material, canvasTexture, lite, center, labels } = opts;
  const solid = <T extends THREE.Mesh>(mesh: T): T => {
    mesh.castShadow = !lite;
    mesh.receiveShadow = !lite;
    mesh.layers.enable(1); // for the contact-shadow camera
    return mesh;
  };
  const res = opts.res ?? (lite ? 1 : 2); // texture resolution
  let layout = LAYOUTS.landscape;
  const deckPos = () => ({ x: center.x + layout.deck[0], z: center.z + layout.deck[1], heading: layout.deck[2] });
  const DECK_H = 0.38;
  const deckPose = (): Pose => {
    const d = deckPos();
    return { x: d.x, y: DECK_H + 0.03, z: d.z, heading: d.heading, flip: Math.PI };
  };
  // Discard pile: folded cards land here face down, slightly messy, one on top of the other.
  let muckCount = 0;
  const muckGoal = (slot: number): Goal => ({
    place: 'muck',
    up: false,
    value: null,
    x: center.x + layout.muck[0] + (hash(slot, 7, 1) - 0.5) * 0.7,
    y: 0.012 + slot * 0.014,
    z: center.z + layout.muck[1] + (hash(slot, 7, 2) - 0.5) * 0.6,
    heading: layout.muck[2] + (hash(slot, 7, 3) - 0.5) * 0.9,
  });
  /** Gap between collecting the old cards and dealing the new hand. */
  const DEAL_START = 760;
  let animating = false;

  // ── cards ──
  const frontGeo = cardFaceGeometry().rotateX(-Math.PI / 2);
  const backGeo = cardFaceGeometry().rotateX(Math.PI / 2);
  const coreGeo = new THREE.ExtrudeGeometry(cardShape(), { depth: THICK, bevelEnabled: false, curveSegments: 5 })
    .translate(0, 0, -THICK / 2)
    .rotateX(-Math.PI / 2);
  const coreMat = material({ color: 0xe6e0cf, roughness: 0.9 });
  const cardSurface: THREE.MeshPhysicalMaterialParameters = lite
    ? { roughness: 0.55 }
    : {
        roughness: 0.75,
        roughnessMap: canvasTexture(256, 256, drawSmudges, 1, 1, false),
        bumpMap: canvasTexture(128, 128, drawLinen, 9, 12.6, false),
        bumpScale: 0.25,
      };
  const cardCoat: THREE.MeshPhysicalMaterialParameters = { clearcoat: 0.18, clearcoatRoughness: 0.5, envMapIntensity: 0.9 };
  const TEX_W = 256 * res,
    TEX_H = 358 * res;
  const backTextures = Array.from({ length: lite ? 1 : 4 }, () => canvasTexture(TEX_W, TEX_H, drawBack, 1, 1));
  const faceTextures = new Map<string, THREE.CanvasTexture>();
  const faceKeyOf = (card: number) => `${card}:${opts.fourColor() ? 4 : 2}`;
  const faceTexture = (card: number) => {
    const key = faceKeyOf(card);
    let tex = faceTextures.get(key);
    if (!tex) {
      const suit = SUIT_NAMES[card & 3];
      const four = opts.fourColor();
      const color = suit === 'heart' ? RED : suit === 'diamond' ? (four ? BLUE : RED) : suit === 'club' && four ? GREEN : BLACK;
      tex = canvasTexture(TEX_W, TEX_H, drawFace(RANK_LABELS[card >> 2], suit, color), 1, 1);
      faceTextures.set(key, tex);
    }
    return tex;
  };

  const cards = new Map<string, Card3D>();
  function getCard(key: string): Card3D {
    const existing = cards.get(key);
    if (existing) return existing;
    const group = new THREE.Group();
    group.rotation.order = 'YZX'; // flip first (z), then orient (y)
    group.visible = false;
    // every card is yellowed a little differently
    const tone = new THREE.Color().setHSL(0.11, 0.25, 0.93 + Math.random() * 0.07);
    const frontMat = material({ ...cardSurface, color: tone }, cardCoat);
    const backMat = material({ ...cardSurface, color: tone, map: pick(backTextures) }, cardCoat);
    const front = solid(new THREE.Mesh(frontGeo, frontMat));
    front.position.y = THICK / 2 + 0.0008;
    const back = solid(new THREE.Mesh(backGeo, backMat));
    back.position.y = -THICK / 2 - 0.0008;
    group.add(front, back, solid(new THREE.Mesh(coreGeo, coreMat)));
    scene.add(group);
    const d = deckPos();
    const card: Card3D = {
      group,
      frontMat,
      value: null,
      faceKey: '',
      place: 'deck',
      muckSlot: 0,
      sig: '',
      queue: [],
      now: { x: d.x, y: DECK_H + 0.03, z: d.z, heading: d.heading, flip: Math.PI },
    };
    cards.set(key, card);
    return card;
  }
  const show = (card: Card3D, s: Pose) => {
    card.group.position.set(s.x, s.y, s.z);
    card.group.rotation.set(0, s.heading, s.flip);
  };
  function setFace(card: Card3D, value: number) {
    const key = faceKeyOf(value);
    if (card.value === value && card.faceKey === key) return;
    card.value = value;
    card.faceKey = key;
    card.frontMat.map = faceTexture(value);
    card.frontMat.needsUpdate = true;
  }

  // ── deck: individual, slightly shifted layers ──
  const deck = new THREE.Group();
  {
    const layers = 16,
      layerH = DECK_H / layers;
    const geo = new THREE.ExtrudeGeometry(cardShape(), { depth: layerH, bevelEnabled: false, curveSegments: 5 }).rotateX(-Math.PI / 2);
    const edges = [0xe9e4d4, 0xdcd6c4, 0xe3decd].map((color) => material({ color, roughness: 0.9 }));
    for (let i = 0; i < layers; i++) {
      const layer = solid(new THREE.Mesh(geo, edges[i % edges.length]));
      layer.position.set(rnd(0.02), i * layerH, rnd(0.02));
      layer.rotation.y = rnd(0.012);
      deck.add(layer);
    }
    const top = solid(new THREE.Mesh(frontGeo, material({ ...cardSurface, map: backTextures[0] }, cardCoat)));
    top.position.y = DECK_H + 0.002;
    deck.add(top);
    scene.add(deck);
  }

  // ── dealer button ──
  const button = (() => {
    const top = material({ roughness: 0.35, map: canvasTexture(256, 256, drawDealerButton, 1, 1) }, { clearcoat: 0.7, clearcoatRoughness: 0.25 });
    const side = material({ color: 0xece8dc, roughness: 0.4 }, { clearcoat: 0.5, clearcoatRoughness: 0.3 });
    const mesh = solid(new THREE.Mesh(new THREE.CylinderGeometry(0.88, 0.88, 0.2, 48), [side, top, side]));
    mesh.position.set(center.x, 0.1, center.z + 3);
    mesh.rotation.y = 0.5;
    mesh.visible = false;
    scene.add(mesh);
    return { mesh, target: null as [number, number] | null };
  })();

  // ── chips: one instanced mesh per value, refilled on every state change ──
  const CAPACITY = 420;
  const chipGeo = new THREE.CylinderGeometry(CHIP_R, CHIP_R, CHIP_H, lite ? 24 : 48, 1);
  const chipMeshes = DENOMS.map((def) => {
    const top = material({ roughness: 0.72, map: canvasTexture(128 * res, 128 * res, drawChipTop(def), 1, 1) });
    const side = material({ roughness: 0.68, map: canvasTexture(384, 32, drawChipSide(def), 1, 1) });
    const mesh = solid(new THREE.InstancedMesh(chipGeo, [side, top, top], CAPACITY));
    const shade = new THREE.Color();
    for (let i = 0; i < CAPACITY; i++) mesh.setColorAt(i, shade.setScalar(0.82 + Math.random() * 0.18));
    mesh.count = 0;
    mesh.frustumCulled = false;
    scene.add(mesh);
    return mesh;
  });
  const chipM = new THREE.Matrix4(),
    chipQ = new THREE.Quaternion(),
    chipP = new THREE.Vector3();
  const ONE = new THREE.Vector3(1, 1, 1),
    UP = new THREE.Vector3(0, 1, 0);
  let chipSig = '';

  // chips in flight travel from their source pile to their new place
  let prevPiles = new Map<number, PrevPile>();
  let flights: Flight[] = [];
  let currentPiles: Pile[] = [];

  // Where do chips come from that newly appear in a pile?
  //   bet <- own stack        pot <- collected bets
  //   stack <- pot (winnings) or own bet (returned)
  function sourcesFor(pile: Pile, byId: Map<number, Pile>): { x: number; z: number }[] | null {
    const prev = prevPiles.get(pile.id);
    if (!prevPiles.size || (prev && pile.amount <= prev.amount)) return null;
    const shrank = (id: number) => prevPiles.has(id) && (byId.get(id)?.amount ?? 0) < prevPiles.get(id)!.amount;
    if (pile.id === 99) {
      const bets = [...prevPiles.keys()].filter((id) => id !== 99 && id % 2 === 0 && shrank(id));
      return bets.length ? bets.map((id) => prevPiles.get(id)!) : null;
    }
    if (pile.id % 2 === 0) {
      const stack = prevPiles.get(pile.id - 1) ?? byId.get(pile.id - 1);
      return stack ? [stack] : null;
    }
    if (shrank(99)) return [prevPiles.get(99)!];
    if (shrank(pile.id + 1)) return [prevPiles.get(pile.id + 1)!];
    return null;
  }

  function layoutChips(piles: Pile[], now: number) {
    const used = DENOMS.map(() => 0);
    const byId = new Map(piles.map((pile) => [pile.id, pile]));
    const next = new Map<number, PrevPile>();
    flights = [];
    for (const pile of piles) {
      const counts = chipsFor(pile.amount);
      const before = prevPiles.get(pile.id)?.counts;
      const sources = sourcesFor(pile, byId);
      const placed = DENOMS.map(() => 0);
      const columns: [number, number][] = [];
      for (let d = DENOMS.length - 1; d >= 0; d--) {
        for (let left = counts[d]; left > 0; left -= 14) columns.push([d, Math.min(14, left)]);
      }
      const perRow = pile.perRow ?? 4,
        pitch = CHIP_R * 2 + 0.1;
      let launched = 0;
      columns.forEach(([d, n], c) => {
        const row = Math.floor(c / perRow),
          inRow = Math.min(perRow, columns.length - row * perRow);
        const u = ((c % perRow) - (inRow - 1) / 2) * pitch + (hash(pile.id, c, 1) - 0.5) * 0.08;
        const v = row * pitch + (hash(pile.id, c, 2) - 0.5) * 0.08;
        const bx = pile.x + pile.ax[0] * u + pile.ay[0] * v,
          bz = pile.z + pile.ax[1] * u + pile.ay[1] * v;
        const leanX = (hash(pile.id, c, 3) - 0.5) * 0.02,
          leanZ = (hash(pile.id, c, 4) - 0.5) * 0.02;
        for (let i = 0; i < n && used[d] < CAPACITY; i++) {
          chipP.set(bx + leanX * i + (hash(pile.id, c, 10 + i) - 0.5) * 0.05, CHIP_H / 2 + i * CHIP_H, bz + leanZ * i + (hash(pile.id, c, 40 + i) - 0.5) * 0.05);
          chipQ.setFromAxisAngle(UP, hash(pile.id, c, 70 + i) * Math.PI * 2);
          const index = used[d]++;
          // only chips that were not in this pile before fly in
          if (sources && placed[d]++ >= (before?.[d] ?? 0)) {
            const src = sources[launched % sources.length];
            const from = new THREE.Vector3(src.x + rnd(0.25), 0.3, src.z + rnd(0.25));
            flights.push({ d, index, from, to: chipP.clone(), quat: chipQ.clone(), start: now + launched * 16, dur: 420 + Math.random() * 120 });
            launched++;
            chipP.copy(from);
          }
          chipMeshes[d].setMatrixAt(index, chipM.compose(chipP, chipQ, ONE));
        }
      });
      next.set(pile.id, { x: pile.x, z: pile.z, amount: pile.amount, counts });
    }
    prevPiles = next;
    currentPiles = piles;
    if (flights.length) animating = true;
    chipMeshes.forEach((mesh, d) => {
      mesh.count = used[d];
      mesh.instanceMatrix.needsUpdate = true;
    });
  }

  // ── labels (HTML above the scene); a tap on a chip pile hides/shows them ──
  let labelsVisible = true;
  try {
    labelsVisible = localStorage.getItem(LABELS_KEY) !== '0';
  } catch {
    /* ignore */
  }
  labels.classList.toggle('hidden', !labelsVisible);
  const tapPoint = new THREE.Vector3();
  function tapChips(x: number, y: number, camera: THREE.Camera, w: number, h: number) {
    const hit = currentPiles.some((pile) => {
      tapPoint.set(pile.x, 0.5, pile.z).project(camera);
      return Math.hypot(((tapPoint.x + 1) / 2) * w - x, ((1 - tapPoint.y) / 2) * h - y) < 38;
    });
    if (!hit) return false;
    labelsVisible = !labelsVisible;
    labels.classList.toggle('hidden', !labelsVisible);
    try {
      localStorage.setItem(LABELS_KEY, labelsVisible ? '1' : '0');
    } catch {
      /* ignore */
    }
    return true;
  }

  const labelEls = new Map<string, { el: HTMLElement; anchor: [number, number, number]; seen: boolean }>();
  function label(id: string, cls: string) {
    let entry = labelEls.get(id);
    if (!entry) {
      const el = document.createElement('div');
      el.className = cls;
      labels.appendChild(el);
      entry = { el, anchor: [0, 0, 0], seen: true };
      labelEls.set(id, entry);
    }
    entry.seen = true;
    return entry;
  }

  // ── apply a game snapshot ──
  let tableSig = '';
  let seats = new Map<string, SeatGeo>();

  function seatGeometry(view: TableView) {
    const n = view.players.length;
    const hero = Math.max(
      0,
      view.players.findIndex((p) => p.id === view.viewerId),
    );
    const slots = SLOTS[Math.min(8, Math.max(2, n))];
    const map = new Map<string, SeatGeo>();
    view.players.forEach((p, i) => {
      const a = layout.angles[slots[(i - hero + n) % n]] * DEG;
      const radial: [number, number] = [Math.cos(a), Math.sin(a)],
        tangent: [number, number] = [-Math.sin(a), Math.cos(a)];
      map.set(p.id, { x: center.x + layout.rx * radial[0], z: center.z + layout.rz * radial[1], heading: a - Math.PI / 2, radial, tangent });
    });
    return map;
  }

  /** Plan the movement(s) for a card; replaces anything still pending. */
  function plan(card: Card3D, steps: Step[]) {
    card.queue = steps;
    card.group.visible = true;
    animating = true;
  }

  function aim(card: Card3D, goal: Goal, delay: number, now: number) {
    if (goal.value != null) setFace(card, goal.value);
    // a card that is not on the table has nothing to throw away
    if ((goal.place === 'deck' || goal.place === 'muck') && card.place === 'deck') {
      card.sig = `deck|${goal.place}`;
      return;
    }
    const sig = `${goal.place}|${goal.up}|${goal.x.toFixed(2)}|${goal.z.toFixed(2)}`;
    if (sig === card.sig) return;
    const wasPlace = card.place;
    card.sig = sig;
    card.place = goal.place;
    const at = now + delay;
    const flip = goal.up ? 0 : Math.PI;
    const pos = { x: goal.x, y: goal.y, z: goal.z, heading: goal.heading };
    if (goal.place === 'deck') {
      plan(card, [{ at, dur: 380, to: { ...pos, flip: Math.PI }, arc: 0.5, ease: easeOut, hide: true }]);
    } else if (goal.place === 'muck') {
      // thrown away face down onto the discard pile – never back onto the deck
      plan(card, [{ at, dur: 420, to: { ...pos, flip: Math.PI }, arc: 0.6, ease: easeOut, spin: (hash(card.muckSlot, 3, 3) - 0.5) * 1.2 }]);
    } else if (wasPlace === 'deck') {
      // dealt face down (spinning in flight), then turned over if needed
      const steps: Step[] = [{ at, dur: 480, to: { ...pos, flip: Math.PI }, arc: 0.7, ease: easeOut, spin: Math.PI * 2, show: true }];
      if (goal.up) steps.push({ at: null, dur: 420, to: { ...pos, flip }, arc: 1.25, ease: easeInOut });
      if (card.queue.length) {
        // the card is still being collected from the last hand: deal it afterwards
        card.queue.push(...steps);
        animating = true;
      } else plan(card, steps);
    } else {
      const turning = Math.abs(card.now.flip - flip) > 0.1;
      plan(card, [{ at, dur: 420, to: { ...pos, flip }, arc: turning ? 1.25 : 0.25, ease: easeInOut }]);
    }
  }

  function toMuck(card: Card3D, now: number) {
    if (card.place !== 'muck' && card.place !== 'deck') card.muckSlot = muckCount++;
    aim(card, muckGoal(card.muckSlot), 0, now);
  }

  /**
   * New hand: every card of the last hand is swept onto the discard pile, then
   * the pile goes back under the deck (shuffled in) before the new cards are dealt.
   */
  function collectAll(now: number) {
    const home = deckPose();
    for (const card of cards.values()) {
      if (card.place === 'deck') continue;
      const steps: Step[] = [];
      let gatherAt: number | null = now + 420;
      if (card.place !== 'muck') {
        card.muckSlot = muckCount++;
        const g = muckGoal(card.muckSlot);
        steps.push({ at: now, dur: 420, to: { x: g.x, y: g.y, z: g.z, heading: g.heading, flip: Math.PI }, arc: 0.6, ease: easeOut });
        gatherAt = null;
      }
      steps.push({ at: gatherAt, dur: 300, to: { ...home, y: DECK_H - 0.1 }, arc: 0.3, ease: easeInOut, hide: true, jumpTo: home });
      plan(card, steps);
      card.place = 'deck';
      card.sig = '';
    }
    muckCount = 0;
  }

  function seatLabelHtml(p: PlayerView, snap: GameSnapshot, handKey: CategoryKey | null, tx: LabelText) {
    const role = p.isButton ? 'D' : p.isSmallBlind ? 'SB' : p.isBigBlind ? 'BB' : '';
    const action = p.eliminated
      ? tx.out
      : handKey
        ? tx.hand(handKey)
        : snap.thinkingId === p.id
          ? '…'
          : p.allIn
            ? tx.allIn
            : p.lastAction
              ? tx.action(p.lastAction.type)
              : '';
    return (
      `<b>${escapeHtml(p.name)}${role ? `<i>${role}</i>` : ''}</b>` +
      `<span>${p.eliminated ? '–' : tx.money(p.stack)}</span>${action ? `<em>${escapeHtml(action)}</em>` : ''}`
    );
  }

  let lastSnap: GameSnapshot | null = null;
  let lastAspect = 1;

  function setSnapshot(snap: GameSnapshot, aspect: number) {
    lastSnap = snap;
    lastAspect = aspect;
    const view = snap.view;
    const tx = opts.text();
    const now = performance.now();
    const next = aspect < 0.9 ? LAYOUTS.portrait : LAYOUTS.landscape;
    const sig = view.players.map((p) => p.id).join(',') + (next === LAYOUTS.portrait ? 'p' : 'l');
    if (sig !== tableSig || next !== layout) {
      layout = next;
      tableSig = sig;
      seats = seatGeometry(view);
      chipSig = '';
      prevPiles = new Map(); // new table or rotated screen: chips placed without flight
    }
    const d = deckPos();
    deck.position.set(d.x, 0, d.z);
    deck.rotation.y = d.heading;
    const inDeck: Goal = { place: 'deck', up: false, x: d.x, y: DECK_H + 0.03, z: d.z, heading: d.heading, value: null };

    // dealing order: clockwise from the seat left of the button
    const dealing = snap.events.some((e) => e.type === 'dealHole');
    if (dealing) collectAll(now);
    const dealStart = dealing ? DEAL_START : 0;
    const inHand = view.players.filter((p) => p.holeCards.length === 2 && !p.eliminated);
    const first = inHand.findIndex((p) => p.isSmallBlind);
    const dealOrder = new Map(inHand.map((p, i) => [p.id, (i - Math.max(0, first) + inHand.length) % inHand.length]));

    for (const p of view.players) {
      const seat = seats.get(p.id)!;
      for (let i = 0; i < 2; i++) {
        const card = getCard(`h${p.id}:${i}`);
        // folded (or no longer dealt in): onto the discard pile. A busted player's
        // cards stay visible until the next hand.
        if (p.holeCards.length !== 2 || p.folded) {
          toMuck(card, now);
          continue;
        }
        const value = p.holeCards[i],
          up = value != null;
        const side = i === 0 ? -1 : 1,
          spread = up ? 1.0 : 0.42;
        aim(
          card,
          {
            place: 'seat',
            up,
            value,
            x: seat.x + Math.cos(seat.heading) * side * spread,
            z: seat.z - Math.sin(seat.heading) * side * spread,
            y: 0.012 + i * 0.016,
            heading: seat.heading + side * (up ? 0.07 : 0.12),
          },
          dealing ? dealStart + (i * inHand.length + (dealOrder.get(p.id) ?? 0)) * 110 : 0,
          now,
        );
      }
    }
    const boardEvent = snap.events.find((e) => e.type === 'board');
    for (let i = 0; i < 5; i++) {
      const card = getCard(`b${i}`);
      const value = view.board[i];
      if (value == null) {
        if (card.place === 'muck') toMuck(card, now);
        else aim(card, inDeck, 0, now);
        continue;
      }
      const fresh = boardEvent && boardEvent.type === 'board' ? Math.max(0, boardEvent.cards.indexOf(value)) : 0;
      aim(
        card,
        { place: 'board', up: true, value, x: center.x + (i - 2) * (CARD_W + 0.24), z: center.z - 0.6, y: 0.012, heading: (hash(value, i, 5) - 0.5) * 0.06 },
        fresh * 170,
        now,
      );
    }

    // dealer button
    const dealer = view.players.find((p) => p.isButton && !p.eliminated);
    if (dealer) {
      const s = seats.get(dealer.id)!;
      // beside the dealer's cards – on the side facing away from the own seat,
      // so the button never lands on the player's cards
      const at = (sign: number): [number, number] => [s.x - s.radial[0] * 1.2 - sign * s.tangent[0] * 2.7, s.z - s.radial[1] * 1.2 - sign * s.tangent[1] * 2.7];
      const hero = seats.get(view.viewerId ?? '');
      let spot = at(1);
      if (hero && dealer.id !== view.viewerId) {
        const other = at(-1);
        if (Math.hypot(other[0] - hero.x, other[1] - hero.z) > Math.hypot(spot[0] - hero.x, spot[1] - hero.z)) spot = other;
      }
      button.target = spot;
      if (!button.mesh.visible) {
        button.mesh.visible = true;
        button.mesh.position.set(button.target[0], 0.1, button.target[1]);
      }
      animating = true;
    }

    // chips: stacks behind the cards, bets in front, pot in the middle
    const piles: Pile[] = [];
    const potChips = view.pots.reduce((sum, pot) => sum + pot.amount, 0);
    view.players.forEach((p, i) => {
      if (p.eliminated) return;
      const s = seats.get(p.id)!;
      if (p.stack > 0) piles.push({ id: i * 2 + 1, amount: p.stack, x: s.x + s.radial[0] * 3.0, z: s.z + s.radial[1] * 3.0, ax: s.tangent, ay: s.radial });
      if (p.bet > 0) {
        piles.push({ id: i * 2 + 2, amount: p.bet, perRow: 3, x: s.x - s.radial[0] * 2.3, z: s.z - s.radial[1] * 2.3, ax: s.tangent, ay: [-s.radial[0], -s.radial[1]] });
      }
    });
    if (potChips > 0) piles.push({ id: 99, amount: potChips, perRow: 5, x: center.x, z: center.z + layout.potZ, ax: [1, 0], ay: [0, 1] });
    const nextChipSig = piles.map((p) => `${p.id}:${p.amount}`).join(',');
    if (nextChipSig !== chipSig) {
      chipSig = nextChipSig;
      layoutChips(piles, now);
    }

    // labels
    for (const entry of labelEls.values()) entry.seen = false;
    const done = view.phase === 'handComplete' || view.phase === 'tournamentComplete';
    const result = done ? view.lastResult : null;
    const winners = new Set(result ? result.pots.flatMap((pot) => pot.winners.map((w) => w.playerId)) : []);
    for (const p of view.players) {
      const s = seats.get(p.id)!;
      const seat = label(`seat:${p.id}`, 'seat3d');
      seat.anchor = [s.x + s.radial[0] * 4.5, 0.6, s.z + s.radial[1] * 4.5];
      const handKey = result?.showdown && !p.folded && !p.eliminated ? (result.hands[p.id]?.key ?? null) : null;
      seat.el.className =
        'seat3d' +
        (p.isToAct ? ' to-act' : '') +
        (p.folded ? ' folded' : '') +
        (p.eliminated ? ' out' : '') +
        (winners.has(p.id) ? ' winner' : '') +
        (p.id === view.viewerId ? ' hero' : '');
      const html = seatLabelHtml(p, snap, handKey, tx);
      if (seat.el.innerHTML !== html) seat.el.innerHTML = html;
      if (p.bet > 0 && !p.eliminated) {
        const bet = label(`bet:${p.id}`, 'bet3d');
        bet.anchor = [s.x - s.radial[0] * 3.6, 0.3, s.z - s.radial[1] * 3.6];
        bet.el.textContent = tx.money(p.bet);
      }
    }
    if (view.potTotal > 0) {
      const pot = label('pot', 'pot3d');
      pot.anchor = [center.x, 0.5, center.z + layout.potZ + 1.6];
      pot.el.textContent = `${tx.pot} ${tx.money(view.potTotal)}`;
    }
    for (const [id, entry] of labelEls) {
      if (entry.seen) continue;
      entry.el.remove();
      labelEls.delete(id);
    }
  }

  const projected = new THREE.Vector3();
  function layoutLabels(camera: THREE.Camera, w: number, h: number) {
    for (const { el, anchor } of labelEls.values()) {
      projected.set(anchor[0], anchor[1], anchor[2]).project(camera);
      const x = ((projected.x + 1) / 2) * w,
        y = ((1 - projected.y) / 2) * h;
      el.style.transform = `translate(-50%, -50%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      el.style.visibility = projected.z < 1 ? 'visible' : 'hidden';
    }
  }

  function update(now: number) {
    if (!animating) return false;
    let active = false;
    for (const card of cards.values()) {
      const step = card.queue[0];
      if (!step) continue;
      active = true;
      if (step.at == null) step.at = now;
      if (now < step.at) continue;
      if (!step.from) {
        step.from = { ...card.now };
        if (step.show) card.group.visible = true;
      }
      const raw = Math.min(1, (now - step.at) / step.dur);
      const k = step.ease(raw),
        s = card.now;
      s.x = step.from.x + (step.to.x - step.from.x) * k;
      s.y = step.from.y + (step.to.y - step.from.y) * k;
      s.z = step.from.z + (step.to.z - step.from.z) * k;
      s.flip = step.from.flip + (step.to.flip - step.from.flip) * k;
      s.heading = step.from.heading + (step.to.heading - step.from.heading + (step.spin ?? 0)) * k;
      show(card, { ...s, y: s.y + step.arc * Math.sin(Math.PI * raw) });
      if (raw >= 1) {
        s.heading = step.to.heading;
        if (step.hide) card.group.visible = false;
        if (step.jumpTo) Object.assign(s, step.jumpTo);
        card.queue.shift();
      }
    }
    if (flights.length) {
      active = true;
      const touched = new Set<number>();
      flights = flights.filter((f) => {
        if (now < f.start) return true;
        const raw = Math.min(1, (now - f.start) / f.dur),
          k = easeOut(raw);
        chipP.lerpVectors(f.from, f.to, k);
        chipP.y += 0.9 * Math.sin(Math.PI * raw);
        chipMeshes[f.d].setMatrixAt(f.index, chipM.compose(chipP, f.quat, ONE));
        touched.add(f.d);
        return raw < 1;
      });
      for (const d of touched) chipMeshes[d].instanceMatrix.needsUpdate = true;
    }
    if (button.target) {
      const p = button.mesh.position;
      const dx = button.target[0] - p.x,
        dz = button.target[1] - p.z;
      if (Math.abs(dx) + Math.abs(dz) > 0.01) {
        p.x += dx * 0.14;
        p.z += dz * 0.14;
        active = true;
      }
    }
    animating = active;
    return true;
  }

  function refreshFaces() {
    for (const card of cards.values()) if (card.value != null) setFace(card, card.value);
    if (lastSnap) setSnapshot({ ...lastSnap, events: [] }, lastAspect);
  }

  return { setSnapshot, update, layoutLabels, tapChips, refreshFaces };
}

function escapeHtml(text: string) {
  return String(text).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}
