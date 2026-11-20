import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { CUT, halvBredde } from './cabin.js';
import { Skjermer } from './displays.js';

// Cockpiten i en 737-800NG, sett ovenfra gjennom snittet:
// hovedpanel (MIP) med seks skjermer og reserveinstrument, hjulspak og klokke; glareshield med MCP og
// EFIS-paneler; pidestall med to CDU-er, gasshendler, speedbrake, flapspak, trimhjul og radiopaneler;
// 737-ratt, pedaler, pilotseter med saueskinn, sidekonsoller med styrehjul, og skottet med døra.
// Om kvelden og natta dempes cockpit (COCKPIT), mens skjermene lyser som før.

/** Lysnivået i cockpit (1 = dag). Skjermene påvirkes ikke. */
export const COCKPIT = { value: 1 };
export function settCockpitLys(f) { COCKPIT.value = f; }

/** Gjør et materiale dimbart med cockpitlyset. */
export function dimCockpit(m) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uCockpit = COCKPIT;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uCockpit;')
      .replace('#include <opaque_fragment>', '#include <opaque_fragment>\ngl_FragColor.rgb *= uCockpit;');
  };
  return m;
}

const std = (farge, ekstra = {}) => dimCockpit(new THREE.MeshStandardMaterial({ color: farge, roughness: 0.6, metalness: 0.05, ...ekstra }));
const rb = (w, h, d, r = 0.015) => new RoundedBoxGeometry(w, h, d, 2, r);
const boks = (w, h, d) => new THREE.BoxGeometry(w, h, d);
function mesh(geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

/* ---------- Panelteksturer (knapper, brytere og tekst) ---------- */
function panelTekstur(w, h, tegn) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.fillStyle = '#3c4148'; x.fillRect(0, 0, w, h);
  tegn(x, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
const merke = (x, t, px, py, str = 10) => { x.fillStyle = '#e8e8e8'; x.font = `600 ${str}px system-ui, sans-serif`; x.textAlign = 'center'; x.fillText(t, px, py); };
const vrider = (x, px, py, r = 9) => { x.fillStyle = '#15171a'; x.beginPath(); x.arc(px, py, r, 0, 7); x.fill(); x.strokeStyle = '#888'; x.lineWidth = 1; x.stroke(); x.fillStyle = '#ddd'; x.fillRect(px - 1, py - r + 2, 2, r - 2); };
const vindu7 = (x, px, py, w, t) => { x.fillStyle = '#000'; x.fillRect(px, py, w, 16); x.fillStyle = '#ffb000'; x.font = '600 13px ui-monospace, monospace'; x.textAlign = 'center'; x.fillText(t, px + w / 2, py + 13); };

const radioTekstur = () => panelTekstur(256, 512, (x, w) => {
  // VHF 1/2, NAV 1/2, ADF, transponder og værradar.
  const rader = [['VHF 1', '118.700', '121.500'], ['VHF 2', '121.800', '122.800'], ['NAV 1', '110.30', '113.90'], ['NAV 2', '112.50', '115.10']];
  rader.forEach(([t, a, b], i) => {
    const y = 14 + i * 74;
    x.strokeStyle = '#555'; x.strokeRect(6, y, w - 12, 66);
    merke(x, t, w / 2, y + 12);
    vindu7(x, 18, y + 20, 92, a); vindu7(x, w - 110, y + 20, 92, b);
    vrider(x, 64, y + 52, 8); vrider(x, w - 64, y + 52, 8);
  });
  const y = 14 + 4 * 74;
  x.strokeStyle = '#555'; x.strokeRect(6, y, w - 12, 76);
  merke(x, 'ATC / TCAS', w / 2, y + 12);
  vindu7(x, w / 2 - 40, y + 20, 80, '2000');
  vrider(x, 40, y + 55); vrider(x, w - 40, y + 55); vrider(x, w / 2, y + 58, 11);
  const y2 = y + 86;
  x.strokeStyle = '#555'; x.strokeRect(6, y2, w - 12, 100);
  merke(x, 'WXR', w / 2, y2 + 12);
  ['TEST', 'WX', 'WX+T', 'MAP'].forEach((t, i) => { x.fillStyle = '#1b1d21'; x.fillRect(16 + i * 58, y2 + 28, 48, 20); merke(x, t, 40 + i * 58, y2 + 42, 9); });
  vrider(x, 70, y2 + 76, 10); vrider(x, w - 70, y2 + 76, 10);
});

const cduTast = () => panelTekstur(256, 256, (x, w, h) => {
  x.fillStyle = '#2a2d32'; x.fillRect(0, 0, w, h);
  const taster = ['INIT REF', 'RTE', 'CLB', 'CRZ', 'DES', 'MENU', 'LEGS', 'DEP ARR', 'HOLD', 'PROG', 'EXEC', 'N1 LIM', 'FIX', 'PREV', 'NEXT'];
  taster.forEach((t, i) => { const px = 8 + (i % 5) * 49, py = 8 + Math.floor(i / 5) * 30; x.fillStyle = '#1a1c1f'; x.fillRect(px, py, 44, 24); merke(x, t, px + 22, py + 16, 8); });
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach((t, i) => { const px = 112 + (i % 5) * 28, py = 104 + Math.floor(i / 5) * 25; x.fillStyle = '#1a1c1f'; x.fillRect(px, py, 24, 21); merke(x, t, px + 12, py + 15, 11); });
  '123456789.0-'.split('').forEach((t, i) => { const px = 10 + (i % 3) * 32, py = 104 + Math.floor(i / 3) * 34; x.fillStyle = '#1a1c1f'; x.fillRect(px, py, 28, 28); merke(x, t, px + 14, py + 19, 13); });
});

const efisTekstur = () => panelTekstur(256, 80, (x, w) => {
  merke(x, 'MINS', 30, 14, 9); vrider(x, 30, 40, 13);
  merke(x, 'MODE', 92, 14, 9); vrider(x, 92, 40, 13);
  merke(x, 'RANGE', 154, 14, 9); vrider(x, 154, 40, 13);
  ['WXR', 'STA', 'WPT', 'ARPT', 'DATA', 'POS', 'TERR'].forEach((t, i) => { x.fillStyle = '#1b1d21'; x.fillRect(4 + i * 36, 62, 32, 14); merke(x, t, 20 + i * 36, 73, 8); });
  merke(x, 'BARO', 220, 14, 9); vrider(x, 220, 40, 13);
});

const sauTekstur = () => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#d9cdb4'; x.fillRect(0, 0, 128, 128);
  let s = 3; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 1400; i++) { x.fillStyle = `rgba(${150 + rnd() * 80},${135 + rnd() * 70},${100 + rnd() * 60},0.5)`; x.beginPath(); x.arc(rnd() * 128, rnd() * 128, 1 + rnd() * 2.5, 0, 7); x.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
};

const trimTekstur = () => {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 16;
  const x = c.getContext('2d');
  x.fillStyle = '#141517'; x.fillRect(0, 0, 256, 16);
  x.fillStyle = '#e8e8e8'; x.fillRect(120, 0, 16, 16);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
};

/* ---------- Byggingen ---------- */

/** Bygger cockpit. z0 = der sylinderen begynner (layout.zNese), zv = skottet mot kabinen. */
export function byggCockpit(layout) {
  const g = new THREE.Group();
  // Panelet står under frontruta, som ligger på den skrå delen av nesa (1,1 m foran sylinderen).
  const z0 = layout.zNese - 1.1, zv = layout.zCockpitVegg;
  const grå = std(0x3c4148, { roughness: 0.7 }); // Boeing-grå
  const mork = std(0x23262b, { roughness: 0.65 });
  const sort = std(0x121315, { roughness: 0.5 });
  const metall = std(0x9aa0a8, { metalness: 0.7, roughness: 0.35 });
  const hvit = std(0xe9e9e6, { roughness: 0.4 });
  const skjermer = new Skjermer();
  const lys = (tex) => new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }); // skjermene lyser alltid

  // Gulvet i cockpit.
  const gulv = mesh(new THREE.PlaneGeometry(3.3, zv - z0 + 0.8), std(0x2e3137, { roughness: 0.95 }), 0, 0.003, (z0 - 0.8 + zv) / 2, -Math.PI / 2);
  g.add(gulv);

  /* Hovedpanelet (MIP), litt tiltet mot pilotene. Alt på panelet ligger i mip-gruppa. */
  const mip = new THREE.Group();
  mip.position.set(0, 0.8, z0 + 0.02);
  mip.rotation.x = -0.14;
  mip.add(mesh(rb(2.36, 0.62, 0.22, 0.02), grå, 0, 0, 0));
  mip.add(mesh(rb(1.2, 0.45, 0.2, 0.02), mork, 0, -0.5, 0.0)); // kneledd/nedre panel
  const DU = 0.19;
  const ramme = rb(DU + 0.03, DU + 0.03, 0.02, 0.006);
  const du = (tex, x, y) => {
    mip.add(mesh(ramme, sort, x, y, 0.115));
    const s = new THREE.Mesh(new THREE.PlaneGeometry(DU, DU), lys(tex));
    s.position.set(x, y, 0.127);
    mip.add(s);
  };
  du(skjermer.pfd.tex, -0.93, 0.06); du(skjermer.nd.tex, -0.7, 0.06);
  du(skjermer.eicas.tex, 0, 0.1); du(skjermer.nedre.tex, 0, -0.14);
  du(skjermer.nd.tex, 0.7, 0.06); du(skjermer.pfd.tex, 0.93, 0.06);
  // Reserveinstrumentet (ISFD) og klokkene.
  mip.add(mesh(rb(0.1, 0.1, 0.02, 0.005), sort, -0.46, 0.13, 0.115));
  const isfd = new THREE.Mesh(new THREE.PlaneGeometry(0.085, 0.085), lys(skjermer.pfd.tex));
  isfd.position.set(-0.46, 0.13, 0.127); mip.add(isfd);
  for (const x of [-1.1, 1.1]) mip.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.02, 24), sort, x, 0.2, 0.12, Math.PI / 2));
  // Hjulspaken med hjulformet knott (oppe i lufta, nede på bakken), og autobrake.
  mip.add(mesh(rb(0.1, 0.2, 0.02), mork, 0.38, 0.04, 0.115));
  const hjulspak = new THREE.Group();
  hjulspak.position.set(0.38, 0.04, 0.13);
  hjulspak.add(mesh(boks(0.015, 0.12, 0.015), metall, 0, 0, 0.03, 0.4));
  hjulspak.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 20), hvit, 0, 0.055, 0.055, Math.PI / 2));
  mip.add(hjulspak);
  mip.add(mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.02, 16), sort, 0.38, -0.12, 0.12, Math.PI / 2));
  g.add(mip);

  /* Glareshield med MCP og EFIS-panelene. */
  g.add(mesh(rb(2.5, 0.08, 0.5, 0.03), sort, 0, 1.14, z0 - 0.02));
  const mcp = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.11), lys(skjermer.mcp.tex));
  mcp.position.set(0, 1.09, z0 + 0.232); mcp.rotation.x = -0.25;
  g.add(mesh(rb(1.24, 0.13, 0.05), grå, 0, 1.09, z0 + 0.2, -0.25), mcp);
  const efis = std(0xffffff, { map: efisTekstur() });
  for (const x of [-0.95, 0.95]) g.add(mesh(new THREE.PlaneGeometry(0.34, 0.1), efis, x, 1.09, z0 + 0.232, -0.25));
  // Standby-kompasset på midtstolpen.
  g.add(mesh(rb(0.07, 0.06, 0.05), sort, 0, 1.3, z0 - 0.15));

  /* Pidestallen: CDU-er foran, gasshendlene i midten, radiopanelene bak. */
  const pz = z0 + 0.2;
  g.add(mesh(rb(0.46, 0.76, 0.42), grå, 0, 0.38, pz + 0.2));
  g.add(mesh(rb(0.46, 0.66, 0.5), grå, 0, 0.33, pz + 0.66));
  g.add(mesh(rb(0.46, 0.58, 0.5), grå, 0, 0.29, pz + 1.15));
  const cduTex = cduTast();
  for (const x of [-0.115, 0.115]) {
    const cdu = new THREE.Group();
    cdu.position.set(x, 0.77, pz + 0.2); cdu.rotation.x = -0.9;
    cdu.add(mesh(rb(0.21, 0.36, 0.03), mork, 0, 0, 0));
    const skjerm = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.13), lys(skjermer.cdu.tex));
    skjerm.position.set(0, 0.09, 0.017); cdu.add(skjerm);
    const tast = new THREE.Mesh(new THREE.PlaneGeometry(0.19, 0.17), std(0xffffff, { map: cduTex }));
    tast.position.set(0, -0.08, 0.017); cdu.add(tast);
    g.add(cdu);
  }
  // Gasskvadranten: to hendler, speedbrake (venstre), flaps (høyre), trimhjul på sidene.
  const kvadrant = new THREE.Group();
  kvadrant.position.set(0, 0.67, pz + 0.66);
  kvadrant.add(mesh(boks(0.3, 0.02, 0.36), sort, 0, 0, 0));
  const hendler = [-0.05, 0.05].map((x) => {
    const h = new THREE.Group(); h.position.set(x, 0, 0.05);
    h.add(mesh(boks(0.018, 0.2, 0.018), metall, 0, 0.1, 0));
    h.add(mesh(rb(0.06, 0.035, 0.045, 0.01), sort, x * 0.6, 0.2, 0));
    kvadrant.add(h);
    return h;
  });
  const speedbrake = new THREE.Group(); speedbrake.position.set(-0.13, 0, 0.12); speedbrake.rotation.x = 0.5;
  speedbrake.add(mesh(boks(0.015, 0.16, 0.015), metall, 0, 0.08, 0), mesh(rb(0.03, 0.03, 0.06, 0.01), hvit, 0, 0.16, 0));
  kvadrant.add(speedbrake);
  const flaps = new THREE.Group(); flaps.position.set(0.13, 0, 0.05);
  flaps.add(mesh(boks(0.015, 0.14, 0.015), metall, 0, 0.07, 0), mesh(rb(0.035, 0.03, 0.05, 0.01), hvit, 0, 0.14, 0));
  kvadrant.add(flaps);
  const trimMat = std(0xffffff, { map: trimTekstur() });
  const trimhjul = [-0.245, 0.245].map((x) => {
    const t = mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.035, 32), [trimMat, sort, sort], x, -0.07, 0.04, 0, 0, Math.PI / 2);
    kvadrant.add(t);
    return t;
  });
  kvadrant.add(mesh(boks(0.04, 0.012, 0.08), std(0xd23a2a), -0.06, 0.012, -0.14)); // parkeringsbrems
  g.add(kvadrant);
  g.add(mesh(new THREE.PlaneGeometry(0.42, 0.46), std(0xffffff, { map: radioTekstur() }), 0, 0.581, pz + 1.15, -Math.PI / 2));

  /* Rattene, pedalene, setene og sidekonsollene for begge piloter. */
  const sau = std(0xffffff, { map: sauTekstur(), roughness: 1 });
  sau.map.repeat.set(2, 3);
  for (const [s, x] of [[-1, -0.55], [1, 0.55]]) {
    // Rattsøyla fra gulvet og 737-rattet (W-form med håndtak og sjekklisteklype).
    g.add(mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.72, 12), mork, x, 0.36, z0 + 0.5, -0.12));
    const ratt = new THREE.Group();
    ratt.position.set(x, 0.76, z0 + 0.46); ratt.rotation.x = -0.35;
    ratt.add(mesh(rb(0.09, 0.07, 0.05), sort, 0, 0, 0));
    for (const k of [-1, 1]) {
      ratt.add(mesh(boks(0.15, 0.032, 0.035), sort, k * 0.09, 0.025, 0, 0, 0, k * 0.55));
      ratt.add(mesh(new THREE.CylinderGeometry(0.018, 0.02, 0.13, 10), sort, k * 0.16, 0.1, 0, 0, 0, -k * 0.12));
    }
    ratt.add(mesh(new THREE.PlaneGeometry(0.07, 0.05), hvit, 0, 0.02, 0.027));
    g.add(ratt);
    // Pedaler.
    for (const k of [-1, 1]) g.add(mesh(rb(0.08, 0.22, 0.03), mork, x + k * 0.12, 0.13, z0 + 0.32, -0.5));
    // Setet: sokkel, sete og rygg med saueskinn, nakkestøtte og armlener.
    const sete = new THREE.Group();
    sete.position.set(x, 0, z0 + 1.2);
    sete.add(mesh(boks(0.1, 0.38, 0.1), metall, 0, 0.19, 0.05));
    sete.add(mesh(boks(0.42, 0.04, 0.5), mork, 0, 0.4, 0));
    sete.add(mesh(rb(0.48, 0.1, 0.5, 0.04), sau, 0, 0.47, 0));
    sete.add(mesh(rb(0.48, 0.72, 0.12, 0.05), sau, 0, 0.88, 0.26, 0.14));
    sete.add(mesh(rb(0.3, 0.17, 0.1, 0.04), mork, 0, 1.3, 0.33, 0.14));
    for (const k of [-1, 1]) sete.add(mesh(rb(0.06, 0.05, 0.36, 0.02), mork, k * 0.28, 0.7, 0.04));
    g.add(sete);
    // Sidekonsoll mot veggen; styrehjulet for nesehjulet (tiller) står på kapteinens side.
    g.add(mesh(rb(0.32, 0.22, 1.3, 0.03), grå, s * 1.2, 0.62, z0 + 0.95));
    g.add(mesh(rb(0.12, 0.1, 0.2, 0.02), std(0xc8b830), s * 1.2, 0.78, z0 + 1.4)); // oksygenmaske
    if (s < 0) {
      g.add(mesh(new THREE.TorusGeometry(0.07, 0.012, 8, 24), sort, -1.2, 0.79, z0 + 0.75, -Math.PI / 2));
      g.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.06, 8), sort, -1.15, 0.81, z0 + 0.75));
      g.add(mesh(rb(0.08, 0.32, 0.4, 0.02), std(0x2a2a30), -1.0, 0.16, z0 + 1.3)); // flight bag
    }
  }

  /* Indirekte lys: lysstripe under glareshielden, mykt flomlys over panel og pidestall, og et varmt
     punktlys med kort rekkevidde så kabinen ikke påvirkes. Glødene blir tydeligere når det er mørkt. */
  const stripe = new THREE.Mesh(boks(2.3, 0.012, 0.02), new THREE.MeshBasicMaterial({ color: 0xffd9a8, toneMapped: false }));
  stripe.position.set(0, 1.098, z0 + 0.21);
  g.add(stripe);
  const glodTex = (() => {
    const c = document.createElement('canvas'); c.width = 64; c.height = 256;
    const x = c.getContext('2d');
    const gr = x.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, 'rgba(255,214,160,0.9)'); gr.addColorStop(0.35, 'rgba(255,200,140,0.35)'); gr.addColorStop(1, 'rgba(255,190,120,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 64, 256);
    return new THREE.CanvasTexture(c);
  })();
  const glod = new THREE.MeshBasicMaterial({ map: glodTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.25 });
  const panelGlod = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 0.5), glod);
  panelGlod.position.set(0, 0.12, 0.13); // på MIP-flata, fra glareshielden og ned
  mip.add(panelGlod);
  const pidGlod = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 1.4), glod);
  pidGlod.position.set(0, 0.72, pz + 0.8); pidGlod.rotation.x = -Math.PI / 2;
  g.add(pidGlod);
  const varm = new THREE.PointLight(0xffd2a0, 1.6, 2.6, 1.6);
  varm.position.set(0, 1.25, z0 + 0.9);
  g.add(varm);

  /* Skottet mot kabinen med lukket cockpitdør og en sammenslått observatørstol. */
  const vegg = std(0xd8d3c9, { roughness: 0.6 });
  // Veggen følger skrogets runding helt ut til siden, med åpning for døra.
  const topp = CUT - 0.02, dor = 0.37, dorH = CUT - 0.1;
  const form = new THREE.Shape();
  form.moveTo(-halvBredde(0) + 0.01, 0);
  for (let i = 1; i <= 16; i++) { const y = (topp * i) / 16; form.lineTo(-halvBredde(y) + 0.01, y); }
  for (let i = 16; i >= 0; i--) { const y = (topp * i) / 16; form.lineTo(halvBredde(y) - 0.01, y); }
  form.lineTo(dor, 0); form.lineTo(dor, dorH); form.lineTo(-dor, dorH); form.lineTo(-dor, 0); form.closePath();
  const veggGeo = new THREE.ExtrudeGeometry(form, { depth: 0.06, bevelEnabled: false });
  veggGeo.translate(0, 0, -0.03);
  g.add(mesh(veggGeo, vegg, 0, 0, zv));
  g.add(mesh(boks(0.75, CUT - 0.1, 0.07), std(0x3b3f47, { metalness: 0.3 }), 0, (CUT - 0.1) / 2, zv));
  g.add(mesh(rb(0.42, 0.08, 0.36), mork, -0.85, 0.55, zv - 0.22));

  let sist = -1;
  return {
    gruppe: g,
    /** Oppdater skjermene (hvert halve sekund) og spakene (hvert bilde). */
    tick(s, tid) {
      glod.opacity = 0.18 + (1 - COCKPIT.value) * 0.55;
      if (tid - sist > 0.5) { skjermer.tegn(s, tid); sist = tid; }
      const lav = s.bakken || s.alt - (s.bakkeAlt ?? 0) < 1500;
      hjulspak.rotation.x += ((s.bakken || (lav && s.vs < 0) ? 0.9 : -0.6) - hjulspak.rotation.x) * 0.05;
      // Gasshendlene etter N1: tomgang bak, TO/GA langt fram.
      const v = -0.55 + ((s.n1 - 20) / 80) * 0.95;
      for (const h of hendler) h.rotation.x += (v - h.rotation.x) * 0.08;
      // Flaps: 5 på bakken og i innflyging, opp i marsjhøyde.
      const fl = s.bakken ? 0.15 : s.vs < -300 && s.alt < 6000 ? 0.65 : 0;
      flaps.rotation.x += (0.3 + fl - flaps.rotation.x) * 0.05;
      // Trimhjulene snurrer litt når flyet stiger eller synker.
      for (const t of trimhjul) t.rotation.x += THREE.MathUtils.clamp(s.vs / 3000, -1, 1) * 0.02;
    },
  };
}
