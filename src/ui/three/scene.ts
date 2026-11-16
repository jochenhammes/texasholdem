// The 3D scene around the poker table: renderer, lamp, felt with wooden rim,
// depth of field, contact shadows, camera and gestures. Renders only when
// something changed, so an idle table costs (almost) no battery.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { GameSnapshot } from '../../game/types';
import { createPokerTable, type LabelText, type MaterialFactory, type TextureFactory } from './pokerTable';
import { drawFelt, drawFeltWear, drawWood, type Painter } from './textures';

export interface Scene3DOptions {
  /** Simple rendering: no computed shadows, no depth of field, simpler materials. */
  lite: boolean;
  text: () => LabelText;
  fourColor: () => boolean;
}

export interface Scene3D {
  setSnapshot(snap: GameSnapshot): void;
  refreshFaces(): void;
  /** True when the simple rendering is used (requested, or no WebGL 2). */
  readonly lite: boolean;
  dispose(): void;
}

const TABLE_CENTER = new THREE.Vector3(0, 0, -4.5);
const TABLE = { x: 17, zBack: -20, zFront: 22, rim: 1.7, rimH: 0.55 };
const LAMP_POS = new THREE.Vector3(5.5, 16, 3);
const CONTACT = { size: 30, height: 1.0, res: 1024, z: TABLE_CENTER.z, opacity: 0.8, spread: 1.1 };
const PORTRAIT_SHIFT = 2.5;
const QUAD_VERTEX = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

export function createScene3D(stage: HTMLElement, opts: Scene3DOptions): Scene3D {
  const canvas = document.createElement('canvas');
  canvas.className = 'canvas3d';
  const labels = document.createElement('div');
  labels.className = 'labels3d';
  stage.append(canvas, labels);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: opts.lite,
    powerPreference: opts.lite ? 'low-power' : 'high-performance',
  });
  const LITE = opts.lite || !renderer.capabilities.isWebGL2;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, LITE ? 1.5 : 2));

  // Material with lacquer/velvet effects; plain in the simple rendering
  const material: MaterialFactory = (base, extras) =>
    LITE ? new THREE.MeshStandardMaterial(base as THREE.MeshStandardMaterialParameters) : new THREE.MeshPhysicalMaterial({ ...base, ...extras });

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 1, 220);
  renderer.shadowMap.enabled = !LITE;
  renderer.shadowMap.type = THREE.VSMShadowMap;
  scene.background = new THREE.Color(0x050403);

  const textures: THREE.Texture[] = [];
  const canvasTexture: TextureFactory = (w, h, draw: Painter, repeatX, repeatY, srgb = true) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d')!, w, h);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeatX, repeatY);
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
    textures.push(tex);
    return tex;
  };

  // Environment for reflections: dark room, green felt below, the lamp as a
  // bright disc and a faint window behind the camera.
  {
    const env = new THREE.Scene();
    const glow = (geo: THREE.BufferGeometry, r: number, g: number, b: number) =>
      new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b), side: THREE.DoubleSide }));
    env.add(glow(new THREE.BoxGeometry(60, 60, 60), 0.05, 0.04, 0.035));
    const ground = glow(new THREE.PlaneGeometry(60, 60), 0.03, 0.16, 0.08);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1.5;
    env.add(ground);
    const bulb = glow(new THREE.CircleGeometry(2.2, 32), 8, 6.6, 4.8);
    bulb.position.copy(LAMP_POS);
    bulb.lookAt(0, 0, 0);
    env.add(bulb);
    const windowGlow = glow(new THREE.PlaneGeometry(16, 7), 0.9, 1.0, 1.2);
    windowGlow.position.set(-6, 7, 24);
    windowGlow.lookAt(0, 0, 0);
    env.add(windowGlow);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(env, 0.03, 0.1, 100).texture;
    pmrem.dispose();
    env.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }

  // Hanging lamp above the table: warm cone of light fading towards the rim
  const lamp = new THREE.SpotLight(0xfff0d8, (LITE ? 430 : 620) * 1.6, 0, 0.8, 0.85, 2);
  lamp.position.copy(LAMP_POS);
  lamp.target.position.set(0, 0, TABLE_CENTER.z);
  lamp.castShadow = !LITE;
  // many small shadow casters: finer resolution, sharper
  lamp.shadow.mapSize.set(2048, 2048);
  lamp.shadow.radius = 2.5;
  lamp.shadow.blurSamples = 8;
  lamp.shadow.bias = -0.0006;
  lamp.shadow.camera.near = 4;
  lamp.shadow.camera.far = 40;
  scene.add(lamp, lamp.target);
  // faint room light: warm from above, greenish bounce from the felt
  scene.add(new THREE.HemisphereLight(0xfff1e0, 0x1d4a2c, 1.0));

  // ── table: felt, signs of use, wooden rim ──
  {
    const feltW = TABLE.x * 2,
      feltD = TABLE.zFront - TABLE.zBack;
    const felt = new THREE.Mesh(
      new THREE.PlaneGeometry(feltW, feltD),
      material(
        { map: canvasTexture(512, 512, drawFelt([17, 92, 52]), feltW / 5, feltD / 5), roughness: 1 },
        {
          bumpMap: canvasTexture(512, 512, drawFelt([128, 128, 128]), feltW / 5, feltD / 5, false),
          bumpScale: 0.6,
          sheen: 1,
          sheenRoughness: 0.7,
          sheenColor: new THREE.Color(0x3f9a63),
          envMapIntensity: 0.3,
        },
      ),
    );
    felt.rotation.x = -Math.PI / 2;
    felt.position.z = (TABLE.zFront + TABLE.zBack) / 2;
    felt.receiveShadow = true;
    scene.add(felt);

    if (!LITE) {
      const wear = new THREE.Mesh(
        new THREE.PlaneGeometry(feltW, feltD),
        new THREE.MeshStandardMaterial({
          map: canvasTexture(1024, 1024, drawFeltWear(feltW, feltD, TABLE_CENTER.z - TABLE.zBack), 1, 1),
          transparent: true,
          depthWrite: false,
          roughness: 1,
        }),
      );
      wear.rotation.x = -Math.PI / 2;
      wear.position.set(0, 0.003, felt.position.z);
      wear.receiveShadow = true;
      wear.renderOrder = 0.5;
      scene.add(wear);
    }

    const woodMat = material({ map: canvasTexture(1024, 128, drawWood, 3, 1), roughness: 0.42 }, { clearcoat: 0.7, clearcoatRoughness: 0.2 });
    const rim = (w: number, d: number, x: number, z: number) => {
      const m = new THREE.Mesh(new RoundedBoxGeometry(w, TABLE.rimH * 2, d, 4, 0.22), woodMat);
      m.position.set(x, 0, z);
      m.castShadow = m.receiveShadow = true;
      scene.add(m);
    };
    const zMid = (TABLE.zFront + TABLE.zBack) / 2;
    rim(feltW + TABLE.rim * 2, TABLE.rim, 0, TABLE.zBack - TABLE.rim / 2);
    rim(feltW + TABLE.rim * 2, TABLE.rim, 0, TABLE.zFront + TABLE.rim / 2);
    const sideGeo = new RoundedBoxGeometry(feltD, TABLE.rimH * 2, TABLE.rim, 4, 0.22);
    for (const sx of [-1, 1]) {
      const m = new THREE.Mesh(sideGeo, woodMat);
      m.rotation.y = Math.PI / 2;
      m.position.set(sx * (TABLE.x + TABLE.rim / 2), 0, zMid);
      m.castShadow = m.receiveShadow = true;
      scene.add(m);
    }
  }

  // ── post-processing: depth of field, vignette, tone mapping ──
  const target = LITE
    ? null
    : new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4, depthTexture: new THREE.DepthTexture(4, 4) });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  const quadScene = new THREE.Scene().add(quad);
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  function drawQuad(mat: THREE.Material, to: THREE.WebGLRenderTarget | null) {
    quad.material = mat;
    renderer.setRenderTarget(to);
    renderer.render(quadScene, quadCamera);
  }

  const post = target
    ? new THREE.ShaderMaterial({
        uniforms: {
          tColor: { value: target.texture },
          tDepth: { value: target.depthTexture },
          texel: { value: new THREE.Vector2() },
          near: { value: 1 },
          far: { value: 90 },
          focus: { value: 12 },
          range: { value: 14 },
          strength: { value: 20 },
          maxBlur: { value: 12 },
          exposure: { value: 1.45 },
        },
        vertexShader: QUAD_VERTEX,
        fragmentShader: `
      #include <packing>
      uniform sampler2D tColor, tDepth;
      uniform vec2 texel;
      uniform float near, far, focus, range, strength, maxBlur, exposure;
      varying vec2 vUv;
      const int TAPS = 28;
      float coc(vec2 uv) {
        float d = -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, near, far);
        return min(maxBlur, strength * max(0.0, abs(d - focus) - range) / d);
      }
      void main() {
        float c = coc(vUv);
        vec3 sum = texture2D(tColor, vUv).rgb;
        float wsum = 1.0;
        if (c > 0.6) {
          for (int i = 1; i < TAPS; i++) {
            float r = sqrt(float(i) / float(TAPS)) * c;
            float a = float(i) * 2.39996;
            vec2 uv = vUv + vec2(cos(a), sin(a)) * r * texel;
            // sharp parts must not bleed into the blurred background
            float w = clamp(coc(uv) / max(r, 0.6), 0.0, 1.0);
            sum += texture2D(tColor, uv).rgb * w;
            wsum += w;
          }
        }
        vec3 col = sum / wsum;
        vec2 q = vUv - 0.5;
        col *= 1.0 - 0.55 * smoothstep(0.35, 0.95, length(q) * 1.25);
        // tone mapping on luminance so strong colours do not wash out in the light
        col *= exposure;
        float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
        col *= (1.0 + l / 6.25) / (1.0 + l);
        gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
        #include <colorspace_fragment>
      }`,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      })
    : null;

  // ── contact shadows: a camera below the table measures how close objects
  // are to the felt; blurred, that grounds cards and chips on the cloth ──
  const contact = LITE
    ? null
    : (() => {
        const rt = () => new THREE.WebGLRenderTarget(CONTACT.res, CONTACT.res);
        const cam = new THREE.OrthographicCamera(-CONTACT.size / 2, CONTACT.size / 2, CONTACT.size / 2, -CONTACT.size / 2, 0, CONTACT.height);
        cam.rotation.x = Math.PI / 2;
        cam.position.z = CONTACT.z;
        cam.layers.set(1);
        const depthMat = new THREE.MeshDepthMaterial();
        depthMat.onBeforeCompile = (shader) => {
          shader.fragmentShader = shader.fragmentShader.replace(
            'gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );',
            'gl_FragColor = vec4( vec3( 0.0 ), pow( 1.0 - fragCoordZ, 2.5 ) );',
          );
        };
        const a = rt(),
          b = rt();
        const blur = new THREE.ShaderMaterial({
          uniforms: { tex: { value: null }, dir: { value: new THREE.Vector2() } },
          vertexShader: QUAD_VERTEX,
          fragmentShader: `
        uniform sampler2D tex;
        uniform vec2 dir;
        varying vec2 vUv;
        void main() {
          vec4 sum = texture2D(tex, vUv) * 0.227;
          sum += (texture2D(tex, vUv + dir * 1.38) + texture2D(tex, vUv - dir * 1.38)) * 0.316;
          sum += (texture2D(tex, vUv + dir * 3.23) + texture2D(tex, vUv - dir * 3.23)) * 0.0703;
          gl_FragColor = sum;
        }`,
          depthTest: false,
          depthWrite: false,
        });
        const plane = new THREE.Mesh(
          new THREE.PlaneGeometry(CONTACT.size, CONTACT.size),
          new THREE.MeshBasicMaterial({ map: a.texture, transparent: true, opacity: CONTACT.opacity, depthWrite: false, side: THREE.DoubleSide }),
        );
        plane.rotation.x = Math.PI / 2;
        plane.position.set(0, 0.006, CONTACT.z);
        plane.renderOrder = 1;
        scene.add(plane);
        return { cam, depthMat, a, b, blur };
      })();

  function renderContact() {
    if (!contact) return;
    const background = scene.background;
    scene.background = null;
    scene.overrideMaterial = contact.depthMat;
    renderer.shadowMap.autoUpdate = false;
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(contact.a);
    renderer.render(scene, contact.cam);
    scene.overrideMaterial = null;
    scene.background = background;
    const step = CONTACT.spread / CONTACT.res;
    for (let pass = 0; pass < 2; pass++) {
      contact.blur.uniforms.tex.value = contact.a.texture;
      contact.blur.uniforms.dir.value.set(step, 0);
      drawQuad(contact.blur, contact.b);
      contact.blur.uniforms.tex.value = contact.b.texture;
      contact.blur.uniforms.dir.value.set(0, step);
      drawQuad(contact.blur, contact.a);
    }
    renderer.setClearColor(0x000000, 1);
    renderer.shadowMap.autoUpdate = true;
  }

  // ── the poker table itself ──
  const table = createPokerTable({
    scene,
    material,
    canvasTexture,
    lite: LITE,
    center: TABLE_CENTER,
    labels,
    text: opts.text,
    fourColor: opts.fourColor,
  });

  // ── camera: orbits around the table centre ──
  let dirty = true;
  let zoom = 1;
  const view = { yaw: 0, pitch: 0.86 };
  const focusPoint = new THREE.Vector3();
  const look = new THREE.Vector3();
  let snap: GameSnapshot | null = null;

  function render() {
    if (!post || !target) {
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
    } else {
      renderContact();
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      drawQuad(post, null);
    }
    table.layoutLabels(camera, stage.clientWidth, stage.clientHeight);
  }

  function fitCamera() {
    const w = stage.clientWidth,
      h = stage.clientHeight;
    if (!w || !h) return;
    const wasPortrait = camera.aspect < 0.9;
    renderer.setSize(w, h, false);
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    target?.setSize(size.x, size.y);
    camera.aspect = w / h;
    const halfV = THREE.MathUtils.degToRad(camera.fov / 2);
    const portrait = camera.aspect < 0.9;
    const halfH = Math.atan(Math.tan(halfV) * camera.aspect);
    // frame all seats around the table centre
    const dist = Math.max((portrait ? 10.8 : 19) / Math.tan(halfH), (portrait ? 14.5 : 11) / Math.tan(halfV)) * zoom;
    // Portrait: aim a little towards the player so the table fills the tall
    // screen instead of leaving an empty band behind the far rim.
    look.copy(TABLE_CENTER);
    if (portrait) look.z += PORTRAIT_SHIFT;
    camera.position.set(
      look.x + dist * Math.sin(view.yaw) * Math.cos(view.pitch),
      look.y + dist * Math.sin(view.pitch),
      look.z + dist * Math.cos(view.yaw) * Math.cos(view.pitch),
    );
    camera.lookAt(look);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    if (post) {
      const u = post.uniforms;
      u.texel.value.set(1 / size.x, 1 / size.y);
      // Always keep the own cards and chips up to behind the board in focus,
      // however far you zoom in; only what lies before or behind gets soft.
      const heroZ = TABLE_CENTER.z + (portrait ? 10 : 6.2) + 4;
      const near = camera.position.distanceTo(focusPoint.set(0, 0, heroZ));
      const far = camera.position.distanceTo(focusPoint.set(0, 0, TABLE_CENTER.z - 3));
      u.focus.value = (near + far) / 2;
      u.range.value = Math.abs(far - near) / 2 + 2.5;
      u.strength.value = size.y * 0.018;
      u.maxBlur.value = size.y * 0.007;
    }
    dirty = true;
    // portrait/landscape may have changed: re-seat the players
    if (snap && portrait !== wasPortrait) table.setSnapshot({ ...snap, events: [] }, camera.aspect);
  }
  const resizeObserver = new ResizeObserver(fitCamera);
  resizeObserver.observe(stage);

  let raf = 0;
  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    if (table.update(now)) dirty = true;
    if (dirty) {
      dirty = false;
      render();
    }
  }
  raf = requestAnimationFrame(frame);

  // ── gestures: drag orbits, two fingers / wheel zoom, tap on chips toggles labels ──
  const pointers = new Map<number, { x: number; y: number; w: number; h: number }>();
  type Drag = { mode: 'orbit'; id: number; x: number; y: number; x0: number; y0: number } | { mode: 'multi'; cx: number; cy: number; dist: number };
  let drag: Drag | null = null;

  const localXY = (ev: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top, w: r.width, h: r.height };
  };
  function orbit(dx: number, dy: number) {
    view.yaw = Math.max(-1.1, Math.min(1.1, view.yaw - dx * 0.006));
    view.pitch = Math.max(0.28, Math.min(1.4, view.pitch + dy * 0.006));
    fitCamera();
  }
  function setZoom(z: number) {
    zoom = Math.max(0.3, Math.min(2.2, z));
    fitCamera();
  }
  function twoFinger() {
    const [a, b] = [...pointers.values()];
    return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, dist: Math.hypot(a.x - b.x, a.y - b.y) };
  }
  const onDown = (ev: PointerEvent) => {
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    canvas.setPointerCapture(ev.pointerId);
    const p = localXY(ev);
    pointers.set(ev.pointerId, p);
    if (pointers.size === 2) drag = { mode: 'multi', ...twoFinger() };
    else if (pointers.size === 1) {
      drag = { mode: 'orbit', id: ev.pointerId, x: p.x, y: p.y, x0: p.x, y0: p.y };
      canvas.classList.add('grabbing');
    }
  };
  const onMove = (ev: PointerEvent) => {
    if (!pointers.has(ev.pointerId) || !drag) return;
    const p = localXY(ev);
    pointers.set(ev.pointerId, p);
    if (drag.mode === 'multi') {
      if (pointers.size < 2) return;
      const t = twoFinger();
      orbit(t.cx - drag.cx, t.cy - drag.cy);
      if (drag.dist > 10 && t.dist > 10) setZoom(zoom * (drag.dist / t.dist));
      Object.assign(drag, t);
      return;
    }
    if (drag.id !== ev.pointerId) return;
    orbit(p.x - drag.x, p.y - drag.y);
    drag.x = p.x;
    drag.y = p.y;
  };
  const onEnd = (ev: PointerEvent) => {
    if (!pointers.delete(ev.pointerId) || !drag) return;
    if (drag.mode === 'multi') {
      if (pointers.size === 0) drag = null;
      return;
    }
    if (drag.id !== ev.pointerId) return;
    const d = drag;
    drag = null;
    canvas.classList.remove('grabbing');
    if (ev.type === 'pointerup') {
      const p = localXY(ev);
      if (Math.hypot(p.x - d.x0, p.y - d.y0) < 7 && table.tapChips(p.x, p.y, camera, p.w, p.h)) dirty = true;
    }
  };
  const onWheel = (ev: WheelEvent) => {
    ev.preventDefault();
    setZoom(zoom * Math.exp(ev.deltaY * 0.001));
  };
  const onContext = (ev: Event) => ev.preventDefault();
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onEnd);
  canvas.addEventListener('pointercancel', onEnd);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onContext);

  fitCamera();

  return {
    lite: LITE,
    setSnapshot(next) {
      snap = next;
      if (!camera.aspect || !stage.clientWidth) fitCamera();
      table.setSnapshot(next, camera.aspect);
      dirty = true;
    },
    refreshFaces() {
      table.refreshFaces();
      dirty = true;
    },
    dispose() {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) m.dispose();
        }
      });
      for (const t of textures) t.dispose();
      scene.environment?.dispose();
      target?.dispose();
      post?.dispose();
      if (contact) {
        contact.a.dispose();
        contact.b.dispose();
        contact.blur.dispose();
        contact.depthMat.dispose();
      }
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
      labels.remove();
    },
  };
}
