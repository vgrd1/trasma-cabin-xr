import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries as flett } from 'three/addons/utils/BufferGeometryUtils.js';
import { seteStoff, nakkeTrekk, teppe, bysseFront, byssaTraller, byssaOvn, glodMat } from './textures.js';
import { byggCockpit } from './cockpit.js';
import { dimKabin } from './lys.js';

// Mål i meter, omtrent som en Boeing 737-800. Fram = -z, rad 1 står ved z = 0, kabingulvet ved y = 0.
export const PITCH = 0.79;
export const SEAT_W = 0.46;
export const AISLE = 0.56;
export const RO = 1.88; // flykroppens radius
export const CY = 0.6; // sentrum av tverrsnittet over kabingulvet
export const CUT = 1.5; // her er taket kuttet av
export const TILT = 0.12; // seteryggens helning (rad)

/** Halv bredde av flykroppen i høyden y. */
export const halvBredde = (y) => Math.sqrt(Math.max(0, RO * RO - (y - CY) ** 2));

/** Seteoppsettet fra dataene: kolonner (x), rader (z), soner foran og bak, og oppslag sete → plassering. */
export function lagLayout(kabin) {
  const blokker = kabin.oppsett.split('|');
  const kolonner = [];
  const midtganger = [];
  const blokkEnder = []; // seter med armlene også på høyre side
  let x = 0;
  blokker.forEach((b, i) => {
    if (i) { midtganger.push(x + AISLE / 2); x += AISLE; }
    for (const L of b) { kolonner.push({ L, x: x + SEAT_W / 2 }); x += SEAT_W; }
    blokkEnder.push(b[b.length - 1]);
  });
  const bredde = x;
  kolonner.forEach((k) => { k.x -= bredde / 2; });
  midtganger.forEach((m, i) => { midtganger[i] = m - bredde / 2; });

  const uten = new Set(kabin.utenRader);
  const rader = [];
  for (let r = 1, i = 0; rader.length < kabin.rader && r < 99; r++) {
    if (uten.has(r)) continue;
    rader.push({ nr: r, z: i * PITCH });
    i++;
  }
  const seter = new Map();
  for (const rad of rader) {
    for (const k of kolonner) {
      const id = `${rad.nr}${k.L}`;
      seter.set(id, { id, rad: rad.nr, L: k.L, x: k.x, z: rad.z, ende: blokkEnder.includes(k.L) });
    }
  }
  const sisteZ = rader.length ? rader[rader.length - 1].z : 0;
  const vingeZ = rader[Math.max(0, Math.round(rader.length * 0.33) - 1)]?.z ?? 8; // vingeroten (forkant)
  return {
    kolonner, rader, seter, midtganger, bredde, sisteZ,
    radZ: new Map(rader.map((r) => [r.nr, r.z])),
    midtgang: midtganger[0] ?? 0,
    zCockpitVegg: -3.85, // skottet mellom cockpit og kabin, rett bak pilotsetene
    zNese: -4.8, // der sylinderen slutter og nesekjeglen begynner
    zBak: sisteZ + 2.9, // akterste trykkskott
    vingeZ,
    // Lasterommene under gulvet, foran og bak vingekassa: [fra z, til z].
    lasterom: [[(rader[0]?.z ?? 0) + 0.4, vingeZ - 0.4], [vingeZ + 6.6, sisteZ - 0.6]],
    nokkel: `${kabin.oppsett}/${rader.map((r) => r.nr).join(',')}`,
  };
}

/* ---------- Hjelpere ---------- */

/** Slår sammen geometrier; RoundedBox er uten indeks, så alt gjøres indeksløst først. */
const mergeGeometries = (geos) => flett(geos.map((g) => (g.index ? g.toNonIndexed() : g)));
const rb = (w, h, d, r) => new RoundedBoxGeometry(w, h, d, 3, r);
const boks = (w, h, d) => new THREE.BoxGeometry(w, h, d);
/** Vrir geometrien rundt sitt eget sentrum og flytter den på plass. */
const del = (geo, x, y, z, rx = 0, ry = 0) => {
  if (geo.isBufferGeometry) { geo.rotateX(rx); geo.rotateY(ry); geo.translate(x, y, z); return geo; }
  geo.rotation.set(rx, ry, 0); geo.position.set(x, y, z); return geo; // Mesh
};
/** Punkt på en seterygg som heller TILT bakover: h meter over ryggens sentrum (y 0,82, z 0,23). */
const rygg = (h, dz = 0) => [0.82 + h, 0.23 + h * Math.sin(TILT) + dz];

function std(farge, ekstra = {}) {
  return dimKabin(new THREE.MeshStandardMaterial({ color: farge, roughness: 0.7, metalness: 0, ...ekstra }));
}

function skygge(o) {
  o.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  return o;
}

/* ---------- Seter ---------- */

function seteGeometrier() {
  const [ry, rz] = rygg(0);
  const [hy, hz] = rygg(0.24, 0.03);
  const [sy, sz] = rygg(0, 0.075);
  const [ty, tz] = rygg(-0.04, 0.103);
  const [py, pz] = rygg(-0.3, 0.1);
  const [ly, lz] = rygg(0.12, 0.105);
  const stoff = mergeGeometries([
    del(rb(0.43, 0.12, 0.47, 0.04), 0, 0.45, -0.02), // setepute
    del(rb(0.43, 0.62, 0.11, 0.045), 0, ry, rz, TILT), // ryggpute
  ]);
  const trekk = del(rb(0.38, 0.17, 0.125, 0.03), 0, hy, hz, TILT); // nakkestøtte
  const plast = mergeGeometries([
    del(rb(0.45, 0.66, 0.05, 0.02), 0, sy, sz, TILT), // ryggskall
    del(rb(0.36, 0.15, 0.03, 0.01), 0, py, pz, TILT), // setelomme
    del(rb(0.05, 0.05, 0.4, 0.015), -0.235, 0.64, 0.0), // armlene venstre
  ]);
  const metall = mergeGeometries([
    del(boks(0.035, 0.4, 0.035), -0.17, 0.2, -0.14),
    del(boks(0.035, 0.4, 0.035), -0.17, 0.2, 0.14),
    del(boks(0.46, 0.035, 0.035), 0, 0.38, -0.12),
    del(boks(0.46, 0.035, 0.035), 0, 0.38, 0.14),
    del(boks(0.025, 0.17, 0.025), -0.235, 0.54, 0.13), // armlenestøtte
    del(boks(0.05, 0.012, 0.02), 0, ly, lz, TILT), // lås til klappbordet
  ]);
  const hoyreArm = mergeGeometries([
    del(rb(0.05, 0.05, 0.4, 0.015), 0.235, 0.64, 0.0),
    del(boks(0.025, 0.17, 0.025), 0.235, 0.54, 0.13),
  ]);
  const bord = del(rb(0.36, 0.25, 0.012, 0.004), 0, ty, tz, TILT); // klappbordet (lukket), egen instans så det kan felles ned
  return { stoff, trekk, plast, metall, hoyreArm, bord };
}

function byggSeter(layout, g) {
  const geo = seteGeometrier();
  const stoffTex = seteStoff(); stoffTex.repeat.set(2, 2);
  const mats = {
    stoff: std(0xffffff, { map: stoffTex, roughness: 0.95 }),
    trekk: std(0xffffff, { map: nakkeTrekk(), roughness: 0.8 }),
    plast: std(0xd6d3cc, { roughness: 0.5 }),
    metall: std(0x8e949c, { roughness: 0.35, metalness: 0.75 }),
  };
  const n = layout.seter.size;
  const ender = [...layout.seter.values()].filter((s) => s.ende).length;
  const im = {
    stoff: new THREE.InstancedMesh(geo.stoff, mats.stoff, n),
    trekk: new THREE.InstancedMesh(geo.trekk, mats.trekk, n),
    plast: new THREE.InstancedMesh(geo.plast, mats.plast, n),
    metall: new THREE.InstancedMesh(geo.metall, mats.metall, n),
    hoyreArm: new THREE.InstancedMesh(geo.hoyreArm, mats.plast, ender),
    bord: new THREE.InstancedMesh(geo.bord, std(0xcfcbc3, { roughness: 0.5 }), n),
  };
  const m = new THREE.Matrix4();
  const ider = [];
  let i = 0, e = 0;
  for (const s of layout.seter.values()) {
    m.makeTranslation(s.x, 0, s.z);
    im.stoff.setMatrixAt(i, m); im.trekk.setMatrixAt(i, m); im.plast.setMatrixAt(i, m); im.metall.setMatrixAt(i, m); im.bord.setMatrixAt(i, m);
    if (s.ende) { im.hoyreArm.setMatrixAt(e, m); e++; }
    ider.push(s.id);
    i++;
  }
  for (const v of Object.values(im)) { skygge(v); g.add(v); }
  // Klappbordet sitter på ryggen til setet foran. Når en passasjer har fått servert, er det nede (skjult her).
  const indeks = new Map(ider.map((id, j) => [id, j]));
  const foran = (id) => {
    const s = layout.seter.get(id);
    const r = layout.rader.findIndex((x) => x.nr === s?.rad);
    return r > 0 ? `${layout.rader[r - 1].nr}${s.L}` : null;
  };
  const null0 = new THREE.Matrix4().makeScale(0, 0, 0);
  function settKlappbord(nede) {
    for (const [id, j] of indeks) {
      const s = layout.seter.get(id);
      im.bord.setMatrixAt(j, m.makeTranslation(s.x, 0, s.z));
    }
    for (const id of nede) { const f = foran(id); if (f && indeks.has(f)) im.bord.setMatrixAt(indeks.get(f), null0); }
    im.bord.instanceMatrix.needsUpdate = true;
  }
  return { treff: [im.stoff, im.plast], ider, settKlappbord };
}

/* ---------- Toalett, bysse, cockpit ---------- */

/** Toalettrom 1×1 m med dør mot midtgangen (doerSide = +1: døra på +x-siden).
 *  Toalett med stålskål, oval sete-ring og oppfelt lokk mot ytterveggen; servant med stålvask, kran,
 *  skap under og speil med lys over; dorull, håndtak og mørkt sklisikkert gulv. */
function toalett(cx, cz, doerSide, vegg, hvit) {
  const g = new THREE.Group();
  const ds = doerSide;
  const h = CUT - 0.03;
  const t = 0.04;
  const doerMat = std(0xbfb9ae, { roughness: 0.5 });
  const staal = std(0xb9bec6, { metalness: 0.85, roughness: 0.22 });
  const plast = std(0xe9e6df, { roughness: 0.45 });
  const graa = std(0x4a4f57, { roughness: 0.9 });
  // Vegger og dør.
  g.add(del(new THREE.Mesh(boks(1.0, h, t), vegg), 0, h / 2, -0.5));
  g.add(del(new THREE.Mesh(boks(1.0, h, t), vegg), 0, h / 2, 0.5));
  g.add(del(new THREE.Mesh(boks(t, h, 1.0), vegg), -0.5 * ds, h / 2, 0));
  g.add(del(new THREE.Mesh(boks(t, h, 0.2), vegg), 0.5 * ds, h / 2, -0.4));
  g.add(del(new THREE.Mesh(boks(t, h, 0.2), vegg), 0.5 * ds, h / 2, 0.4));
  g.add(del(new THREE.Mesh(boks(0.03, h - 0.1, 0.6), doerMat), 0.5 * ds, (h - 0.1) / 2, 0));
  g.add(del(new THREE.Mesh(boks(0.04, 0.03, 0.12), staal), 0.47 * ds, 0.95, 0.2)); // dørhåndtak innvendig
  // Gulv.
  g.add(del(new THREE.Mesh(new THREE.PlaneGeometry(0.96, 0.96), graa), 0, 0.005, 0, -Math.PI / 2));
  // Toalettet: innkledning mot ytterveggen, sokkel, stålskål, sete-ring og lokket felt opp.
  const tz = -0.18, tx = -0.2 * ds;
  g.add(del(new THREE.Mesh(rb(0.16, 0.8, 0.48, 0.03), plast), -0.4 * ds, 0.4, tz));
  g.add(del(new THREE.Mesh(rb(0.34, 0.36, 0.3, 0.06), plast), tx - 0.02 * ds, 0.18, tz));
  const skaal = new THREE.Mesh(new THREE.SphereGeometry(0.15, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), staal);
  skaal.scale.set(1.25, 0.5, 1); skaal.position.set(tx, 0.42, tz); skaal.rotation.y = Math.PI / 2;
  g.add(skaal);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.028, 10, 32), plast);
  ring.rotation.x = -Math.PI / 2; ring.scale.set(1.25, 1, 1); ring.position.set(tx, 0.44, tz);
  g.add(ring);
  g.add(del(new THREE.Mesh(rb(0.03, 0.38, 0.32, 0.02), plast), -0.31 * ds, 0.62, tz, 0, 0)); // lokket, oppfelt
  // Servanten bak toalettet: skap, benkeplate, innfelt vask, kran og speil med lys.
  const vz = 0.3;
  g.add(del(new THREE.Mesh(rb(0.55, 0.8, 0.36, 0.02), plast), -0.2 * ds, 0.4, vz));
  g.add(del(new THREE.Mesh(rb(0.58, 0.04, 0.38, 0.01), std(0xd7d3cb, { roughness: 0.3 })), -0.2 * ds, 0.82, vz));
  const vask = new THREE.Mesh(new THREE.SphereGeometry(0.1, 20, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), staal);
  vask.scale.set(1.3, 0.5, 1); vask.position.set(-0.22 * ds, 0.84, vz - 0.02);
  g.add(vask);
  g.add(del(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.12, 10), staal), -0.22 * ds, 0.9, vz + 0.13));
  g.add(del(new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.08, 8), staal), -0.22 * ds, 0.955, vz + 0.1, Math.PI / 2));
  g.add(del(new THREE.Mesh(rb(0.06, 0.12, 0.05, 0.01), plast), -0.4 * ds, 0.92, vz + 0.12)); // såpedispenser
  const speil = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.38), std(0xdfe6ee, { metalness: 1, roughness: 0.04 }));
  speil.position.set(-0.2 * ds, 1.12, 0.477); speil.rotation.y = Math.PI;
  g.add(speil);
  g.add(del(new THREE.Mesh(boks(0.5, 0.03, 0.02), new THREE.MeshBasicMaterial({ color: 0xfff1d6 })), -0.2 * ds, 1.35, 0.47)); // lys over speilet
  // Dorull og håndtak på veggen ved toalettet.
  const dorull = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.1, 16), std(0xf6f6f2, { roughness: 0.9 }));
  dorull.rotation.z = Math.PI / 2; dorull.position.set(-0.05 * ds, 0.62, -0.44);
  g.add(dorull);
  const handtak = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.4, 10), staal);
  handtak.rotation.z = Math.PI / 2; handtak.position.set(-0.15 * ds, 0.92, -0.46);
  g.add(handtak);
  // Opptatt-lampe over døra (grønn = ledig, rød = opptatt).
  const lampe = new THREE.MeshStandardMaterial({ color: 0x101010, emissive: 0x2bd44a, emissiveIntensity: 1.2 });
  g.add(del(new THREE.Mesh(boks(0.02, 0.05, 0.12), lampe), 0.52 * ds, h - 0.05, 0));
  g.position.set(cx, 0, cz);
  skygge(g);
  return { gruppe: g, lampe, x: cx, z: cz, doerSide };
}

/** Bysse: trallebåser under benken, benkeplate i stål, ovner/kaffemaskin/bokser over, utstyr på benken. */
const BYSSE = { traller: null, ovn: null };
function bysse(x, z, bredde, roter) {
  BYSSE.traller ??= byssaTraller();
  BYSSE.ovn ??= byssaOvn();
  const g = new THREE.Group();
  const side = std(0x9aa0a8, { metalness: 0.4 });
  const trallTex = BYSSE.traller.clone(); trallTex.needsUpdate = true; trallTex.repeat.set(Math.max(1, Math.round(bredde / 0.32)), 1);
  const ovnTex = BYSSE.ovn.clone(); ovnTex.needsUpdate = true; ovnTex.repeat.set(Math.max(1, Math.round(bredde / 1.0)), 1);
  const nede = new THREE.Mesh(boks(bredde, 1.0, 0.55), [side, side, side, side, std(0xffffff, { map: trallTex, metalness: 0.35, roughness: 0.45 }), side]);
  nede.position.set(0, 0.5, 0);
  const benk = new THREE.Mesh(boks(bredde + 0.02, 0.035, 0.6), std(0xd9dce0, { metalness: 0.75, roughness: 0.25 }));
  benk.position.set(0, 1.018, 0.02);
  const oppeH = CUT - 0.04 - 1.06;
  const oppe = new THREE.Mesh(boks(bredde, oppeH, 0.32), [side, side, side, side, std(0xffffff, { map: ovnTex, metalness: 0.3, roughness: 0.4 }), side]);
  oppe.position.set(0, 1.06 + oppeH / 2, -0.115);
  g.add(nede, benk, oppe);
  // Utstyr på benken: kaffekanner, koppestabler og en isbøtte.
  const kanne = std(0x30343b, { metalness: 0.6, roughness: 0.3 });
  const kopp = std(0xf2f2f0, { roughness: 0.4 });
  for (let i = 0; i < Math.floor(bredde / 0.45); i++) {
    const bx = -bredde / 2 + 0.2 + i * 0.45;
    g.add(del(new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.2, 14), kanne), bx, 1.135, 0.12));
    g.add(del(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.032, 0.16, 12), kopp), bx + 0.14, 1.115, 0.16));
  }
  g.add(del(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.08, 0.14, 16), std(0x9fb8d0, { metalness: 0.5, roughness: 0.3 })), bredde / 2 - 0.15, 1.105, 0.1));
  g.position.set(x, 0, z);
  g.rotation.y = roter;
  return skygge(g);
}

/* ---------- Skillevegger og forheng ---------- */

const forhengMat = new THREE.MeshStandardMaterial({ color: 0x1c2a5c, roughness: 1, side: THREE.DoubleSide });
const skinneMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 0.7, roughness: 0.3 });

/** Forheng på en skinne over midtgangen. andel = hvor mye av gangen som er trukket for (fra venstre). */
function forheng(g, x, z, andel) {
  const bredde = AISLE + 0.1;
  const h = CUT - 0.08;
  const b = bredde * andel;
  const geo = new THREE.PlaneGeometry(b, h, Math.max(6, Math.round(b / 0.02)), 1);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, 0.035 * Math.sin((p.getX(i) / 0.11) * Math.PI * 2)); // folder
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, forhengMat);
  m.position.set(x - bredde / 2 + b / 2, h / 2 + 0.03, z);
  m.castShadow = true;
  g.add(m);
  g.add(del(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, bredde, 8), skinneMat), x, CUT - 0.04, z, 0, 0));
  g.children[g.children.length - 1].rotation.z = Math.PI / 2;
}

/** Skillevegger i full høyde fra midtgangen ut til skroget (følger rundingen), og forheng mellom dem. */
function skilleMedForheng(g, layout, z, mat, andel) {
  const topp = CUT - 0.02;
  for (const s of [-1, 1]) {
    const inner = layout.midtgang + s * (AISLE / 2 + 0.03);
    const form = new THREE.Shape();
    form.moveTo(inner, 0);
    form.lineTo(s * (halvBredde(0) - 0.01), 0);
    for (let i = 1; i <= 16; i++) { const y = (topp * i) / 16; form.lineTo(s * (halvBredde(y) - 0.01), y); }
    form.lineTo(inner, topp);
    form.closePath();
    const geo = new THREE.ExtrudeGeometry(form, { depth: 0.05, bevelEnabled: false });
    geo.translate(0, 0, -0.025);
    const m = new THREE.Mesh(geo, mat);
    m.position.z = z;
    g.add(skygge(m));
  }
  forheng(g, layout.midtgang, z, andel);
}

/* ---------- Kabinen ---------- */

/** Bygger alt innenfor flykroppen: gulv, seter, bysser, toaletter, cockpit og serveringsvogn. */
export function byggKabin(layout) {
  const g = new THREE.Group();
  const zA = layout.zCockpitVegg; // cockpit har eget gulv
  const zB = layout.zBak;
  const lengde = zB - zA;
  const midtZ = (zA + zB) / 2;

  // Teppe på kabingulvet, mørkt gulv i cockpit, og nødlys langs midtgangen.
  const gulvB = halvBredde(0) * 2;
  const tex = teppe(); tex.repeat.set(gulvB / 0.6, lengde / 0.6);
  const gulv = new THREE.Mesh(new THREE.PlaneGeometry(gulvB, lengde), std(0xffffff, { map: tex, roughness: 1 }));
  gulv.rotation.x = -Math.PI / 2;
  gulv.position.set(0, 0, midtZ);
  gulv.receiveShadow = true;
  g.add(gulv);
  const forste = layout.rader[0]?.z ?? 0;
  const lysN = Math.floor((layout.sisteZ - forste) / 0.5) + 1;
  const nodlys = new THREE.InstancedMesh(boks(0.025, 0.006, 0.12), new THREE.MeshBasicMaterial({ color: 0xffd28a }), lysN * 2);
  const m = new THREE.Matrix4();
  for (let i = 0; i < lysN; i++) {
    for (const [j, s] of [[0, -1], [1, 1]]) { m.makeTranslation(layout.midtgang + s * (AISLE / 2 - 0.03), 0.004, forste + i * 0.5); nodlys.setMatrixAt(i * 2 + j, m); }
  }
  g.add(nodlys);
  // Glød på teppet rundt hvert nødlys (tydeligere når kabinen er dempet), og en svak lysstripe langs gangen.
  const nodGlod = glodMat('rund', 0xffc870, 0.25);
  const glodGeo = new THREE.PlaneGeometry(0.36, 0.5); glodGeo.rotateX(-Math.PI / 2);
  const glodInst = new THREE.InstancedMesh(glodGeo, nodGlod, lysN * 2);
  for (let i = 0; i < lysN * 2; i++) { nodlys.getMatrixAt(i, m); m.elements[13] = 0.006; glodInst.setMatrixAt(i, m); }
  glodInst.renderOrder = 2;
  g.add(glodInst);

  const seter = byggSeter(layout, g);

  // Sone foran: toalett til venstre, bysse til høyre, skillevegger foran rad 1.
  const veggMat = std(0xe2ddd3, { roughness: 0.6 });
  const hvit = std(0xf4f4f2, { roughness: 0.25 });
  const front = bysseFront();
  const zv = layout.zCockpitVegg;
  const toaletter = [toalett(-1.15, zv + 0.55, 1, veggMat, hvit)];
  // Byssa foran er L-formet: mot cockpitskottet og langs høyre vegg, foran servicedøra (R1).
  g.add(bysse(1.08, zv + 0.32, 1.12, 0)); // mot cockpitskottet, til høyre for cockpitdøra
  g.add(bysse(1.45, zv + 1.32, 1.35, -Math.PI / 2)); // langs høyre vegg, foran servicedøra
  // Skillevegger i full høyde mellom byssa og rad 1, med forheng i midtgangen.
  skilleMedForheng(g, layout, forste - 0.62, veggMat, 0.55);

  // Sone bak: to toaletter og byssa på tvers.
  const zL = layout.sisteZ;
  toaletter.push(toalett(-1.15, zL + 1.1, 1, veggMat, hvit), toalett(1.15, zL + 1.1, -1, veggMat, hvit)); // foran de bakre dørene (L2/R2)
  // Forheng bak, mellom siste rad og toalettene/byssa.
  forheng(g, layout.midtgang, zL + 0.45, 0.45);
  g.add(bysse(0, zB - 0.32, 2.6, Math.PI));
  for (const t of toaletter) g.add(t.gruppe);

  const cp = byggCockpit(layout);
  g.add(cp.gruppe);

  // Lysrampe langs toppen av kabinveggene (glør om kvelden og natta).
  const lysrampe = new THREE.MeshBasicMaterial({ color: 0x8a7a66 });
  const hwCut = halvBredde(CUT - 0.04);
  for (const s of [-1, 1]) g.add(del(new THREE.Mesh(boks(0.03, 0.025, layout.sisteZ - forste + 1.6), lysrampe), s * (hwCut - 0.12), CUT - 0.07, (forste + layout.sisteZ) / 2));
  // Lysskjæret nedover kabinveggen fra rampa (samme farge som rampa).
  const veggSkjaer = glodMat('ned', 0xffe2b8, 0.2);
  for (const s of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(layout.sisteZ - forste + 1.6, 0.55), veggSkjaer);
    p.rotation.y = s * Math.PI / 2;
    p.position.set(s * (hwCut - 0.06), CUT - 0.36, (forste + layout.sisteZ) / 2);
    p.renderOrder = 2;
    g.add(p);
  }

  // Setebelteskilt på skilleveggen foran rad 1.
  const skiltMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0x000000 });
  g.add(del(new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.1), skiltMat), layout.midtgang + 1.12, 1.0, forste - 0.59));

  // Serveringsvogna med noen kopper på toppen.
  const vogn = new THREE.Group();
  const vognTex = front.clone(); vognTex.needsUpdate = true;
  const metallV = std(0xb8bcc4, { metalness: 0.5, roughness: 0.35 });
  const frontV = std(0xffffff, { map: vognTex, metalness: 0.4 });
  vogn.add(del(new THREE.Mesh(rb(0.3, 0.98, 0.8, 0.02), [metallV, metallV, metallV, metallV, frontV, frontV]), 0, 0.53, 0));
  vogn.add(del(new THREE.Mesh(rb(0.31, 0.03, 0.81, 0.01), std(0x1f5be0, { roughness: 0.4 })), 0, 1.035, 0));
  [0xd33c3c, 0x3c7bd3, 0xf2f2f2].forEach((f, i) => {
    vogn.add(del(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.09, 10), std(f)), 0, 1.095, -0.25 + i * 0.2));
  });
  vogn.visible = false;
  vogn.position.set(layout.midtgang, 0, forste);
  g.add(skygge(vogn));

  return { gruppe: g, seteMesher: seter.treff, seteIder: seter.ider, settKlappbord: seter.settKlappbord, skiltMat, vogn, toaletter, lysrampe, nodGlod, veggSkjaer, cockpit: cp };
}
