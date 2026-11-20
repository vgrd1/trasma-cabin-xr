import * as THREE from 'three';
import { RO, CY, CUT, PITCH, halvBredde } from './cabin.js';
import { logoNavn, logoTekstur, romLogo, TMT_BLAA, TMT_MARINE, glodMat } from './textures.js';
import { COCKPIT } from './cockpit.js';
import { KABIN } from './lys.js';

// Kanalens profilbilde (logoen på stjernehimmel). Twitch sender CORS-hoder, så det kan brukes som tekstur.
const PROFILBILDE = 'https://static-cdn.jtvnw.net/jtv_user_pictures/323af550-1985-403c-9ea6-5724c47ff293-profile_image-600x600.png';

// Flyet utenfra: skrog (sylinder + nese + hale) kuttet ved CUT, vinger, motorer og haleflater.
// Skroget har ett materiale med to sider: forsiden er lakken, baksiden er kabinveggen.

/** Der hjulene står når flyet er på bakken (y). */
export const BAKKE_Y = CY - RO + 0.1 - 1.25 - 0.33;

/** Hvor lyst flyet er utvendig (1 = dag, lavere = kveld/natt). Kabinen påvirkes ikke. */
const YTRE = { value: 1 };
const ytreMat = []; // vinger, motorer, finne og dekaler
// Vinduene. Kabinvinduene: ett per rad på hver side. Cockpitrutene ligger på nesa og er gitt som
// (t, vinkel) på nesens overflate (attributtet aNese): t = andel av neselengden, vinkel fra toppen.
// 1 = glass, 0.5 = den svarte rammen rundt (som på en ekte 737), 0 = lakk.
const VINDU_GLSL = `
bool kabinVindu(vec3 p, float z0, float z1, float pp) {
  if (abs(p.x) < 1.2 || p.z < z0 - pp * 0.5 || p.z > z1 + pp * 0.5) return false;
  float dz = mod(p.z - z0 + pp * 0.5, pp) - pp * 0.5;
  vec2 q = abs(vec2(dz, p.y - 1.12)) - vec2(0.115, 0.165) + 0.09;
  return (length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 0.09) < 0.0;
}
float rute(float t, float a, vec4 r) {
  if (t > r.x && t < r.y && a > r.z && a < r.w) return 1.0;
  if (t > r.x - 0.012 && t < r.y + 0.012 && a > r.z - 0.04 && a < r.w + 0.04) return 0.5;
  return 0.0;
}
float cockpitRute(vec2 n) {
  float t = n.x; float a = abs(n.y);
  if (t < 0.008) return 0.0;
  float w1 = rute(t, a, vec4(0.27, 0.42, 0.045, 0.62)); // frontrutene på den skrå nesa
  float w2 = rute(t, a, vec4(0.14, 0.25, 0.72, 1.12));  // siderutene
  float w3 = rute(t, a, vec4(0.035, 0.12, 0.78, 1.08)); // de bakre siderutene
  return max(max(w1, w2), w3);
}`;

/** Dørene: L1/R1 foran, L2/R2 bak og to nødutganger over vingen på hver side. side = -1 venstre, +1 høyre. */
function dorer(layout) {
  const zv = layout.zCockpitVegg, zB = layout.zBak, w = layout.vingeZ;
  return [
    { side: -1, z: zv + 2.45, b: 0.86, y0: 0.02, y1: 1.85 }, { side: 1, z: zv + 2.45, b: 0.76, y0: 0.02, y1: 1.65 },
    { side: -1, z: zB - 0.95, b: 0.76, y0: 0.02, y1: 1.85 }, { side: 1, z: zB - 0.95, b: 0.76, y0: 0.02, y1: 1.65 },
    { side: -1, z: w + 2.2, b: 0.52, y0: 0.38, y1: 1.3 }, { side: 1, z: w + 2.2, b: 0.52, y0: 0.38, y1: 1.3 },
    { side: -1, z: w + 2.95, b: 0.52, y0: 0.38, y1: 1.3 }, { side: 1, z: w + 2.95, b: 0.52, y0: 0.38, y1: 1.3 },
  ];
}

/** Glasset i vinduene: svakt blåtonet og blankt, bare der vinduene er. */
function glassMateriale(layout, klipp) {
  const forste = layout.rader[0]?.z ?? 0;
  const m = new THREE.MeshStandardMaterial({ color: 0x9cc4ea, roughness: 0.04, metalness: 0.0, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.6, clippingPlanes: klipp ? [klipp] : [] });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uZ0: { value: forste - 0.1 }, uZ1: { value: layout.sisteZ - 0.1 }, uP: { value: PITCH } });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vVerden;\nattribute vec2 aNese;\nvarying vec2 vNese;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvVerden = position;\nvNese = aNese;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vVerden;\nvarying vec2 vNese;\nuniform float uZ0, uZ1, uP;\n${VINDU_GLSL}`)
      .replace('void main() {', 'void main() {\n  if (cockpitRute(vNese) < 0.9 && !kabinVindu(vVerden, uZ0, uZ1, uP)) discard;');
  };
  return m;
}

/** Gjør et utvendig materiale dimbart: hele den ferdige fargen (også refleksene) ganges med YTRE. */
const ytre = (m) => {
  ytreMat.push(m);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uYtre = YTRE;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uYtre;')
      .replace('#include <opaque_fragment>', '#include <opaque_fragment>\ngl_FragColor.rgb *= uYtre;');
  };
  return m;
};
const FINNE = { value: 1 }; // halefinnen er opplyst av logolysene om natta
export function settYtre(f) { YTRE.value = f; FINNE.value = Math.max(f, 0.75); }

const LIN = (hex) => new THREE.Color(hex); // Color lagrer lineært; brukes som shader-uniform

function skrogMateriale(layout, klipp) {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xf6f7f9, roughness: 0.35, metalness: 0.1,
    side: THREE.DoubleSide, clippingPlanes: klipp ? [klipp] : [], clipShadows: true,
  });
  const forste = layout.rader[0]?.z ?? 0;
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, {
      uZ0: { value: forste - 0.1 }, uZ1: { value: layout.sisteZ - 0.1 }, uP: { value: PITCH },
      uStripe: { value: new THREE.Color(TMT_BLAA) }, uMarine: { value: new THREE.Color(TMT_MARINE) }, uBuk: { value: LIN(0x9ea4ad) },
      uHold: { value: new THREE.Vector4(...layout.lasterom[0], ...layout.lasterom[1]) },
      uNese: { value: layout.zNese }, uCockpitVegg: { value: layout.zCockpitVegg }, uCockpit: COCKPIT, uKabin: KABIN,
      uDor: { value: dorer(layout).map((d) => new THREE.Vector4(d.z, d.b / 2, d.y0, d.y1)) },
      uDorSide: { value: dorer(layout).map((d) => d.side) },
      uVegg: { value: LIN(0xe7e2d8) }, uVeggNede: { value: LIN(0x8d93a0) },
      uGlassInne: { value: LIN(0x9cc6f5) }, uGlassUte: { value: LIN(0x3a4658) }, uYtre: YTRE, uNattGlass: { value: LIN(0x0e1626) },
    });
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vVerden;\nattribute vec2 aNese;\nvarying vec2 vNese;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvVerden = position;\nvNese = aNese;'); // flyets egne koordinater, så mønstrene følger flyet når det rister
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vVerden;
        varying vec2 vNese;
        uniform float uZ0, uZ1, uP;
        uniform vec3 uStripe, uMarine, uBuk, uVegg, uVeggNede, uGlassInne, uGlassUte;
        uniform vec4 uHold;
        uniform float uYtre, uNese, uCockpitVegg, uCockpit, uKabin;
        uniform vec4 uDor[8];
        uniform float uDorSide[8];
        ${VINDU_GLSL}
        uniform vec3 uNattGlass;`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        // cargo hold opening, left side, below the floor
        if (vVerden.x < -0.6 && vVerden.y > -1.0 && vVerden.y < -0.14 &&
            ((vVerden.z > uHold.x && vVerden.z < uHold.y) || (vVerden.z > uHold.z && vVerden.z < uHold.w))) discard;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        // all windows are real glass: cut out here, the glass is a separate transparent mesh
        float rute = cockpitRute(vNese);
        if (rute > 0.9 || kabinVindu(vVerden, uZ0, uZ1, uP)) discard;
        float vindu = 0.0;
        if (!gl_FrontFacing) {
          diffuseColor.rgb = vVerden.y < 0.32 ? uVeggNede : uVegg;
        } else if (vVerden.y > 0.76 && vVerden.y < 0.88) {
          diffuseColor.rgb = uStripe;
        } else if (vVerden.y > 0.715 && vVerden.y < 0.74) {
          diffuseColor.rgb = uMarine;
        } else if (vVerden.y < ${(CY - 1.05).toFixed(2)}) {
          diffuseColor.rgb = uBuk;
        }
        if (gl_FrontFacing && rute > 0.4) diffuseColor.rgb = vec3(0.025, 0.028, 0.035); // black window frames
        // doors and overwing exits: outline outside, door panel inside, small window in the main doors
        for (int i = 0; i < 8; i++) {
          vec4 d = uDor[i];
          if (vVerden.x * uDorSide[i] < 0.5) continue;
          float dz = abs(vVerden.z - d.x);
          float y = vVerden.y;
          bool inn = dz < d.y && y > d.z && y < d.w;
          bool kant = !inn && dz < d.y + 0.018 && y > d.z - 0.018 && y < d.w + 0.018;
          if (kant) diffuseColor.rgb = gl_FrontFacing ? vec3(0.32, 0.35, 0.4) : vec3(0.42, 0.41, 0.39);
          else if (inn) {
            if (!gl_FrontFacing) diffuseColor.rgb = vec3(0.74, 0.72, 0.68);
            if (d.w > 1.6 && dz < 0.07 && abs(y - 1.36) < 0.1) diffuseColor.rgb = vec3(0.05, 0.06, 0.08);
          }
        }`)
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>
        if (gl_FrontFacing) gl_FragColor.rgb *= uYtre; // dempet utside om kvelden og natta
        else if (vVerden.z < uCockpitVegg && vindu < 0.5) gl_FragColor.rgb *= uCockpit;
        else if (vindu < 0.5) gl_FragColor.rgb *= uKabin; // cabin walls follow the cabin lighting
        if (vindu > 0.5) gl_FragColor.rgb = gl_FrontFacing ? uGlassUte * uYtre : mix(uNattGlass, uGlassInne, uYtre);`);
  };
  return mat;
}

/** Lathe langs z: profil = [[r, t]] med t fra 0 til lengde, retning = +1 (bakover) eller -1 (fram). */
function lathe(profil, retning, z0, loft, { form = null, nese = false } = {}) {
  const geo = new THREE.LatheGeometry(profil.map(([r, t]) => new THREE.Vector2(r, t)), 72);
  geo.rotateX(retning > 0 ? Math.PI / 2 : -Math.PI / 2);
  const p = geo.attributes.position;
  const L = profil[profil.length - 1][1];
  const neseAttr = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const t = Math.abs(p.getZ(i)) / L;
    let y = p.getY(i);
    neseAttr[i * 2] = t;
    neseAttr[i * 2 + 1] = Math.atan2(p.getX(i), y); // vinkel fra toppen, før formingen
    if (form) y = form(t, y);
    p.setY(i, y + CY + loft(t));
    p.setZ(i, p.getZ(i) + z0);
  }
  if (nese) geo.setAttribute('aNese', new THREE.BufferAttribute(neseAttr, 2));
  geo.computeVertexNormals();
  return geo;
}

function std(farge, ekstra = {}) {
  return new THREE.MeshStandardMaterial({ color: farge, roughness: 0.45, metalness: 0.1, ...ekstra });
}

/**
 * Vingeflate bygd av profilsnitt (NACA 4-sifret tykkelse, litt krumning) langs spennet.
 * stasjoner: [{ s, le, c, t }] = avstand langs spennet, forkantens forskyvning bakover, korde og
 * relativ tykkelse. vinkel = hvor mye spennet peker oppover (0 = vannrett, π/2 = loddrett).
 * UV: u = andel av korden (eller meter med meterUV), v = meter langs spennet.
 */
function vingeflate(stasjoner, vinkel, meterUV = false, krumning = 0.02) {
  const N = 20; // punkter langs hver side av profilet
  const sp = new THREE.Vector3(Math.cos(vinkel), Math.sin(vinkel), 0); // spennretning
  const tk = new THREE.Vector3(-Math.sin(vinkel), Math.cos(vinkel), 0); // tykkelsesretning
  const pos = [], uv = [], idx = [];
  const profil = [];
  for (let i = 0; i <= N; i++) {
    const x = (1 - Math.cos((i / N) * Math.PI)) / 2; // tettere ved forkanten
    const yt = 5 * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    const yc = krumning * 4 * x * (1 - x);
    profil.push([x, yc + yt, yc - yt * 0.75]);
  }
  const ring = 2 * N; // oversiden fram→bak, undersiden bak→fram (uten å gjenta endene)
  for (const st of stasjoner) {
    const pkt = [];
    for (let i = 0; i <= N; i++) pkt.push([profil[i][0], profil[i][1]]);
    for (let i = N - 1; i >= 1; i--) pkt.push([profil[i][0], profil[i][2]]);
    for (const [x, y] of pkt) {
      const z = st.le + x * st.c;
      const t = y * st.t * st.c;
      pos.push(sp.x * st.s + tk.x * t, sp.y * st.s + tk.y * t, z);
      uv.push(meterUV ? z : x, st.s);
    }
  }
  for (let k = 0; k < stasjoner.length - 1; k++) {
    for (let i = 0; i < ring; i++) {
      const a = k * ring + i, b = k * ring + ((i + 1) % ring), c = a + ring, d = b + ring;
      idx.push(a, c, b, b, c, d);
    }
  }
  // Lokk i rot og tupp (vifte fra midten av profilet).
  for (const [k, snu] of [[0, true], [stasjoner.length - 1, false]]) {
    const st = stasjoner[k];
    const m = pos.length / 3;
    pos.push(sp.x * st.s, sp.y * st.s, st.le + st.c * 0.4);
    uv.push(meterUV ? st.le + st.c * 0.4 : 0.4, st.s);
    for (let i = 0; i < ring; i++) {
      const a = k * ring + i, b = k * ring + ((i + 1) % ring);
      if (snu) idx.push(m, a, b); else idx.push(m, b, a);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** Interpoler en stasjonsliste ved spennavstand s → { le, c, t }. */
function langsSpennet(st, s) {
  for (let i = 0; i < st.length - 1; i++) {
    const a = st[i], b = st[i + 1];
    if (s <= b.s) { const f = (s - a.s) / (b.s - a.s); return { le: a.le + (b.le - a.le) * f, c: a.c + (b.c - a.c) * f, t: a.t + (b.t - a.t) * f }; }
  }
  return st[st.length - 1];
}

/** Vingens panellinjer: slatlinje ved forkanten, flaps/spoilere bak og skjøter langs spennet. */
function vingeTekstur() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, 512, 64);
  x.fillStyle = 'rgba(60,66,76,0.55)';
  for (const u of [0.13, 0.68, 0.8]) x.fillRect(u * 512, 0, 2, 64);
  x.fillRect(0, 0, 512, 1);
  x.fillStyle = 'rgba(140,146,156,0.25)'; x.fillRect(0, 0, 0.12 * 512, 64); // blankere forkant
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, 1 / 2.6);
  return t;
}

/** Glødende lys (navigasjon, beacon, strobe) som en liten kule og en myk glorie. */
const gloriTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  const r = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(255,255,255,0.6)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = r; x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
function flylys(farge, str = 0.9) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), new THREE.MeshBasicMaterial({ color: farge, toneMapped: false })));
  const gl = new THREE.Sprite(new THREE.SpriteMaterial({ map: gloriTex, color: farge, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  gl.scale.setScalar(str);
  g.add(gl);
  g.userData.glorie = gl;
  return g;
}

const motorLogo = ytre(new THREE.MeshStandardMaterial({ map: logoTekstur(TMT_MARINE), transparent: true, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -2 }));

function motor(x, y, z, side) {
  const g = new THREE.Group();
  const profil = [[0.7, 0], [0.82, 0.12], [0.88, 0.5], [0.86, 2.4], [0.7, 3.1], [0.5, 3.5]];
  const kappe = new THREE.LatheGeometry(profil.map(([r, t]) => new THREE.Vector2(r, t)), 40);
  kappe.rotateX(Math.PI / 2);
  kappe.scale(1, 0.9, 1); // flat underside som på CFM56
  const naselle = new THREE.Mesh(kappe, ytre(std(0xf2f3f5, { side: THREE.DoubleSide })));
  const lepp = new THREE.Mesh(new THREE.TorusGeometry(0.76, 0.06, 10, 40), ytre(std(0xb7bcc4, { metalness: 0.8, roughness: 0.25 })));
  lepp.scale.set(1, 0.9, 1);
  const vifte = new THREE.Mesh(new THREE.CircleGeometry(0.72, 32), std(0x2a2d33, { metalness: 0.6 }));
  vifte.position.z = 0.35;
  vifte.rotation.y = Math.PI;
  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.4, 20), ytre(std(0xc9ccd2, { metalness: 0.7 })));
  spinner.rotation.x = -Math.PI / 2;
  spinner.position.z = 0.2;
  const dyse = new THREE.Mesh(new THREE.ConeGeometry(0.38, 0.9, 20), ytre(std(0x5a5e66, { metalness: 0.7, roughness: 0.4 })));
  dyse.rotation.x = Math.PI / 2;
  dyse.position.z = 3.8;
  // Pylonen: fra toppen av motorkappa, skrått opp og bakover, festet under vingen (profil sett fra siden).
  const profil2 = [[0.9, 0.72], [2.0, 0.9], [3.2, 1.02], [5.5, 0.92], [5.7, 0.78], [4.7, 0.5], [3.6, 0.66], [0.9, 0.72]];
  const pylonForm = new THREE.Shape(profil2.map(([z, y]) => new THREE.Vector2(z, y)));
  const pylonGeo = new THREE.ExtrudeGeometry(pylonForm, { depth: 0.24, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2 });
  pylonGeo.rotateY(-Math.PI / 2);
  pylonGeo.translate(0.12, 0, 0);
  const pylon = new THREE.Mesh(pylonGeo, ytre(std(0xd9dce1, { side: THREE.DoubleSide })));
  g.add(naselle, lepp, vifte, spinner, dyse, pylon);
  const merke = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), motorLogo);
  merke.position.set(side * 0.885, 0.02, 1.5);
  merke.rotation.y = side * Math.PI / 2;
  g.add(merke);
  g.position.set(x, y, z);
  return g;
}

function understell(x, z, hjul, lengde) {
  const g = new THREE.Group();
  const stag = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, lengde, 12), std(0xb0b4bb, { metalness: 0.7, roughness: 0.3 }));
  stag.position.y = -lengde / 2;
  g.add(stag);
  const hjulGeo = new THREE.CylinderGeometry(0.55 * hjul, 0.55 * hjul, 0.32, 24);
  hjulGeo.rotateZ(Math.PI / 2);
  for (const dx of [-0.22, 0.22]) {
    const h = new THREE.Mesh(hjulGeo, std(0x17181b, { roughness: 0.9 }));
    h.position.set(dx, -lengde, 0);
    g.add(h);
  }
  g.position.set(x, 0, z);
  return g;
}

/** UV på finnen er meter i omrisset; et kvadrat på 4,2 m sentrert midt på finnen viser hele bildet. */
function plasserFinne(t) {
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.repeat.set(1 / 4.2, 1 / 4.2);
  t.offset.set(-2.45 / 4.2, -0.9 / 4.2);
  t.anisotropy = 8;
  return t;
}

/** Bygger hele flyet utenfor kabinen. klipp = planet som kutter taket (y ≤ CUT beholdes). */
export function byggSkrog(layout, klipp) {
  ytreMat.length = 0;
  const g = new THREE.Group();
  const zA = layout.zNese;
  const zB = layout.zBak;
  const skrogMat = skrogMateriale(layout, klipp);

  // Sylinderen.
  const syl = new THREE.CylinderGeometry(RO, RO, zB - zA, 72, 1, true);
  syl.rotateX(Math.PI / 2);
  syl.translate(0, CY, (zA + zB) / 2);
  g.add(new THREE.Mesh(syl, skrogMat));

  // Nesa: senkes litt mot tuppen. Halen: smalner og løfter seg mot halefinnen.
  const nese = [];
  // 737-nesa: toppen faller bratt ned mot frontruta, undersiden er nesten rett, tuppen henger litt.
  for (let i = 0; i <= 32; i++) { const t = i / 32; nese.push([RO * Math.pow(Math.max(0, 1 - t ** 1.7), 0.6), t * 4.6]); }
  const glatt = (a, b, x) => { const u = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };
  const neseForm = (t, y) => (y > 0 ? y * (1 - 0.5 * glatt(0.04, 0.72, t)) : y * (1 - 0.18 * glatt(0.3, 1, t)));
  const neseGeo = lathe(nese, -1, zA, (t) => -0.55 * t * t, { form: neseForm, nese: true });
  // Nesa kuttes ikke: den er hel som på et ekte fly, og cockpit sees ovenfra gjennom snittet bak.
  g.add(new THREE.Mesh(neseGeo, skrogMateriale(layout, null)));
  const glass = new THREE.Mesh(neseGeo, glassMateriale(layout, null));
  glass.renderOrder = 3;
  g.add(glass);
  // Glass i kabinvinduene også (samme sylinder, bare vindusfeltene vises).
  const kabinGlass = new THREE.Mesh(syl, glassMateriale(layout, klipp));
  kabinGlass.renderOrder = 3;
  g.add(kabinGlass);
  const LT = 8.5;
  const hale = [];
  for (let i = 0; i <= 24; i++) { const t = i / 24; hale.push([RO * (1 - 0.86 * Math.pow(t, 1.35)), t * LT]); }
  hale.push([0.001, LT + 0.25]);
  // Halekjeglen bak trykkskottet kuttes ikke heller: det er ingenting å se der inne, og finnen står på den.
  g.add(new THREE.Mesh(lathe(hale, 1, zB, (t) => 1.0 * Math.pow(t, 1.7)), skrogMateriale(layout, null)));

  // Skrogtykkelsen langs snittet (ellers ser veggen ut som papir ovenfra).
  const hw = halvBredde(CUT);
  const kant = new THREE.MeshStandardMaterial({ color: 0x4a4f59, roughness: 0.8 });
  for (const s of [-1, 1]) {
    const k = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.03, zB - zA), kant);
    k.position.set(s * (hw - 0.045), CUT - 0.012, (zA + zB) / 2);
    g.add(k);
  }
  // Trykkskott bak: en hel vegg (ikke kuttet) som stenger halekjeglen, så man ikke ser inn i skallet.
  const skott = new THREE.Mesh(new THREE.CircleGeometry(RO - 0.012, 72), new THREE.MeshStandardMaterial({ color: 0xd8d3c9, roughness: 0.7, side: THREE.DoubleSide }));
  skott.position.set(0, CY, zB + 0.01);
  g.add(skott);

  // Navnet på flykroppen, begge sider, under vinduene.
  const navnMat = ytre(new THREE.MeshStandardMaterial({ map: logoNavn(TMT_MARINE), transparent: true, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -2 }));
  for (const s of [-1, 1]) {
    const n = new THREE.Mesh(new THREE.PlaneGeometry(6.0, 1.03), navnMat);
    n.position.set(s * (halvBredde(0.3) + 0.03), 0.3, 3.4);
    n.rotation.y = s * Math.PI / 2;
    n.rotation.x = 0;
    g.add(n);
  }

  // Vingene: 737-800 med knekk ved roten (yehudi), 25° pilform, 6° V-form og blended winglets.
  const vingeMat = ytre(std(0xffffff, { map: vingeTekstur(), roughness: 0.5, side: THREE.DoubleSide }));
  const graaMat = ytre(std(0xc8ccd3, { roughness: 0.5, side: THREE.DoubleSide }));
  const rotZ = layout.vingeZ;
  const sveip = Math.tan((27 * Math.PI) / 180);
  const VINGE = [{ s: 0, le: 0, c: 7.0, t: 0.15 }, { s: 5.0, le: 5.0 * sveip, c: 4.4, t: 0.13 }, { s: 15.6, le: 15.6 * sveip, c: 1.35, t: 0.1 }];
  const VFORM = (6 * Math.PI) / 180;
  const vingeGeo = vingeflate(VINGE, VFORM);
  const tupp = VINGE[2];
  const wingletGeo = vingeflate([{ s: 0, le: 0, c: tupp.c, t: 0.1 }, { s: 0.45, le: 0.25, c: 1.05, t: 0.09 }], 0.6);
  const winglet2Geo = vingeflate([{ s: 0, le: 0, c: 1.05, t: 0.09 }, { s: 2.1, le: 1.5, c: 0.4, t: 0.08 }], 1.32);
  const lys = { blink: [], strobe: [], alle: [] };
  for (const s of [-1, 1]) {
    const v = new THREE.Group();
    v.add(new THREE.Mesh(vingeGeo, vingeMat));
    // Winglet: en kort overgang og så selve bladet nesten loddrett.
    const tx = Math.cos(VFORM) * tupp.s, ty = Math.sin(VFORM) * tupp.s;
    const w1 = new THREE.Mesh(wingletGeo, graaMat); w1.position.set(tx, ty, tupp.le); v.add(w1);
    const w2 = new THREE.Mesh(winglet2Geo, graaMat); w2.position.set(tx + Math.cos(0.6) * 0.45, ty + Math.sin(0.6) * 0.45, tupp.le + 0.25); v.add(w2);
    // Flapskinneskjold (kanopodene) under bakkanten.
    for (const sp of [3.2, 7.4, 11.0]) {
      const st = langsSpennet(VINGE, sp);
      const pod = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 1.9, 4, 10), graaMat);
      pod.rotation.x = Math.PI / 2; pod.scale.set(1, 1, 1.3);
      pod.position.set(Math.cos(VFORM) * sp, Math.sin(VFORM) * sp - 0.2, st.le + st.c * 0.92);
      v.add(pod);
    }
    // Navigasjonslys (rødt venstre, grønt høyre) og strobe på vingetuppen.
    const nav = flylys(s < 0 ? 0xff2a2a : 0x2aff5a);
    nav.position.set(tx + 0.1, ty + 0.05, tupp.le + 0.1);
    const strobe = flylys(0xffffff, 1.6);
    strobe.position.set(tx + 0.1, ty + 0.05, tupp.le + 0.35);
    v.add(nav, strobe);
    lys.alle.push(nav); lys.strobe.push(strobe);
    v.scale.x = s; // speilvendt for venstre vinge
    v.position.set(s * 1.3, -0.82, rotZ);
    g.add(v);
    g.add(motor(s * 4.9, -1.45, rotZ - 1.5, s)); // foran og under vingen, kappa tett inn mot forkanten
  }

  // Buk-fairingen under vingeroten (vingekassa og hjulbrønnene).
  const fairing = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 20), skrogMat);
  fairing.scale.set(1.95, 0.75, 6.2);
  fairing.position.set(0, CY - RO + 0.22, rotZ + 3.1);
  g.add(fairing);

  // Haleflatene: høyderor med 7° V-form, og halefinnen med rygg-finne foran.
  const haleZ = zB + 3.5;
  const HALE = [{ s: 0, le: 0, c: 3.6, t: 0.11 }, { s: 6.4, le: 6.4 * Math.tan((33 * Math.PI) / 180), c: 1.15, t: 0.09 }];
  const haleGeo = vingeflate(HALE, (7 * Math.PI) / 180, false, 0);
  for (const s of [-1, 1]) {
    const h = new THREE.Mesh(haleGeo, vingeMat);
    h.scale.x = s;
    h.position.set(s * 0.45, CY + 0.6, haleZ);
    g.add(h);
  }
  // Halefinnen: profilbildet (logoen på stjernehimmel) midt på finnen. Logolysene holder den
  // opplyst også om natta.
  const finneMat = std(0xffffff, { map: plasserFinne(romLogo()), roughness: 0.4, side: THREE.DoubleSide });
  finneMat.onBeforeCompile = (sh) => {
    sh.uniforms.uFinne = FINNE;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uFinne;')
      .replace('#include <opaque_fragment>', '#include <opaque_fragment>\ngl_FragColor.rgb *= uFinne;');
  };
  new THREE.TextureLoader().setCrossOrigin('anonymous').load(PROFILBILDE, (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    finneMat.map = plasserFinne(t);
    finneMat.needsUpdate = true;
  });
  const FINNE_ST = [{ s: 0, le: 0, c: 6.2, t: 0.11 }, { s: 6.0, le: 6.0 * Math.tan((38 * Math.PI) / 180), c: 2.0, t: 0.1 }];
  const finneMesh = new THREE.Mesh(vingeflate(FINNE_ST, Math.PI / 2, true, 0), finneMat);
  finneMesh.position.set(0, CY + 1.0, zB + 1.4);
  g.add(finneMesh);
  // Rygg-finnen står på halekjeglen bak trykkskottet (ikke over kabinen, der taket er kuttet).
  const rygg = new THREE.Mesh(vingeflate([{ s: 0, le: 0, c: 1.7, t: 0.12 }, { s: 0.5, le: 1.45, c: 0.3, t: 0.1 }], Math.PI / 2, false, 0), graaMat);
  rygg.position.set(0, CY + RO - 0.12, zB + 0.05);
  g.add(rygg);
  // APU-utløpet bakerst.
  const apu = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.35, 16, 1, true), ytre(std(0x3a3d43, { metalness: 0.6, side: THREE.DoubleSide })));
  apu.rotation.x = Math.PI / 2;
  apu.position.set(0, CY + 1.0, zB + 8.7);
  g.add(apu);

  // Hvitt lys bak, rødt beacon over og under, logolys.
  const hvitt = flylys(0xffffff); hvitt.position.set(0, CY + 1.0, zB + 8.95);
  const beaconOver = flylys(0xff2020, 1.2); beaconOver.position.set(0, CY + RO + 0.04, zB + 0.5); // oppå halekjeglen
  const beaconUnder = flylys(0xff2020, 1.2); beaconUnder.position.set(0, CY - RO - 0.02, rotZ + 1.0);
  g.add(hvitt, beaconOver, beaconUnder);
  lys.alle.push(hvitt);
  lys.blink.push(beaconOver, beaconUnder);

  // Logolys: lyskjegler fra haleflatene opp mot finnen, så logoen synes i mørket.
  const logoLys = [];
  for (const s of [-1, 1]) {
    const k = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 4.6), glodMat('kjegle', 0xfff2d8, 0));
    k.position.set(s * 0.19, CY + 3.0, zB + 4.2);
    k.rotation.y = s * Math.PI / 2;
    k.renderOrder = 4;
    g.add(k); logoLys.push(k);
  }
  // Vingelys (inspeksjon av forkanten) fra skroget ut over vingene.
  for (const s of [-1, 1]) {
    const k = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 5.5), glodMat('kjegle', 0xfff6e8, 0));
    k.rotation.set(-Math.PI / 2, 0, -s * Math.PI / 2 + s * 0.35);
    k.position.set(s * 4.3, -0.45, rotZ - 0.2);
    k.renderOrder = 4;
    g.add(k); logoLys.push(k);
  }
  // Landingslys (vingeroten) og taxilys (neseunderstellet): lyskjegler forover og ned når flyet er lavt.
  const landing = [];
  for (const [x, z, l, b] of [[-2.2, rotZ + 0.2, 26, 7], [2.2, rotZ + 0.2, 26, 7], [0, zA - 1.4, 14, 5]]) {
    const k = new THREE.Mesh(new THREE.PlaneGeometry(b, l), glodMat('kjegle', 0xfff8ec, 0));
    k.geometry.translate(0, l / 2, 0); // spissen i lyset
    k.rotation.set(-Math.PI / 2 - 0.06, 0, 0); // flat og forover (-z), litt ned mot bakken
    k.position.set(x, CY - RO + 0.2, z);
    k.renderOrder = 4;
    g.add(k); landing.push(k);
  }

  // Understell (vises når vi står på bakken).
  const hjul = new THREE.Group();
  hjul.add(understell(0, zA - 1.6, 0.6, 1.25));
  for (const s of [-1, 1]) hjul.add(understell(s * 2.9, rotZ + 4.3, 1, 1.0));
  hjul.position.y = CY - RO + 0.1;
  g.add(hjul);

  g.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  settYtre(YTRE.value);
  glass.castShadow = false;
  kabinGlass.castShadow = false;
  for (const l of [...lys.alle, ...lys.blink, ...lys.strobe]) l.traverse((m) => { m.castShadow = false; m.receiveShadow = false; });
  return {
    gruppe: g, hjul,
    /** Logo-/vingelys (sterkest i mørket) og landingslys (lav = 0..1, 1 når flyet er lavt eller på bakken). */
    effektTick(lav) {
      const morke = 1 - YTRE.value;
      for (const k of logoLys) k.material.opacity = 0.12 + morke * 0.55;
      for (const k of landing) { k.material.opacity = lav * (0.18 + morke * 0.45); k.visible = lav > 0.01; }
    },
    /** Blinkende beacon (rødt, ca. 1 Hz) og doble strober; glorien er tydeligst når det er mørkt. */
    lysTick(t) {
      const morke = 1 - YTRE.value;
      const glorie = (l, paa) => { l.visible = paa; l.userData.glorie.material.opacity = 0.35 + morke * 0.65; };
      for (const l of lys.alle) glorie(l, true);
      const b = (t % 1.2) < 0.12;
      for (const l of lys.blink) glorie(l, b);
      const st = t % 1.6; const s2 = st < 0.05 || (st > 0.14 && st < 0.19);
      for (const l of lys.strobe) glorie(l, s2);
    },
  };
}
