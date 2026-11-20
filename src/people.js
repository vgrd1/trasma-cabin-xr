import * as THREE from 'three';
import { PITCH, TILT, CUT, halvBredde } from './cabin.js';

// Hvor langt ut fra midten en lapp kan stikke uten å gå inn i skrogveggen (kanten av kuttet).
const VEGG_X = halvBredde(CUT) - 0.14;
import { logoTekstur } from './textures.js';
import { dimCockpit } from './cockpit.js';
import { dimKabin } from './lys.js';

// Folk om bord: passasjerene fra chatten, kabinpersonalet og kapteinen.
// Alt passasjerene kan gjøre via chatkommandoene på trasmabot.trasma.tech, vises på figuren:
//   aktivitet (!film !bok !sov !musikk !nettbrett), !do og kø, !strekk, kurven (borte),
//   !ring (bjelle + kabinpersonalet kommer), !bestill (venter) og servering (på klappbordet),
//   !pledd og !pute, setebelte av, og «gjorde» (selfie, videosamtale, hoste, klappe …) som
//   snakkeboble og en liten animasjon.

const AKT_TEKST = {
  sove: '💤 sover', film: '🎬 ser film', bok: '📖 leser', nettbrett: '📱 nettbrett',
  musikk: '🎧 hører på musikk', do: '🚻 på toalettet', strekk: '🚶 strekker på beina',
};
const HUD = [0xf1c9a5, 0xe0ac84, 0xc68863, 0x8d5a3c, 0x5c3a24, 0xf6d7bf];
const HAAR = [0x2b1d14, 0x5a3a22, 0x8a5a2b, 0xd3b06a, 0x1a1a1a, 0x9a9a9a, 0xa83d1f];
const PLATTFORM = { twitch: '#9146ff', kick: '#53fc18', youtube: '#ff0033' };
const GANG = 1.1; // m/s
const SERVERT_VISES = 5 * 60e3; // så lenge maten/drikken står på klappbordet
const BOBLE_VISES = 8000; // så lenge «gjorde» vises som snakkeboble
const TELEFON = ['selfie', 'videosamtale', 'fartstest', 'nettspill', 'nyheter', 'flysporing', 'flymodus', 'surf', 'wifi', 'ringhjem'];

/** Pleddet: en myk flate som ligger over lårene og henger ned foran knærne (origo = midt i setet). */
function lagPleddGeo() {
  const geo = new THREE.PlaneGeometry(0.5, 0.78, 10, 24);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const u = (0.39 - p.getY(i)) / 0.78; // 0 ved magen (logoen), 1 nederst foran leggene (stripene)
    const s = u * 0.78; // meter langs pleddet
    let y, z;
    if (s < 0.36) { y = 0.648 - s * 0.03; z = 0.1 - s; } // over lårene
    else { const a = Math.min(Math.PI / 2, (s - 0.36) / 0.08); const r = 0.08; // rundt knærne og rett ned
      y = 0.637 - r * Math.sin(a) - Math.max(0, s - 0.36 - (Math.PI / 2) * r); z = -0.26 - r * (1 - Math.cos(a)); }
    const bue = 0.025 * Math.cos((x / 0.25) * Math.PI * 0.5); // litt runding over beina
    p.setXYZ(i, x * (1 + u * 0.08), y + bue, z);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Pleddets mønster: mørkeblått fleece, striper langs kanten og en liten logo i hjørnet. */
function pleddTekstur() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 384;
  const x = c.getContext('2d');
  x.fillStyle = '#16275e'; x.fillRect(0, 0, 256, 384);
  let s = 5; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 2500; i++) { x.fillStyle = `rgba(255,255,255,${rnd() * 0.05})`; x.fillRect(rnd() * 256, rnd() * 384, 2, 2); }
  for (const [y, h, f] of [[334, 10, '#1f5be0'], [350, 4, '#e8ecf3']]) { x.fillStyle = f; x.fillRect(0, y, 256, h); }
  x.drawImage(logoTekstur('#e8ecf3').image, 186, 14, 54, 54);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const hash = (s) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.codePointAt(0), 16777619) >>> 0; return h; };

/** Hva passasjeren holder på med akkurat nå, i samme rekkefølge som live-kabinen på nettsiden. */
export function status(p, naa, belte) {
  if (p.borte && p.ikon === '🧺') return ['kurv', '🧺 henter fra kurven'];
  if (p.tilkalt > naa) return ['tilkalt', '🔔 har ringt på'];
  if (p.betjenes > naa) return ['betjenes', '🙋 blir betjent'];
  if (belte === 'on' && p.belteAv) return ['belte', '⚠️ setebeltet er av'];
  if (p.servert && naa - p.servert.t < SERVERT_VISES && naa >= p.servert.t) return ['servert', `✓ fikk ${p.servert.vare.no}`];
  const venter = p.bestilt.find((o) => !o.klar || o.klar > naa) || p.bestilt[0];
  if (venter) return ['bestilt', `⏳ venter på ${venter.vare.no}`];
  if (p.doKo > 0) return ['ko', '🚻 i kø til toalettet'];
  if (p.borte) return ['borte', `${p.ikon || '🚶'} er borte en tur`];
  if (p.akt) return [p.akt, AKT_TEKST[p.akt] || p.akt];
  return ['sitter', ''];
}

/** Gjett hva som ble servert, ut fra bestillingens slag eller varenavnet. */
function vareSlag(slag, navn) {
  if (['mat', 'drikke', 'snacks', 'taxfree'].includes(slag)) return slag;
  const n = (navn || '').toLowerCase();
  if (/kaffe|te\b|vann|cola|pepsi|juice|øl|vin|cider|gin|champagne|prosecco|cognac|sjokolade|sambuc|alkohol/.test(n)) return 'drikke';
  if (/parfyme|klokke|smykke|leke|bamse|duty|taxfree|merch/.test(n)) return 'taxfree';
  if (/chips|nøtter|kjeks|godteri|snacks/.test(n)) return 'snacks';
  return 'mat';
}

/* ---------- Delte geometrier og materialer ---------- */
const G = {
  torso: new THREE.CapsuleGeometry(0.155, 0.3, 4, 12),
  hode: new THREE.SphereGeometry(0.1, 20, 14),
  haar: new THREE.SphereGeometry(0.105, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.55),
  laar: new THREE.CapsuleGeometry(0.068, 0.32, 4, 10),
  legg: new THREE.CapsuleGeometry(0.058, 0.33, 4, 10),
  overarm: new THREE.CapsuleGeometry(0.05, 0.24, 4, 8),
  underarm: new THREE.CapsuleGeometry(0.045, 0.22, 4, 8),
  sko: new THREE.BoxGeometry(0.09, 0.06, 0.2),
  bok: new THREE.BoxGeometry(0.15, 0.025, 0.21),
  brett: new THREE.BoxGeometry(0.2, 0.012, 0.14),
  telefon: new THREE.BoxGeometry(0.075, 0.15, 0.01),
  skjerm: new THREE.PlaneGeometry(0.28, 0.17),
  hodetelefon: new THREE.TorusGeometry(0.108, 0.016, 8, 24, Math.PI),
  bord: new THREE.BoxGeometry(0.36, 0.014, 0.25),
  bordArm: new THREE.BoxGeometry(0.012, 0.012, 0.27),
  kopp: new THREE.CylinderGeometry(0.035, 0.028, 0.09, 14),
  tallerken: new THREE.CylinderGeometry(0.1, 0.09, 0.018, 20),
  mat: new THREE.SphereGeometry(0.06, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
  pose: new THREE.BoxGeometry(0.12, 0.16, 0.05),
  pledd: lagPleddGeo(),
  pute: new THREE.BoxGeometry(0.3, 0.16, 0.1),
};
const M = {
  sko: new THREE.MeshStandardMaterial({ color: 0x1b1c20, roughness: 0.6 }),
  bok: [0xc0392b, 0x2e86c1, 0x27ae60, 0xf1c40f].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 })),
  brett: new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x4a7dff, emissiveIntensity: 0.9, roughness: 0.3 }),
  telefon: new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x6aa0ff, emissiveIntensity: 0.6, roughness: 0.3 }),
  film: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x3f6fd8, emissiveIntensity: 1.3 }),
  hodetelefon: new THREE.MeshStandardMaterial({ color: 0x1d1d22, roughness: 0.4 }),
  uniform: new THREE.MeshStandardMaterial({ color: 0x0b1d4d, roughness: 0.7 }),
  skjorte: new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.7 }),
  bukse: new THREE.MeshStandardMaterial({ color: 0x23262e, roughness: 0.8 }),
  bord: new THREE.MeshStandardMaterial({ color: 0xcfcbc3, roughness: 0.5 }),
  kopp: new THREE.MeshStandardMaterial({ color: 0xf4f4f2, roughness: 0.3 }),
  tallerken: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25 }),
  mat: new THREE.MeshStandardMaterial({ color: 0xc2552b, roughness: 0.8 }),
  snacks: new THREE.MeshStandardMaterial({ color: 0xe6b400, roughness: 0.5 }),
  taxfree: new THREE.MeshStandardMaterial({ color: 0x1f5be0, roughness: 0.5 }),
  pledd: new THREE.MeshStandardMaterial({ map: pleddTekstur(), roughness: 1, side: THREE.DoubleSide }),
  pute: new THREE.MeshStandardMaterial({ map: logoTekstur('#1f5be0', '#f4f2ee'), roughness: 0.9 }),
};

dimCockpit(M.skjorte); // bare kapteinen bruker den
for (const k of ['sko', 'bord', 'kopp', 'tallerken', 'mat', 'snacks', 'taxfree', 'pledd', 'pute', 'hodetelefon', 'uniform', 'bukse']) dimKabin(M[k]);
M.bok.forEach(dimKabin);

/* ---------- Skilt over hodet (canvas-sprites) ---------- */
function lerretSprite(w, h, tegn, skala) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  tegn(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
  s.scale.set(skala * (w / h), skala, 1);
  s.renderOrder = 10;
  return s;
}

function tegnLapp(x, w, h, navn, linje2, uthevet, plattform) {
  x.clearRect(0, 0, w, h);
  x.fillStyle = uthevet ? 'rgba(31,91,224,0.95)' : 'rgba(12,14,22,0.82)';
  x.beginPath(); x.roundRect(4, 4, w - 8, h - 8, 28); x.fill();
  if (plattform) { x.fillStyle = PLATTFORM[plattform]; x.beginPath(); x.arc(36, linje2 ? 44 : 64, 12, 0, 7); x.fill(); }
  x.fillStyle = '#fff';
  x.font = '600 50px system-ui, sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(navn, w / 2 + (plattform ? 12 : 0), linje2 ? 44 : 64, w - 80);
  if (linje2) {
    x.font = '36px system-ui, sans-serif';
    x.fillStyle = uthevet ? '#fff' : '#c9d6ff';
    x.fillText(linje2, w / 2, 96, w - 30);
  }
}

function boble(ikon, tekst) {
  return lerretSprite(640, 150, (x, w, h) => {
    x.fillStyle = '#ffffff';
    x.beginPath(); x.roundRect(4, 4, w - 8, h - 40, 34); x.fill();
    x.beginPath(); x.moveTo(w / 2 - 22, h - 37); x.lineTo(w / 2, h - 4); x.lineTo(w / 2 + 22, h - 37); x.fill();
    x.fillStyle = '#0b1d4d';
    x.font = '600 46px system-ui, sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(`${ikon} ${tekst}`, w / 2, (h - 36) / 2 + 2, w - 40);
  }, 0.2);
}

const ikonSprite = (ikon, bak) => lerretSprite(128, 128, (x) => {
  x.fillStyle = bak; x.beginPath(); x.arc(64, 64, 58, 0, 7); x.fill();
  x.font = '72px system-ui'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(ikon, 64, 70);
}, 0.16);

/** Snakkeboble over en figur (brukes til kabinpersonalets oppdrag). Tom tekst fjerner den. */
function settBoble(f, ikon, tekst) {
  const k = tekst ? `${ikon}|${tekst}` : '';
  if (f.bobleNokkel === k) return;
  if (f.boble) { f.g.remove(f.boble); f.boble.material.map.dispose(); f.boble.material.dispose(); f.boble = null; }
  if (tekst) { f.boble = boble(ikon, tekst); f.g.add(f.boble); }
  f.bobleNokkel = k;
}

/* ---------- Figurene ---------- */

// Skjelettet. Hvert lem henger i et ledd (en gruppe) og peker nedover (-y); neste ledd sitter i enden.
// Rotasjon om x: positiv = lemmet svinger fram (-z). Origo for figuren: midt i setet / mellom føttene.
const LAAR = 0.42, LEGG = 0.42, OVERARM = 0.29, UNDERARM = 0.27, SKULDER_Y = 0.5, NAKKE_Y = 0.6;

/** Lager en figur. type: 'pax' | 'crew' | 'pilot'. */
function lagFigur(navn, type) {
  const h = hash(navn);
  const g = new THREE.Group();
  const hud = new THREE.MeshStandardMaterial({ color: HUD[h % HUD.length], roughness: 0.6 });
  const klaer = type === 'crew' ? M.uniform : type === 'pilot' ? M.skjorte
    : new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(((h >>> 8) % 360) / 360, 0.45, 0.42), roughness: 0.85 });
  const bukse = type === 'pax'
    ? new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(((h >>> 4) % 360) / 360, 0.25, 0.22), roughness: 0.85 })
    : M.bukse;
  const haar = new THREE.MeshStandardMaterial({ color: HAAR[(h >>> 12) % HAAR.length], roughness: 0.8 });
  if (type === 'pilot') for (const m of [hud, haar]) dimCockpit(m); // kapteinen sitter i den dempede cockpiten
  else for (const m of [hud, klaer, bukse, haar]) dimKabin(m); // passasjerer og kabinpersonale følger kabinlyset
  const del = (geo, mat, foreldre = g, y = 0) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.position.y = y; foreldre.add(m); return m; };
  const ledd = (foreldre, x, y, z) => { const l = new THREE.Group(); l.position.set(x, y, z); foreldre.add(l); return l; };

  // Bekken → rygg (torso, skuldre, nakke/hode) og hofter (lår → kne → legg → ankel → sko).
  const bekken = ledd(g, 0, 0.9, 0);
  const rygg = ledd(bekken, 0, 0, 0);
  del(G.torso, klaer, rygg, 0.29);
  const nakke = ledd(rygg, 0, NAKKE_Y, 0);
  const hode = ledd(nakke, 0, 0.11, 0);
  del(G.hode, hud, hode);
  const haarM = del(G.haar, haar, hode); haarM.position.set(0, 0.012, 0.012); haarM.rotation.x = 0.35;
  const arm = (s) => {
    const skulder = ledd(rygg, s * 0.2, SKULDER_Y, 0);
    del(G.overarm, klaer, skulder, -OVERARM / 2);
    const albue = ledd(skulder, 0, -OVERARM, 0);
    del(G.underarm, hud, albue, -UNDERARM / 2);
    const hand = ledd(albue, 0, -UNDERARM, 0);
    return { skulder, albue, hand };
  };
  const bein = (s) => {
    const hofte = ledd(bekken, s * 0.09, 0, 0);
    del(G.laar, bukse, hofte, -LAAR / 2);
    const kne = ledd(hofte, 0, -LAAR, 0);
    del(G.legg, bukse, kne, -LEGG / 2);
    const ankel = ledd(kne, 0, -LEGG, 0);
    del(G.sko, M.sko, ankel).position.set(0, -0.03, -0.05);
    return { hofte, kne, ankel };
  };
  const f = {
    g, type, egne: [hud, klaer, bukse, haar].filter((m) => !Object.values(M).includes(m)),
    bekken, rygg, nakke, hode, aL: arm(-1), aR: arm(1), bL: bein(-1), bR: bein(1),
  };
  // Rekvisitter (skjules når de ikke brukes). Telefonen holdes i høyre hånd.
  f.bok = del(G.bok, M.bok[h % M.bok.length]);
  f.brett = del(G.brett, M.brett);
  f.telefon = del(G.telefon, M.telefon, f.aR.hand);
  f.hodetelefon = del(G.hodetelefon, M.hodetelefon, hode);
  f.film = new THREE.Mesh(G.skjerm, M.film); g.add(f.film);
  f.bord = del(G.bord, M.bord);
  for (const k of [-1, 1]) del(G.bordArm, M.bord, f.bord).position.set(k * 0.19, 0.0, -0.01);
  f.kopp = del(G.kopp, M.kopp, f.bord);
  f.tallerken = del(G.tallerken, M.tallerken, f.bord);
  del(G.mat, M.mat, f.tallerken).position.y = 0.008;
  f.snacks = del(G.pose, M.snacks, f.bord);
  f.taxfree = del(G.pose, M.taxfree, f.bord);
  f.pledd = del(G.pledd, M.pledd);
  f.pute = del(G.pute, M.pute);
  f.bjelle = ikonSprite('🔔', 'rgba(255,200,40,0.95)'); g.add(f.bjelle);
  f.varsel = ikonSprite('⚠️', 'rgba(255,70,50,0.95)'); g.add(f.varsel);
  f.blits = lerretSprite(64, 64, (x) => { const r = x.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, '#fff'); r.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = r; x.fillRect(0, 0, 64, 64); }, 0.35);
  f.aR.hand.add(f.blits);
  if (type === 'crew') { // serveringsbrett med en kopp, bæres foran seg
    f.brettHand = new THREE.Group();
    f.brettHand.add(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.015, 0.24), M.bord));
    const kopp = new THREE.Mesh(G.kopp, M.kopp); kopp.position.y = 0.05; f.brettHand.add(kopp);
    f.brettHand.position.set(0, 1.0, -0.32);
    f.brettHand.visible = false;
    g.add(f.brettHand);
  }
  if (type !== 'crew') {
    f.lappLerret = document.createElement('canvas');
    f.lappLerret.width = 560; f.lappLerret.height = 128;
    const t = new THREE.CanvasTexture(f.lappLerret); t.colorSpace = THREE.SRGBColorSpace;
    f.lapp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
    f.lapp.scale.set(0.55, 0.125, 1);
    f.lapp.renderOrder = 10;
    g.add(f.lapp);
  }
  f.pos = new THREE.Vector2();
  f.ry = 0;
  f.sti = [];
  f.fase = 0;
  f.vinduSide = 1;
  return f;
}

const sett = (m, x, y, z, rx = 0, ry = 0, rz = 0) => { m.position.set(x, y, z); m.rotation.set(rx, ry, rz); };
const vinkel = (l, x = 0, y = 0, z = 0) => l.rotation.set(x, y, z);

/** Sittende stilling: bekkenet på setet, lårene fram, leggene ned, armene på armlenene. g = det figuren nettopp gjorde. */
function sitt(f, sover, g, t) {
  f.bekken.position.set(0, 0.55, 0.1);
  vinkel(f.rygg, -TILT * 0.8); // lener seg litt bakover mot ryggen (toppen bakover)
  vinkel(f.nakke, sover ? 0.35 : 0.08, 0, sover ? -0.4 : 0);
  vinkel(f.hode);
  for (const [s, a, b] of [[-1, f.aL, f.bL], [1, f.aR, f.bR]]) {
    vinkel(b.hofte, Math.PI / 2, 0, s * 0.06);
    vinkel(b.kne, -Math.PI / 2 + 0.08);
    vinkel(b.ankel, 0.05);
    vinkel(a.skulder, 0.32, 0, s * 0.1);
    vinkel(a.albue, 1.25);
  }
  // Små animasjoner for det de nettopp gjorde (de første sekundene).
  if (g === 'klapp') {
    const k = Math.sin(t * 14) * 0.18;
    for (const [s, a] of [[-1, f.aL], [1, f.aR]]) { vinkel(a.skulder, 0.75, 0, s * (0.05 + k)); vinkel(a.albue, 1.35, 0, -s * (0.75 + k)); }
  } else if (g === 'gjesp' || g === 'strekk') {
    const a = Math.min(1, (Math.sin(t * 2) + 1) / 1.6);
    for (const [s, arm] of [[-1, f.aL], [1, f.aR]]) { vinkel(arm.skulder, Math.PI * 0.95 * a, 0, s * 0.25); vinkel(arm.albue, 0.4); }
    vinkel(f.nakke, -0.35 * a);
  } else if (['host', 'nys', 'kremt', 'snufs'].includes(g)) {
    const r = Math.max(0, Math.sin(t * 9));
    vinkel(f.rygg, -TILT * 0.8 + r * 0.25);
    vinkel(f.nakke, 0.1 + r * 0.4);
    vinkel(f.aR.skulder, 1.1, 0, -0.35); vinkel(f.aR.albue, 2.3, 0, 0.4); // hånda for munnen
  } else if (g === 'sukk') {
    vinkel(f.rygg, -TILT * 0.8 - Math.max(0, Math.sin(t * 3)) * 0.08);
    vinkel(f.nakke, 0.35);
  } else if (g === 'vindu') {
    vinkel(f.nakke, 0.05, -f.vinduSide * 0.9, 0);
  } else if (g === 'selfie') {
    vinkel(f.aR.skulder, 2.1, 0, 0.45); vinkel(f.aR.albue, 0.35); // armen strakt opp og ut, telefonen mot seg
    vinkel(f.nakke, -0.15, 0.25, 0);
  } else if (TELEFON.includes(g)) {
    vinkel(f.aR.skulder, 0.55, 0, -0.15); vinkel(f.aR.albue, 1.55); // telefonen foran seg
    vinkel(f.nakke, 0.3);
  }
}

/** Stående stilling og gangsyklus: hoftene svinger, knærne bøyes på vei fram, armene pendler motsatt. */
function staa(f, steg) {
  const sv = Math.sin(steg);
  f.bekken.position.set(0, 0.9 + Math.abs(Math.cos(steg)) * 0.015 * (steg ? 1 : 0), 0);
  vinkel(f.rygg, steg ? 0.04 : 0);
  vinkel(f.nakke); vinkel(f.hode);
  for (const [s, a, b, k] of [[-1, f.aL, f.bL, 1], [1, f.aR, f.bR, -1]]) {
    const fase = sv * k;
    vinkel(b.hofte, fase * 0.42, 0, s * 0.02);
    vinkel(b.kne, -Math.max(0, Math.sin(steg * k + 1.2)) * 0.55 * (steg ? 1 : 0));
    vinkel(b.ankel, -b.hofte.rotation.x - b.kne.rotation.x); // foten flat mot gulvet
    vinkel(a.skulder, -fase * 0.35, 0, s * 0.06);
    vinkel(a.albue, 0.22 + Math.max(0, -fase) * 0.25);
  }
}

/** Rekvisitter og skilt ut fra status. */
function rekvisitter(f, x, sitter, t) {
  const { akt, kode, servertSlag, pledd, pute, gjordeSlag, gjordeFersk } = x;
  f.bok.visible = sitter && akt === 'bok' && !gjordeFersk;
  f.brett.visible = sitter && akt === 'nettbrett' && !gjordeFersk;
  f.hodetelefon.visible = akt === 'musikk';
  f.film.visible = sitter && akt === 'film';
  if (f.bok.visible) sett(f.bok, 0, 0.73, -0.16, -0.55);
  if (f.brett.visible) sett(f.brett, 0, 0.72, -0.16, -0.6);
  if (f.film.visible) sett(f.film, 0, 0.93, -PITCH + 0.338, TILT);
  // Klappbordet nede med det som ble servert.
  f.bord.visible = sitter && !!servertSlag;
  if (f.bord.visible) {
    sett(f.bord, 0, 0.69, -PITCH + 0.33 + 0.13); // hengslet nederst på seteryggen foran, felt ned over fanget
    f.kopp.visible = servertSlag === 'drikke'; f.kopp.position.set(0.1, 0.05, 0.02);
    f.tallerken.visible = servertSlag === 'mat'; f.tallerken.position.set(-0.04, 0.015, 0);
    f.snacks.visible = servertSlag === 'snacks'; f.snacks.position.set(0, 0.085, 0); f.snacks.rotation.set(-0.3, 0.4, 0);
    f.taxfree.visible = servertSlag === 'taxfree'; f.taxfree.position.set(0, 0.085, 0);
  }
  f.pledd.visible = sitter && !!pledd;
  if (f.pledd.visible) sett(f.pledd, 0, 0, 0);
  f.pute.visible = sitter && !!pute;
  if (f.pute.visible) sett(f.pute, 0, 1.12, 0.27, TILT);
  // Telefon i hånda (selfie, videosamtale, Wi-Fi-tingene).
  f.telefon.visible = sitter && gjordeFersk && TELEFON.includes(gjordeSlag);
  if (f.telefon.visible) {
    if (gjordeSlag === 'selfie') sett(f.telefon, 0.38, 1.38, -0.32, 0.2, Math.PI, 0);
    else if (gjordeSlag === 'videosamtale' || gjordeSlag === 'ringhjem') sett(f.telefon, 0.05, 1.08, -0.3, 0, 0, 0);
    else sett(f.telefon, 0.05, 0.92, -0.26, -0.9);
  }
  f.blits.visible = f.telefon.visible && gjordeSlag === 'selfie' && Math.sin(t * 5) > 0.92;
  if (f.blits.visible) f.blits.position.copy(f.telefon.position);
  // Bjelle (ringt på) og varsel (setebelte av) over hodet.
  const hodeY = sitter ? 1.3 : 1.75;
  f.bjelle.visible = kode === 'tilkalt';
  if (f.bjelle.visible) { f.bjelle.position.set(-0.17, hodeY + 0.36 + Math.sin(t * 6) * 0.03, 0.12); f.bjelle.material.rotation = Math.sin(t * 12) * 0.35; }
  f.varsel.visible = kode === 'belte';
  if (f.varsel.visible) { f.varsel.position.set(0.17, hodeY + 0.36, 0.12); f.varsel.material.opacity = 0.6 + 0.4 * Math.sin(t * 8); }
  if (f.lapp) { f.lapp.position.set(0, hodeY + 0.2, sitter ? 0.12 : 0); f.lapp.visible = !f.skjulSkilt; }
  if (f.boble) { f.boble.position.set(0, hodeY + 0.42, sitter ? 0.12 : 0); f.boble.visible = !f.skjulSkilt; }
  if (f.skjulSkilt) { f.bjelle.visible = false; f.varsel.visible = false; }
}

export class Folk {
  constructor(foreldre) {
    this.gruppe = new THREE.Group();
    foreldre.add(this.gruppe);
    this.figurer = new Map(); // nøkkel → figur
    this.forskyvning = 0; // botens klokke minus vår
  }

  naa() { return Date.now() + this.forskyvning; }

  /** Ny kabin (nytt seteoppsett): alle figurer bygges på nytt ved neste oppdatering. */
  settKabin(layout, kabin) {
    for (const k of [...this.figurer.keys()]) this.fjern(k);
    this.layout = layout;
    this.kabin = kabin;
  }

  plass(sete) {
    const L = this.layout;
    if (sete === 'JS') return { x: -0.8, z: L.zCockpitVegg - 0.32, ry: 0 }; // observatørsetet i cockpit
    const s = L.seter.get(sete);
    return s ? { x: s.x, z: s.z, ry: 0 } : null;
  }

  /** Figuren til passasjeren i et sete (for å følge den med kameraet). */
  figurFor(sete) { for (const f of this.figurer.values()) if (f.type === 'pax' && f.sete === sete) return f; return null; }

  /** Inngangsdøra foran til venstre (L1), der boarding og avstigning skjer. */
  dor() { return { x: -1.45, z: this.layout.zCockpitVegg + 2.45 }; }

  /** Synk figurene med kabindataene. uthev = chatnavn (små bokstaver) som skal fremheves. */
  oppdater(d, uthev) {
    if (!this.layout) return;
    this.forskyvning = d.na - Date.now();
    const naa = this.naa();
    const L = this.layout;
    const aisle = L.midtgang;
    const brukt = new Set();

    // Toalettene: hvem er inne, og hvem står i kø (doKo fra boten, ved nærmeste toalett).
    const toaletter = this.kabin.toaletter.map((t) => ({ ...t, inne: null, ko: 0 }));
    const naermest = (z) => [...toaletter].sort((a, b) => Math.abs(a.z - z) - Math.abs(b.z - z));
    const doMaal = new Map();
    for (const p of [...d.pax].sort((a, b) => (a.sete < b.sete ? -1 : 1))) {
      const s = this.plass(p.sete);
      if (!s || p.jumpseat) continue;
      if (p.akt === 'do' && p.doKo === 0) {
        const t = naermest(s.z).find((x) => !x.inne);
        // Inne på toalettet sitter de på toalettet (de blir der ofte en stund), vendt mot døra.
        if (t) { t.inne = p.sete; doMaal.set(p.sete, { x: t.x - 0.2 * t.doerSide, z: t.z - 0.18, ry: -t.doerSide * Math.PI / 2, sitt: true }); continue; }
      }
      if (p.akt === 'do' || p.doKo > 0) {
        const t = naermest(s.z)[0];
        const foran = t.z < (L.rader[0]?.z ?? 0);
        const nr = p.doKo > 0 ? p.doKo - 1 : t.ko;
        t.ko = Math.max(t.ko, nr + 1);
        doMaal.set(p.sete, { x: aisle, z: foran ? t.z + 0.9 + nr * 0.55 : t.z - 0.9 - nr * 0.55, ry: foran ? 0 : Math.PI, sitt: false });
      }
    }
    for (const t of toaletter) t.lampe.emissive.set(t.inne ? 0xff3b30 : 0x2bd44a);

    for (const p of d.pax) {
      const s = this.plass(p.sete);
      if (!s) continue;
      const [kode, tekst] = status(p, naa, d.belte);
      let maal;
      if (doMaal.has(p.sete)) maal = doMaal.get(p.sete);
      else if (p.akt === 'strekk' && !p.jumpseat) maal = { x: aisle + (s.x < aisle ? -0.05 : 0.05), z: s.z + 0.15, ry: s.x < aisle ? -Math.PI / 2 : Math.PI / 2, sitt: false };
      else if (p.borte && !p.jumpseat) maal = { x: aisle + 0.25, z: L.zBak - 1.4, ry: Math.PI, sitt: false }; // en tur bak (kurven)
      else maal = { x: s.x, z: s.z, ry: s.ry, sitt: true };

      // Figuren hører til personen, ikke setet: bytter de sete, går de dit.
      // Samme navn kan sitte om bord fra flere plattformer (Twitch, Kick, YouTube), så plattformen er med.
      // Skulle to likevel ha samme nøkkel, skilles de på setet, ellers ville de slåss om én figur.
      let nokkel = `pax:${p.plattform || '-'}:${p.navn.toLowerCase()}`;
      if (brukt.has(nokkel)) nokkel += `:${p.sete}`;
      brukt.add(nokkel);
      const ny = !this.figurer.has(nokkel);
      const f = this.hent(nokkel, p.navn, 'pax');
      f.forlater = false;
      if (ny && this.harOppdatert) {
        // Boarder nå: kommer inn gjennom døra foran (L1) og går til setet.
        f.pos.set(this.dor().x, this.dor().z); f.ry = Math.PI / 2; f.maalNokkel = 'dør';
      }
      f.vinduSide = s.x < aisle ? -1 : 1;
      f.sete = p.sete;
      const uthevet = !!uthev && p.navn.toLowerCase() === uthev;
      this.lapp(f, p.navn, tekst, uthevet, p.plattform);
      // «gjorde»: snakkeboble i noen sekunder.
      const g = p.gjorde && naa - p.gjorde.t < BOBLE_VISES && naa >= p.gjorde.t - 2000 ? p.gjorde : null;
      const bobleNokkel = g ? `${g.t}|${g.tekst.no}` : '';
      if (f.bobleNokkel !== bobleNokkel) {
        if (f.boble) { f.g.remove(f.boble); f.boble.material.map.dispose(); f.boble.material.dispose(); f.boble = null; }
        if (g) { f.boble = boble(g.ikon || '💬', g.tekst.no); f.g.add(f.boble); }
        f.bobleNokkel = bobleNokkel;
      }
      // Husk hva som ble bestilt, så serveringen kan vises som riktig ting.
      if (p.bestilt[0]) f.sisteSlag = p.bestilt[0].slag;
      const servert = p.servert && naa - p.servert.t < SERVERT_VISES && naa >= p.servert.t;
      f.x = {
        akt: p.akt, kode,
        servertSlag: servert ? vareSlag(f.sisteSlag, p.servert.vare.no) : '',
        pledd: p.pledd > naa, pute: p.pute > naa,
        gjordeSlag: g?.slag || '', gjordeT: g?.t || 0,
      };
      this.settMaal(f, maal, aisle);
    }

    // Kabinpersonalet: én følger vogna; de andre tar oppdrag (bestillinger, ringeknapp, hjelp) som på nettsiden.
    this.planleggCrew(d, naa, aisle, brukt);

    // Kapteinen i venstre setet.
    brukt.add('pilot');
    const kp = this.hent('pilot', 'TrasMaTech', 'pilot');
    kp.x = { kode: '' };
    this.lapp(kp, 'TrasMaTech', '👨‍✈️ kaptein', false, '');
    this.settMaal(kp, { x: -0.55, z: L.zNese + 0.1, ry: 0, sitt: true }, aisle); // samme sete som i cockpit.js

    // De som ikke er om bord lenger, går ut døra foran før de forsvinner.
    for (const [nokkel, f] of [...this.figurer]) {
      if (brukt.has(nokkel)) continue;
      if (f.type !== 'pax' || !this.harOppdatert) { this.fjern(nokkel); continue; }
      if (!f.forlater) {
        f.forlater = true;
        f.sete = null;
        f.x = { kode: '' };
        this.lapp(f, f.navn, '👋 går av', false, '');
        this.settMaal(f, { x: this.dor().x, z: this.dor().z, ry: -Math.PI / 2, sitt: false }, aisle);
      } else if (!f.sti.length) this.fjern(nokkel);
    }
    this.harOppdatert = true;
    // Klappbordene som er nede (de som har fått servert og sitter i setet sitt).
    this.kabin.settKlappbord?.([...this.figurer.values()].filter((f) => f.sete && f.x?.servertSlag && f.maal?.sitt).map((f) => f.sete));
  }

  /**
   * Kabinpersonalet, samme regler som live-kabinen på nettsiden:
   * - én (den første ledige foran) følger vogna så lenge den er ute,
   * - oppdrag: hjelp (betjenes), ringeknapp (tilkalt, siste minutt) og bestillinger som blir klare
   *   (ikke på raden vogna står ved). De går så de er framme når varen er klar,
   * - ved setet: minst 10 s (eller til hjelpen er ferdig), så tilbake til byssa,
   * - samme sete som noen allerede er på vei til: samme person, lengre opphold.
   */
  planleggCrew(d, naa, aisle, brukt) {
    const L = this.layout;
    const vogn = this.kabin.vogn;
    const hjem = [
      { x: 0.62, z: L.zCockpitVegg + 0.75, ry: -Math.PI / 2, foran: true },
      { x: -0.4, z: L.zBak - 0.95, ry: Math.PI, foran: false },
      { x: 0.4, z: L.zBak - 0.95, ry: Math.PI, foran: false },
      { x: 0.6, z: L.zCockpitVegg + 1.6, ry: -Math.PI / 2, foran: true },
      { x: -0.2, z: L.zCockpitVegg + 1.2, ry: Math.PI, foran: true },
      { x: 0, z: L.zBak - 1.4, ry: Math.PI, foran: false },
    ];
    this.crew ??= [];
    this.gjort ??= new Map();
    for (const [k, t] of this.gjort) if (t < naa - 600000) this.gjort.delete(k);
    // Riktig antall figurer.
    for (let i = 0; i < d.kabinpersonale; i++) {
      const nokkel = `crew:${i}`;
      brukt.add(nokkel);
      const f = this.hent(nokkel, `crew${i}`, 'crew');
      f.x = { kode: '' };
      if (!this.crew[i] || this.crew[i].f !== f) {
        this.crew[i] = { f, hjem: hjem[i % hjem.length], fase: 'hjemme', jobb: null };
        f.vedVogn = null;
        this.settMaal(f, { ...this.crew[i].hjem, sitt: false }, aisle); // starter i byssa (første mål settes rett)
      }
    }
    this.crew.length = d.kabinpersonale;
    const crew = this.crew;
    const tilHjem = (c) => { c.fase = 'tilbake'; c.jobb = null; c.f.vedVogn = null; this.settMaal(c.f, { ...c.hjem, sitt: false }, aisle); };

    // Vogna: én går med den.
    const vognUte = vogn.visible;
    let medVogn = crew.find((c) => c.fase === 'vogn');
    if (vognUte && !medVogn) {
      medVogn = crew.filter((c) => c.fase === 'hjemme').sort((a, b) => (a.hjem.foran ? 0 : 1) - (b.hjem.foran ? 0 : 1))[0];
      if (medVogn) { medVogn.fase = 'vogn'; medVogn.jobb = null; medVogn.f.vedVogn = 0.62; }
    } else if (!vognUte && medVogn) tilHjem(medVogn);
    const vognRad = vognUte ? Math.round((vogn.position.z - 0.38) / PITCH) : -99; // omtrent raden vogna står ved

    // Oppdragene.
    const jobber = [];
    if (d.aktiv) {
      for (const p of d.pax) {
        if (!p.jumpseat && (p.borte || p.akt === 'do' || p.akt === 'strekk')) continue;
        const s = this.plass(p.sete);
        if (!s) continue;
        const radIdx = L.rader.findIndex((r) => r.nr === L.seter.get(p.sete)?.rad);
        if (p.betjenes > naa) jobber.push({ n: `b|${p.sete}|${p.betjenes}`, sete: p.sete, s, frem: naa, ferdig: p.betjenes, hva: p.jumpseat ? 'I cockpit' : `🙋 Hjelper ${p.sete}` });
        else if (p.tilkalt > naa - 60000) jobber.push({ n: `t|${p.sete}|${p.tilkalt}`, sete: p.sete, s, frem: p.tilkalt, ferdig: 0, hva: p.jumpseat ? 'På vei til cockpit' : `🔔 På vei til ${p.sete}` });
        for (const o of p.bestilt) {
          if (o.klar > naa - 60000 && (p.jumpseat || radIdx !== vognRad)) {
            jobber.push({ n: `o|${p.sete}|${o.vare.no}|${o.klar}`, sete: p.sete, s, frem: o.klar, ferdig: 0, hva: `${o.vare.no} til ${p.jumpseat ? 'jumpseaten' : p.sete}`, baerer: true });
          }
        }
      }
    }
    jobber.sort((a, b) => a.frem - b.frem);
    for (const j of jobber) {
      if (this.gjort.has(j.n)) continue;
      const der = crew.find((c) => c.jobb && c.jobb.sete === j.sete && (c.fase === 'ut' || c.fase === 'der'));
      if (der) {
        this.gjort.set(j.n, naa);
        der.jobb.ferdig = Math.max(der.jobb.ferdig, j.ferdig, naa + 10000);
        der.jobb.hva = j.hva; der.jobb.baerer = der.jobb.baerer || j.baerer;
        continue;
      }
      const ledige = crew.filter((c) => c.fase === 'hjemme');
      if (!ledige.length) break;
      ledige.sort((a, b) => Math.abs(a.hjem.z - j.s.z) - Math.abs(b.hjem.z - j.s.z));
      const c = ledige[0];
      // Gå så de er framme når varen er klar (gangtid ut fra avstanden).
      const gangtid = ((Math.abs(c.f.pos.x - aisle) + Math.abs(c.f.pos.y - j.s.z) + 0.5) / GANG) * 1000;
      if (j.frem - gangtid > naa) continue;
      this.gjort.set(j.n, naa);
      c.jobb = { ...j }; c.fase = 'ut';
      const cockpit = j.sete === 'JS';
      this.settMaal(c.f, cockpit
        ? { x: 0.25, z: L.zCockpitVegg + 0.35, ry: 0, sitt: false }
        : { x: aisle, z: j.s.z - 0.05, ry: j.s.x < aisle ? Math.PI / 2 : -Math.PI / 2, sitt: false }, aisle);
    }
    // Boblene med hva de gjør, og brettet i hånda.
    for (const c of crew) {
      const tekst = c.jobb && (c.fase === 'ut' || c.fase === 'der') ? c.jobb.hva : '';
      settBoble(c.f, '', tekst);
      c.f.baerer = !!(c.jobb?.baerer && c.fase === 'ut');
    }
  }

  /** Hvert bilde: kabinpersonalet er framme ved setet, ferdig, eller tilbake i byssa. */
  crewTick(naa, aisle) {
    for (const c of this.crew || []) {
      const framme = !c.f.sti.length;
      if (c.fase === 'ut' && framme) { c.fase = 'der'; c.jobb.ferdig = Math.max(c.jobb.ferdig, naa + 10000); c.f.baerer = false; }
      if (c.fase === 'der' && naa >= c.jobb.ferdig) { c.fase = 'tilbake'; c.jobb = null; settBoble(c.f, '', ''); this.settMaal(c.f, { ...c.hjem, sitt: false }, aisle); }
      if (c.fase === 'tilbake' && framme) c.fase = 'hjemme';
    }
  }

  hent(nokkel, navn, type) {
    let f = this.figurer.get(nokkel);
    if (f && f.navn !== navn) { this.fjern(nokkel); f = null; }
    if (!f) {
      f = lagFigur(navn, type);
      f.navn = navn;
      f.nokkel = nokkel;
      f.g.traverse((o) => { o.userData.figur = nokkel; });
      this.figurer.set(nokkel, f);
      this.gruppe.add(f.g);
    }
    return f;
  }

  lapp(f, navn, linje2, uthevet, plattform) {
    if (!f.lapp) return;
    const k = `${navn}|${linje2}|${uthevet}|${plattform}`;
    if (f.lappNokkel === k) return;
    tegnLapp(f.lappLerret.getContext('2d'), f.lappLerret.width, f.lappLerret.height, navn, linje2, uthevet, plattform);
    f.lapp.material.map.needsUpdate = true;
    const s = uthevet ? 1.25 : 1;
    f.lapp.scale.set(0.55 * s, 0.125 * s, 1);
    f.lappNokkel = k;
  }

  /** Nytt mål: første gang settes figuren rett dit, ellers går den via midtgangen. */
  settMaal(f, maal, aisle) {
    const nokkel = `${maal.x.toFixed(2)},${maal.z.toFixed(2)},${maal.sitt}`;
    f.maal = maal;
    if (f.maalNokkel === nokkel) return;
    const forste = f.maalNokkel === undefined;
    f.maalNokkel = nokkel;
    if (forste) { f.pos.set(maal.x, maal.z); f.ry = maal.ry; f.sti = []; return; }
    const sti = [];
    if (Math.abs(f.pos.x - aisle) > 0.05) sti.push(new THREE.Vector2(aisle, f.pos.y));
    if (Math.abs(maal.z - f.pos.y) > 0.05) sti.push(new THREE.Vector2(aisle, maal.z));
    sti.push(new THREE.Vector2(maal.x, maal.z));
    f.sti = sti;
  }

  /** Kalles hvert bilde: gange, vogna, stillinger og animasjoner. */
  tick(dt, t) {
    const vogn = this.kabin?.vogn;
    const naa = this.naa();
    this.crewTick(naa, this.layout?.midtgang ?? 0);
    for (const f of this.figurer.values()) {
      let gaar = false;
      if (f.vedVogn != null && vogn) {
        // Følger vogna: står foran eller bak den og vender mot den.
        const mz = vogn.position.z + f.vedVogn;
        gaar = Math.abs(mz - f.pos.y) > 0.02;
        f.pos.set(vogn.position.x, f.pos.y + (mz - f.pos.y) * Math.min(1, dt * 3));
        f.ry = f.vedVogn < 0 ? Math.PI : 0;
        f.sti = [];
      } else if (f.sti.length) {
        const neste = f.sti[0];
        const d = neste.clone().sub(f.pos);
        const l = d.length();
        const steg = GANG * dt;
        if (l <= steg) { f.pos.copy(neste); f.sti.shift(); } else { f.pos.addScaledVector(d, steg / l); }
        if (l > 0.001) f.ry = Math.atan2(-d.x, -d.y);
        gaar = true;
      } else if (f.maal) {
        f.ry = f.maal.ry;
      }
      if (gaar) f.fase += dt * 7;
      const sitter = !gaar && !f.sti.length && f.maal?.sitt && f.vedVogn == null;
      const x = f.x || { kode: '' };
      const gjordeFersk = !!x.gjordeSlag && naa - x.gjordeT < 6000;
      if (sitter) sitt(f, x.akt === 'sove' && !gjordeFersk, gjordeFersk ? x.gjordeSlag : '', t); else staa(f, gaar ? f.fase : 0);
      rekvisitter(f, { ...x, gjordeFersk }, sitter, t);
      if (f.brettHand) f.brettHand.visible = !!f.baerer && !sitter;
      f.g.position.set(f.pos.x, 0, f.pos.y);
      f.g.rotation.y = f.ry;
      // Skyv navnelapp og boble inn mot midtgangen hvis de ellers ville stikke inn i veggen.
      for (const sk of [f.lapp, f.boble]) {
        if (!sk) continue;
        const ut = Math.abs(f.pos.x) + sk.scale.x / 2 - VEGG_X;
        if (ut <= 0) continue;
        const dx = -Math.sign(f.pos.x) * ut; // i verden (langs x)
        sk.position.x += dx * Math.cos(f.ry); // over i figurens egne koordinater
        sk.position.z += dx * Math.sin(f.ry);
      }
    }
  }

  fjern(nokkel) {
    const f = this.figurer.get(nokkel);
    if (!f) return;
    this.gruppe.remove(f.g);
    for (const m of f.egne) m.dispose();
    for (const s of [f.lapp, f.boble, f.bjelle, f.varsel, f.blits]) if (s) { s.material.map?.dispose(); s.material.dispose(); }
    this.figurer.delete(nokkel);
  }
}
