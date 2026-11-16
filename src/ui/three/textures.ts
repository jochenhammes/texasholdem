// Canvas drawings for the 3D table: playing cards, chips, felt and wood.
// Everything is painted procedurally – no image files to load.

export type Ctx = CanvasRenderingContext2D;
export type Painter = (g: Ctx, w: number, h: number) => void;
export type SuitName = 'club' | 'diamond' | 'heart' | 'spade';

export const RED = '#b9121f';
export const BLACK = '#18181c';
export const BLUE = '#1f4fbf';
export const GREEN = '#17803d';
export const GOLD = '#c39a2c';
const SERIF = 'Georgia, "Times New Roman", serif';

export const rnd = (range: number) => (Math.random() - 0.5) * 2 * range;

// ───────────────────────────── cards ─────────────────────────────

export function drawSuit(g: Ctx, suit: SuitName, cx: number, cy: number, size: number, flip = false) {
  g.save();
  g.translate(cx, cy);
  if (flip) g.rotate(Math.PI);
  g.scale(size, size);
  g.beginPath();
  if (suit === 'heart') {
    g.moveTo(0, 0.5);
    g.bezierCurveTo(-0.75, -0.05, -0.45, -0.6, 0, -0.25);
    g.bezierCurveTo(0.45, -0.6, 0.75, -0.05, 0, 0.5);
  } else if (suit === 'diamond') {
    g.moveTo(0, -0.5);
    g.quadraticCurveTo(0.14, -0.2, 0.37, 0);
    g.quadraticCurveTo(0.14, 0.2, 0, 0.5);
    g.quadraticCurveTo(-0.14, 0.2, -0.37, 0);
    g.quadraticCurveTo(-0.14, -0.2, 0, -0.5);
  } else if (suit === 'spade') {
    g.moveTo(0, -0.5);
    g.bezierCurveTo(-0.75, 0.05, -0.45, 0.6, 0, 0.22);
    g.bezierCurveTo(0.45, 0.6, 0.75, 0.05, 0, -0.5);
    g.moveTo(0, 0.1);
    g.quadraticCurveTo(-0.02, 0.4, -0.19, 0.5);
    g.lineTo(0.19, 0.5);
    g.quadraticCurveTo(0.02, 0.4, 0, 0.1);
  } else {
    for (const [x, y] of [
      [0, -0.25],
      [-0.23, 0.08],
      [0.23, 0.08],
    ]) {
      g.moveTo(x + 0.22, y);
      g.arc(x, y, 0.22, 0, Math.PI * 2);
    }
    g.moveTo(0, -0.02);
    g.quadraticCurveTo(-0.02, 0.4, -0.18, 0.5);
    g.lineTo(0.18, 0.5);
    g.quadraticCurveTo(0.02, 0.4, 0, -0.02);
  }
  g.closePath();
  g.fill();
  g.restore();
}

/** Paper: slightly creamy, fine grain, linen embossing. */
function drawPaper(g: Ctx, w: number, h: number) {
  g.fillStyle = '#f8f5ea';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = `rgba(${Math.random() < 0.5 ? '120,100,60' : '255,255,255'},${Math.random() * 0.05})`;
    g.fillRect(Math.random() * w, Math.random() * h, 1.2, 1.2);
  }
  g.strokeStyle = 'rgba(90,70,40,0.022)';
  g.lineWidth = 0.5;
  g.beginPath();
  for (let x = 0; x < w; x += 2.5) {
    g.moveTo(x, 0);
    g.lineTo(x, h);
  }
  for (let y = 0; y < h; y += 2.5) {
    g.moveTo(0, y);
    g.lineTo(w, y);
  }
  g.stroke();
}

/** Signs of use: worn, slightly dirty edges and corners, fine creases. */
function drawCardWear(g: Ctx, w: number, h: number, dirt = 1) {
  const edge = 12;
  for (const [x0, y0, x1, y1] of [
    [0, 0, edge, 0],
    [w, 0, w - edge, 0],
    [0, 0, 0, edge],
    [0, h, 0, h - edge],
  ]) {
    const grad = g.createLinearGradient(x0, y0, x1, y1);
    grad.addColorStop(0, `rgba(96,72,38,${0.2 * dirt})`);
    grad.addColorStop(1, 'rgba(96,72,38,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  }
  for (const [cx, cy] of [
    [0, 0],
    [w, 0],
    [0, h],
    [w, h],
  ]) {
    const r = 18 + Math.random() * 22;
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, `rgba(84,62,34,${(0.16 + Math.random() * 0.2) * dirt})`);
    grad.addColorStop(1, 'rgba(84,62,34,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  }
  for (let i = 0; i < 4; i++) {
    const x = Math.random() * w,
      y = Math.random() * h,
      r = 20 + Math.random() * 45;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(90,70,45,${0.05 * dirt})`);
    grad.addColorStop(1, 'rgba(90,70,45,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  }
  for (let i = 0; i < 5; i++) {
    const x = Math.random() * w,
      y = Math.random() * h,
      a = Math.random() * Math.PI,
      len = 20 + Math.random() * 90;
    g.strokeStyle = `rgba(60,45,25,${0.05 + Math.random() * 0.06})`;
    g.lineWidth = 0.6;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    g.stroke();
  }
  g.strokeStyle = 'rgba(40,30,15,0.28)';
  g.lineWidth = 1.6;
  g.strokeRect(0, 0, w, h);
}

const PIPS: Record<string, [number, number][]> = {
  '2': [[0.5, 0.2], [0.5, 0.8]],
  '3': [[0.5, 0.2], [0.5, 0.5], [0.5, 0.8]],
  '4': [[0.3, 0.2], [0.7, 0.2], [0.3, 0.8], [0.7, 0.8]],
  '5': [[0.3, 0.2], [0.7, 0.2], [0.5, 0.5], [0.3, 0.8], [0.7, 0.8]],
  '6': [[0.3, 0.2], [0.7, 0.2], [0.3, 0.5], [0.7, 0.5], [0.3, 0.8], [0.7, 0.8]],
  '7': [[0.3, 0.2], [0.7, 0.2], [0.5, 0.35], [0.3, 0.5], [0.7, 0.5], [0.3, 0.8], [0.7, 0.8]],
  '8': [[0.3, 0.2], [0.7, 0.2], [0.5, 0.35], [0.3, 0.5], [0.7, 0.5], [0.5, 0.65], [0.3, 0.8], [0.7, 0.8]],
  '9': [[0.3, 0.2], [0.7, 0.2], [0.3, 0.4], [0.7, 0.4], [0.5, 0.5], [0.3, 0.6], [0.7, 0.6], [0.3, 0.8], [0.7, 0.8]],
  '10': [[0.3, 0.2], [0.7, 0.2], [0.5, 0.3], [0.3, 0.4], [0.7, 0.4], [0.3, 0.6], [0.7, 0.6], [0.5, 0.7], [0.3, 0.8], [0.7, 0.8]],
};

/** Court card: framed, point-symmetric field with lozenge pattern, crown and letter. */
function drawCourt(g: Ctx, w: number, h: number, rank: string, suit: SuitName, color: string) {
  const x0 = w * 0.235,
    y0 = h * 0.135,
    fw = w * 0.53,
    fh = h * 0.73;
  const warm = color === RED;
  g.save();
  g.beginPath();
  g.rect(x0, y0, fw, fh);
  g.clip();
  g.fillStyle = warm ? '#f6e3d6' : '#e6e6ee';
  g.fillRect(x0, y0, fw, fh);
  g.lineWidth = 1;
  for (let d = -fh; d < fw + fh; d += 13) {
    g.strokeStyle = 'rgba(195,154,44,0.55)';
    g.beginPath();
    g.moveTo(x0 + d, y0);
    g.lineTo(x0 + d + fh, y0 + fh);
    g.stroke();
    g.strokeStyle = warm ? 'rgba(185,18,31,0.28)' : 'rgba(24,24,40,0.28)';
    g.beginPath();
    g.moveTo(x0 + d, y0);
    g.lineTo(x0 + d - fh, y0 + fh);
    g.stroke();
  }
  g.save();
  g.translate(w / 2, h / 2);
  g.rotate(-0.62);
  g.fillStyle = color;
  g.fillRect(-fh, -9, fh * 2, 18);
  g.fillStyle = GOLD;
  g.fillRect(-fh, -5.5, fh * 2, 2);
  g.fillRect(-fh, 3.5, fh * 2, 2);
  g.restore();
  for (const turn of [0, Math.PI]) {
    g.save();
    g.translate(w / 2, h / 2);
    g.rotate(turn);
    const cy = -fh * 0.25;
    g.fillStyle = '#fbf8ee';
    g.strokeStyle = color;
    g.lineWidth = 2;
    g.beginPath();
    g.ellipse(0, cy, 37, 45, 0, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.strokeStyle = GOLD;
    g.lineWidth = 1.2;
    g.beginPath();
    g.ellipse(0, cy, 32, 40, 0, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = color;
    g.font = `bold 58px ${SERIF}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(rank, 0, cy + 9);
    // crown (king: five spikes, queen: three, jack: a feather)
    g.fillStyle = GOLD;
    g.strokeStyle = 'rgba(90,60,10,0.8)';
    g.lineWidth = 0.8;
    g.beginPath();
    if (rank === 'J') {
      g.moveTo(-3, cy - 20);
      g.quadraticCurveTo(-16, cy - 34, 2, cy - 43);
      g.quadraticCurveTo(12, cy - 32, 3, cy - 20);
    } else {
      const spikes = rank === 'K' ? 5 : 3,
        half = 17;
      g.moveTo(-half, cy - 21);
      for (let i = 0; i < spikes; i++) {
        const xa = -half + (i / spikes) * half * 2,
          xb = -half + ((i + 1) / spikes) * half * 2;
        g.lineTo((xa + xb) / 2, cy - 38 - (i === Math.floor(spikes / 2) ? 4 : 0));
        g.lineTo(xb, cy - 27);
      }
      g.lineTo(half, cy - 21);
    }
    g.closePath();
    g.fill();
    g.stroke();
    g.fillStyle = color;
    drawSuit(g, suit, -fw / 2 + 17, -fh / 2 + 20, 24);
    g.restore();
  }
  g.restore();
  g.strokeStyle = color;
  g.lineWidth = 2.2;
  g.strokeRect(x0, y0, fw, fh);
  g.strokeStyle = GOLD;
  g.lineWidth = 1;
  g.strokeRect(x0 + 4, y0 + 4, fw - 8, fh - 8);
}

export function drawFace(rank: string, suit: SuitName, color: string): Painter {
  return (g, W, H) => {
    g.scale(W / 256, H / 358);
    const w = 256,
      h = 358;
    drawPaper(g, w, h);
    g.fillStyle = color;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // corner indices top left and (rotated) bottom right
    for (const turn of [0, Math.PI]) {
      g.save();
      g.translate(w / 2, h / 2);
      g.rotate(turn);
      g.translate(-w / 2, -h / 2);
      g.font = `bold ${rank === '10' ? 37 : 43}px ${SERIF}`;
      if (rank === '10') {
        g.save();
        g.translate(27, 40);
        g.scale(0.82, 1);
        g.fillText('10', 0, 0);
        g.restore();
      } else {
        g.fillText(rank, 27, 40);
      }
      drawSuit(g, suit, 27, 81, 27);
      g.restore();
    }
    if (rank === 'A') {
      drawSuit(g, suit, w / 2, h / 2, suit === 'spade' ? 150 : 118);
      if (suit === 'spade') {
        g.fillStyle = '#f8f5ea';
        drawSuit(g, 'spade', w / 2, h / 2 - 4, 58);
        g.fillStyle = color;
        drawSuit(g, 'spade', w / 2, h / 2 - 4, 30);
      }
    } else if (PIPS[rank]) {
      for (const [x, y] of PIPS[rank]) drawSuit(g, suit, x * w, y * h, 50, y > 0.5);
    } else {
      drawCourt(g, w, h, rank, suit, color);
    }
    drawCardWear(g, w, h);
  };
}

export const drawBack: Painter = (g, W, H) => {
  g.scale(W / 256, H / 358);
  const w = 256,
    h = 358,
    m = 14;
  drawPaper(g, w, h);
  g.fillStyle = '#8e1220';
  g.fillRect(m, m, w - 2 * m, h - 2 * m);
  g.save();
  g.beginPath();
  g.rect(m, m, w - 2 * m, h - 2 * m);
  g.clip();
  g.strokeStyle = 'rgba(255,240,225,0.45)';
  g.lineWidth = 1.1;
  for (let d = -h; d < w + h; d += 11) {
    g.beginPath();
    g.moveTo(d, 0);
    g.lineTo(d + h, h);
    g.moveTo(d, 0);
    g.lineTo(d - h, h);
    g.stroke();
  }
  g.translate(w / 2, h / 2);
  g.fillStyle = '#8e1220';
  g.strokeStyle = 'rgba(255,240,225,0.85)';
  g.lineWidth = 2;
  g.beginPath();
  g.ellipse(0, 0, 50, 68, 0, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.lineWidth = 1;
  for (let i = 0; i < 12; i++) {
    g.rotate(Math.PI / 6);
    g.beginPath();
    g.ellipse(0, -30, 9, 26, 0, 0, Math.PI * 2);
    g.stroke();
  }
  g.fillStyle = 'rgba(255,240,225,0.9)';
  drawSuit(g, 'diamond', 0, 0, 22);
  g.restore();
  g.strokeStyle = 'rgba(255,240,225,0.8)';
  g.lineWidth = 2.2;
  g.strokeRect(m + 6, m + 6, w - 2 * m - 12, h - 2 * m - 12);
  g.lineWidth = 0.8;
  g.strokeRect(m + 10, m + 10, w - 2 * m - 20, h - 2 * m - 20);
  // worn paint: light spots at edges and corners, fine scratches
  for (let i = 0; i < 160; i++) {
    const side = Math.floor(Math.random() * 4),
      along = Math.random();
    const depth = m + Math.random() * Math.random() * 16;
    const x = side < 2 ? along * w : side === 2 ? depth : w - depth;
    const y = side < 2 ? (side === 0 ? depth : h - depth) : along * h;
    g.fillStyle = `rgba(248,240,225,${0.25 + Math.random() * 0.45})`;
    g.fillRect(x, y, 0.8 + Math.random() * 2.2, 0.8 + Math.random() * 1.6);
  }
  for (let i = 0; i < 9; i++) {
    const x = Math.random() * w,
      y = Math.random() * h,
      a = Math.random() * Math.PI,
      len = 15 + Math.random() * 70;
    g.strokeStyle = `rgba(255,245,230,${0.08 + Math.random() * 0.12})`;
    g.lineWidth = 0.6;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    g.stroke();
  }
  drawCardWear(g, w, h, 0.7);
};

/** Linen embossing (height map). */
export const drawLinen: Painter = (g, w, h) => {
  g.fillStyle = '#808080';
  g.fillRect(0, 0, w, h);
  g.lineWidth = 1;
  for (let i = 0; i < w; i += 4) {
    g.strokeStyle = 'rgba(255,255,255,0.5)';
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i, h);
    g.moveTo(0, i);
    g.lineTo(w, i);
    g.stroke();
    g.strokeStyle = 'rgba(0,0,0,0.5)';
    g.beginPath();
    g.moveTo(i + 2, 0);
    g.lineTo(i + 2, h);
    g.moveTo(0, i + 2);
    g.lineTo(w, i + 2);
    g.stroke();
  }
};

/** Uneven gloss from fingerprints (roughness map). */
export const drawSmudges: Painter = (g, w, h) => {
  g.fillStyle = 'rgb(170,170,170)';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 14; i++) {
    const x = Math.random() * w,
      y = Math.random() * h,
      r = w * (0.08 + Math.random() * 0.2);
    const v = Math.random() < 0.6 ? 255 : 70;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(${v},${v},${v},${0.2 + Math.random() * 0.3})`);
    grad.addColorStop(1, `rgba(${v},${v},${v},0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  }
};

// ───────────────────────────── chips ─────────────────────────────

export interface Denom {
  value: number;
  base: string;
  insert: string;
  text: string;
}

/** Chip values (every amount in the engine is a multiple of 5). */
export const DENOMS: Denom[] = [
  { value: 5, base: '#a81c26', insert: '#efe9da', text: '#a81c26' },
  { value: 25, base: '#1b6b3e', insert: '#efe9da', text: '#1b6b3e' },
  { value: 100, base: '#1b1b1f', insert: '#efe9da', text: '#1b1b1f' },
  { value: 500, base: '#55287f', insert: '#efe9da', text: '#55287f' },
  { value: 1000, base: '#c39618', insert: '#2b2416', text: '#6b4f08' },
  { value: 5000, base: '#bd5716', insert: '#efe9da', text: '#8a3c0b' },
];

export function speckle(g: Ctx, w: number, h: number, count: number, alpha: number) {
  for (let i = 0; i < count; i++) {
    g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},${Math.random() * alpha})`;
    g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5);
  }
}

export function drawChipTop(def: Denom): Painter {
  return (g, w) => {
    const c = w / 2,
      R = w / 2;
    g.fillStyle = def.base;
    g.fillRect(0, 0, w, w);
    speckle(g, w, w, 1800, 0.09);
    // six edge inserts, aligned with the stripes on the rim
    g.fillStyle = def.insert;
    for (let k = 0; k < 6; k++) {
      const a = (k * Math.PI) / 3,
        half = 0.2;
      g.beginPath();
      g.arc(c, c, R, a - half, a + half);
      g.arc(c, c, R * 0.77, a + half, a - half, true);
      g.closePath();
      g.fill();
    }
    g.strokeStyle = 'rgba(0,0,0,0.38)';
    g.lineWidth = w * 0.012;
    g.beginPath();
    g.arc(c, c, R * 0.76, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.16)';
    g.lineWidth = w * 0.008;
    g.beginPath();
    g.arc(c, c, R * 0.735, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([w * 0.016, w * 0.03]);
    g.strokeStyle = 'rgba(255,255,255,0.4)';
    g.lineWidth = w * 0.016;
    g.beginPath();
    g.arc(c, c, R * 0.655, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = '#efe9da';
    g.beginPath();
    g.arc(c, c, R * 0.55, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = def.text;
    g.lineWidth = w * 0.014;
    g.beginPath();
    g.arc(c, c, R * 0.47, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = def.text;
    const text = String(def.value);
    g.font = `bold ${w * (text.length > 3 ? 0.19 : text.length > 2 ? 0.23 : 0.3)}px ${SERIF}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, c, c + w * 0.015);
    const grime = g.createRadialGradient(c, c, R * 0.3, c, c, R * 0.57);
    grime.addColorStop(0, 'rgba(80,60,30,0)');
    grime.addColorStop(1, 'rgba(80,60,30,0.2)');
    g.fillStyle = grime;
    g.beginPath();
    g.arc(c, c, R * 0.55, 0, Math.PI * 2);
    g.fill();
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2,
        r = R * (0.2 + Math.random() * 0.75),
        len = 0.15 + Math.random() * 0.5;
      g.strokeStyle = `rgba(255,255,255,${0.05 + Math.random() * 0.1})`;
      g.lineWidth = 0.8;
      g.beginPath();
      g.arc(c + rnd(6), c + rnd(6), r, a, a + len);
      g.stroke();
    }
    const rim = g.createRadialGradient(c, c, R * 0.9, c, c, R);
    rim.addColorStop(0, 'rgba(255,255,255,0)');
    rim.addColorStop(0.7, 'rgba(255,255,255,0.12)');
    rim.addColorStop(1, 'rgba(0,0,0,0.35)');
    g.fillStyle = rim;
    g.fillRect(0, 0, w, w);
  };
}

export function drawChipSide(def: Denom): Painter {
  return (g, w, h) => {
    g.fillStyle = def.base;
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, 500, 0.1);
    g.fillStyle = def.insert;
    const half = (0.2 / (Math.PI * 2)) * w;
    for (let k = 0; k <= 6; k++) g.fillRect((k / 6) * w - half, 0, half * 2, h);
    // rounded edges: darker top and bottom, a glossy stripe in the middle
    const shade = g.createLinearGradient(0, 0, 0, h);
    shade.addColorStop(0, 'rgba(0,0,0,0.55)');
    shade.addColorStop(0.22, 'rgba(0,0,0,0)');
    shade.addColorStop(0.5, 'rgba(255,255,255,0.1)');
    shade.addColorStop(0.78, 'rgba(0,0,0,0)');
    shade.addColorStop(1, 'rgba(0,0,0,0.6)');
    g.fillStyle = shade;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 30; i++) {
      g.fillStyle = `rgba(255,255,255,${Math.random() * 0.2})`;
      g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 5, 1);
    }
  };
}

export const drawDealerButton: Painter = (g, w) => {
  g.fillStyle = '#f3f0e6';
  g.fillRect(0, 0, w, w);
  speckle(g, w, w, 900, 0.04);
  g.strokeStyle = '#1d1d22';
  g.lineWidth = 7;
  g.beginPath();
  g.arc(w / 2, w / 2, w * 0.41, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 2;
  g.beginPath();
  g.arc(w / 2, w / 2, w * 0.36, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#1d1d22';
  g.font = 'bold 50px Arial, Helvetica, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('DEALER', w / 2, w / 2 + 3);
};

// ───────────────────────────── table ─────────────────────────────

/** Felt: fine noise plus short fibres, as colour and height map. */
export function drawFelt(base: [number, number, number]): Painter {
  return (g, w, h) => {
    const img = g.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      const n = (Math.random() - 0.5) * 46;
      img.data[i * 4] = base[0] + n;
      img.data[i * 4 + 1] = base[1] + n;
      img.data[i * 4 + 2] = base[2] + n;
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    for (let i = 0; i < 2600; i++) {
      const x = Math.random() * w,
        y = Math.random() * h,
        a = Math.random() * Math.PI * 2;
      const len = 3 + Math.random() * 7;
      g.strokeStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.14)';
      g.lineWidth = 0.7;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
      g.stroke();
    }
  };
}

export const drawWood: Painter = (g, w, h) => {
  g.fillStyle = '#5a3418';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 420; i++) {
    const y = Math.random() * h;
    g.strokeStyle = `rgba(${Math.random() < 0.5 ? '25,12,4' : '150,96,52'},${0.05 + Math.random() * 0.18})`;
    g.lineWidth = 0.5 + Math.random() * 2;
    g.beginPath();
    g.moveTo(0, y);
    g.bezierCurveTo(w / 3, y + (Math.random() - 0.5) * 9, (2 * w) / 3, y + (Math.random() - 0.5) * 9, w, y);
    g.stroke();
  }
};

/**
 * Large, non-tiled overlay with signs of use on the felt: worn light areas,
 * stains, glass rings, drag marks and lint. `feltW`/`feltD` are the felt size,
 * `centerFromBack` the table centre measured from the back edge (world units).
 */
export function drawFeltWear(feltW: number, feltD: number, centerFromBack: number): Painter {
  return (g, w, h) => {
    const u = w / feltW,
      v = h / feltD;
    const cx = w / 2,
      cy = centerFromBack * v;
    const blob = (x: number, y: number, r: number, color: string) => {
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, color);
      grad.addColorStop(1, color.replace(/[\d.]+\)$/, '0)'));
      g.fillStyle = grad;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    };
    g.save();
    g.translate(cx, cy);
    g.scale(1.5, 1);
    blob(0, 0, 9 * v, 'rgba(210,235,190,0.10)');
    g.restore();
    for (let i = 0; i < 16; i++) {
      blob(cx + (Math.random() - 0.5) * 26 * u, cy + (Math.random() - 0.5) * 20 * v, (0.6 + Math.random() * 2.2) * u, `rgba(0,10,0,${0.05 + Math.random() * 0.09})`);
    }
    for (let i = 0; i < 10; i++) {
      blob(cx + (Math.random() - 0.5) * 26 * u, cy + (Math.random() - 0.5) * 20 * v, (0.5 + Math.random() * 1.6) * u, `rgba(225,240,200,${0.03 + Math.random() * 0.06})`);
    }
    g.lineCap = 'round';
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2,
        r0 = 1 + Math.random() * 3,
        r1 = 4 + Math.random() * 6;
      g.strokeStyle = `rgba(215,240,200,${0.005 + Math.random() * 0.012})`;
      g.lineWidth = (0.5 + Math.random() * 0.9) * u;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * r0 * u, cy + Math.sin(a) * r0 * v);
      g.lineTo(cx + Math.cos(a + 0.1) * r1 * 1.3 * u, cy + Math.sin(a + 0.1) * r1 * v);
      g.stroke();
    }
    for (const [dx, dz] of [
      [-10.5, 5.2],
      [11.8, -6.8],
    ]) {
      g.strokeStyle = 'rgba(0,12,0,0.13)';
      g.lineWidth = 0.09 * u;
      g.beginPath();
      g.ellipse(cx + dx * u, cy + dz * v, 1.15 * u, 1.15 * v, 0, 0.3, Math.PI * 1.85);
      g.stroke();
    }
    for (let i = 0; i < 900; i++) {
      g.fillStyle = `rgba(235,240,225,${0.08 + Math.random() * 0.3})`;
      g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 1.6, 1);
    }
  };
}

export const drawShadowBlob: Painter = (g, w, h) => {
  const grad = g.createRadialGradient(w / 2, h / 2, w * 0.12, w / 2, h / 2, w / 2);
  grad.addColorStop(0, 'rgba(0,0,0,0.75)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.4)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
};
