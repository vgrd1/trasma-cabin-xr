import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { lagLayout, byggKabin, CUT } from './cabin.js';
import { byggSkrog, BAKKE_Y, settYtre } from './hull.js';
import { Folk, status } from './people.js';
import { Lasterom } from './cargo.js';
import { Omgivelser, solhoyde } from './world.js';
import { Infotavle } from './screen.js';
import { Flytilstand } from './displays.js';
import { settCockpitLys } from './cockpit.js';
import { KABIN } from './lys.js';
import { startLive, startDemo } from './data.js';
import { Kabinlyd } from './sound.js';

// Dukkehuset: hele flyet i full størrelse med taket kuttet av, sett ovenfra.
// Desktop: faste visninger i verktøylinja (1–6), klikk på en passasjer for å følge, dra for å se rundt,
//          høyreklikk-dra eller WASD for å flytte, rull for å zoome, F = fullskjerm, P = passasjerliste.
// VR: pek og trykk på avtrekkeren for å flytte deg dit, A/X = neste visning, B/Y = forrige.
//     Venstre stikke flytter deg, høyre stikke snur (x) og endrer høyden (y). Infotavla sitter på venstre hånd.

const url = new URLSearchParams(location.search);
const DEMO = url.has('demo');
const UTHEV = (url.get('navn') || '').toLowerCase(); // fremhev denne chatteren
const LAV = url.has('lav'); // uten skygger, for svake enheter
const $ = (s) => document.querySelector(s);
const statusEl = $('#status');

/* ---------- Renderer og scene ---------- */
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); // alpha: passthrough i AR
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.localClippingEnabled = true; // kutter taket på skroget
renderer.shadowMap.enabled = !LAV;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
document.body.prepend(renderer.domElement);
// AR på Quest 3: flyet som modell i rommet ditt (passthrough). hit-test finner bord og gulv.
const arKnapp = ARButton.createButton(renderer, { requiredFeatures: ['local-floor'], optionalFeatures: ['hit-test'] });
arKnapp.id = 'ARButton';
document.body.appendChild(arKnapp);
setTimeout(() => { if (/NOT|ERROR/i.test(arKnapp.textContent)) arKnapp.style.display = 'none'; }, 1500);
const vrKnapp = VRButton.createButton(renderer);
vrKnapp.id = 'VRButton';
document.body.appendChild(vrKnapp);
// Uten WebXR viser three.js «WEBXR NOT AVAILABLE»; det er bare støy på desktop, så skjul den.
setTimeout(() => { if (/NOT|ERROR/i.test(vrKnapp.textContent)) vrKnapp.style.display = 'none'; }, 1500);

const scene = new THREE.Scene();
const omgivelser = new Omgivelser(scene, renderer, { bakkeY: BAKKE_Y, skygger: !LAV });
const KLIPP_FLY = new THREE.Plane(new THREE.Vector3(0, -1, 0), CUT); // behold y ≤ CUT, i flyets koordinater
const klipp = KLIPP_FLY.clone(); // samme plan i verden; følger flyet når det rister

const fly = new THREE.Group();
// Plassering: i VR og på desktop står flyet i full størrelse i origo; i AR skaleres og flyttes denne gruppa.
const plassering = new THREE.Group();
plassering.add(fly);
scene.add(plassering);
const folk = new Folk(fly);

// Desktop-kamera med orbit, og et eget XR-kamera i en rigg som kan flyttes.
const kamera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.05, 2000);
kamera.position.set(9, 10, -6);
const orbit = new OrbitControls(kamera, renderer.domElement);
orbit.enableDamping = true;
orbit.maxPolarAngle = Math.PI * 0.62; // litt under horisonten, så lasterommet kan sees fra siden
orbit.minDistance = 1.2;
orbit.maxDistance = 90;
orbit.screenSpacePanning = false; // høyreklikk-dra flytter langs gulvet
orbit.zoomToCursor = true; // rulling zoomer mot der pekeren står
orbit.target.set(0, 0.6, 10);

const rigg = new THREE.Group();
const xrKamera = new THREE.PerspectiveCamera(70, 1, 0.05, 2000);
rigg.add(xrKamera);
scene.add(rigg);

// Infotavla: som kort i hjørnet på desktop, svevende over nesa og på venstre hånd i VR.
const tavle = new Infotavle();
$('#info').appendChild(tavle.c);
const tavleSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tavle.tex, toneMapped: false }));
tavleSprite.scale.set(4.8, 3.0, 1);
tavleSprite.visible = false;
fly.add(tavleSprite);

/* ---------- Tilstand ---------- */
let kabinData = null;
let kartData = null;
let layout = null;
let kabin = null;
let skrog = null;
let lasterom = null;
let sistOk = 0;
let feilTekst = '';
let folgerSete = null; // passasjeren kameraet følger
// Kabinlyden: lytteren sitter i kameraet (i VR i XR-kameraet), lydene plasseres i flyets koordinater.
const lytter = new THREE.AudioListener();
kamera.add(lytter);
const _v = new THREE.Vector3();
const kabinlyd = new Kabinlyd(lytter, (sete) => {
  const s = layout?.seter.get(sete);
  return s ? new THREE.Vector3(s.x, 1.05, s.z) : null;
}, {
  foran: () => new THREE.Vector3(0, 1.4, (layout?.rader[0]?.z ?? 0) - 0.6),
  toalett: (sete) => {
    const z = layout?.seter.get(sete)?.z ?? 0;
    const t = [...(kabin?.toaletter || [])].sort((a, b) => Math.abs(a.z - z) - Math.abs(b.z - z))[0];
    return t ? new THREE.Vector3(t.x, 0.9, t.z) : new THREE.Vector3(0, 0.9, z);
  },
  vogn: () => (kabin?.vogn.visible ? _v.copy(kabin.vogn.position).setY(0.8) : null),
});
kabinlyd.festTil(fly);
let kabinLysMaal = 1; // fullt under boarding/servering; ellers 75 % om dagen og 45 % om kvelden og natta
let tidNaa = 'dag'; // dag | kveld | natt (fra valget eller Auto)
/** Kabinlyset: fullt under servering, boarding og ved gaten; ellers litt dempet om dagen og mer om kvelden og natta. */
let lysManuell = false; // styrt selv med glidebryteren i stedet for automatisk
function oppdaterKabinLys() {
  if (lysManuell) { kabinLysMaal = Number($('#lys-niva').value) / 100; return; }
  if (!kabinData) return;
  const stille = omgivelser.paaBakken && (kartData?.gsKt ?? 0) < 3;
  const fullt = kabinData.servering === 'open' || kabinData.gate === 'open' || stille;
  // Uten servering: litt dempet om dagen, mer dempet om kvelden og natta.
  kabinLysMaal = fullt ? 1 : tidNaa === 'dag' ? 0.75 : 0.45;
}
const flytilstand = new Flytilstand(); // det cockpitinstrumentene viser

function byggPaaNytt() {
  const ny = lagLayout(kabinData);
  if (layout && ny.nokkel === layout.nokkel) return;
  for (const o of [kabin?.gruppe, skrog?.gruppe, lasterom?.gruppe]) {
    if (!o) continue;
    fly.remove(o);
    o.traverse((m) => { if (m.isMesh) { m.geometry.dispose(); [].concat(m.material).forEach((x) => x.dispose()); } });
  }
  const forst = !layout;
  layout = ny;
  kabin = byggKabin(layout);
  skrog = byggSkrog(layout, klipp);
  lasterom = new Lasterom(layout);
  fly.add(kabin.gruppe, skrog.gruppe, lasterom.gruppe);
  folk.settKabin(layout, kabin);
  tavleSprite.position.set(-6.5, 3.6, layout.zNese + 1.5);
  if (forst) {
    gaaTil('oversikt', true);
    rigg.position.set(0, CUT + 0.6, layout.rader[0]?.z ?? 0);
  }
}

/* ---------- Faste visninger ---------- */
const REKKEFOLGE = ['oversikt', 'cockpit', 'foran', 'midten', 'bak', 'lasterom'];

/** [mål, kameraposisjon, VR-posisjon (føttene)] for hver visning, ut fra seteoppsettet. */
function visninger() {
  const L = layout;
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const r = (i) => L.rader[Math.min(L.rader.length - 1, Math.max(0, i))]?.z ?? 0;
  const midt = Math.floor(L.rader.length / 2);
  const midtZ = (L.zNese + L.zBak) / 2;
  const holdZ = (L.lasterom[0][0] + L.lasterom[0][1]) / 2;
  return {
    oversikt: [V(0, 0.5, midtZ - 3), V(13, 15, L.zNese - 9), V(7, 7, midtZ)],
    cockpit: [V(0, 0.8, L.zNese + 0.2), V(2.2, 3.4, L.zNese + 3.3), V(0, CUT + 0.4, L.zNese + 1.5)],
    foran: [V(0, 0.6, r(4)), V(3.2, 4.4, r(0) - 2.6), V(0, CUT + 0.4, r(1))],
    midten: [V(0, 0.6, r(midt)), V(3.4, 4.6, r(midt) - 4.2), V(0, CUT + 0.4, r(midt - 2))],
    bak: [V(0, 0.6, L.zBak - 3), V(-3.2, 4.6, L.zBak - 7.5), V(0, CUT + 0.4, L.sisteZ - 3)],
    lasterom: [V(-1.0, -0.55, holdZ), V(-6.0, 0.4, holdZ - 3.2), V(-3.0, -2.2, holdZ)],
  };
}

let fart = null; // pågående kameraflytting { fraM, fraK, tilM, tilK, t }
let aktivVisning = 'oversikt';
function gaaTil(navn, straks = false) {
  if (!layout) return;
  if (!straks) autoFulgt = true; // brukeren har valgt en visning selv
  const [m, k] = visninger()[navn];
  slippFolg();
  aktivVisning = navn;
  document.querySelectorAll('#verktoy [data-vis]').forEach((b) => b.classList.toggle('aktiv', b.dataset.vis === navn));
  if (straks) { orbit.target.copy(m); kamera.position.copy(k); return; }
  fart = { fraM: orbit.target.clone(), fraK: kamera.position.clone(), tilM: m, tilK: k, t: 0 };
}

function flyttKamera(dt) {
  if (!fart) return;
  fart.t = Math.min(1, fart.t + dt / 0.9);
  const e = fart.t < 0.5 ? 4 * fart.t ** 3 : 1 - (-2 * fart.t + 2) ** 3 / 2; // ease-in-out
  orbit.target.lerpVectors(fart.fraM, fart.tilM, e);
  kamera.position.lerpVectors(fart.fraK, fart.tilK, e);
  if (fart.t >= 1) fart = null;
}

/* ---------- Følge en passasjer ---------- */
const _p = new THREE.Vector3();
const FOLG_MAAL = new THREE.Vector3(0, 0.95, -1.2); // hvor kameraet ser, i forhold til personen (litt foran)
let folgerNokkel = null; // figuren som følges (personen, også når de bytter sete)
function folg(hvem) {
  const f = hvem.startsWith('pax:') ? folk.figurer.get(hvem) : folk.figurFor(hvem);
  if (!f) return;
  folgerNokkel = f.nokkel;
  folgerSete = f.sete;
  aktivVisning = '';
  document.querySelectorAll('#verktoy [data-vis]').forEach((b) => b.classList.remove('aktiv'));
  // Kameraet glir inn til en vinkel bak og over passasjeren.
  // Figurens plass (pos settes straks; gruppa flyttes først ved neste bilde).
  _p.set(f.pos.x, 0, f.pos.y).applyMatrix4(fly.matrixWorld);
  // Bak og over personen, forskjøvet ut mot midtgangen (aldri utenfor skroget ved vindusseter),
  // med blikket forover langs seteradene.
  const side = Math.sign((layout?.midtgang ?? 0) - _p.x) || 1;
  const m = _p.clone().add(FOLG_MAAL);
  fart = { fraM: orbit.target.clone(), fraK: kamera.position.clone(), tilM: m, tilK: _p.clone().add(new THREE.Vector3(side * 1.15, 2.25, 1.9)), t: 0 };
  oppdaterListe();
}
function slippFolg() { for (const x of folk.figurer.values()) x.skjulSkilt = false; folgerSete = null; folgerNokkel = null; $('#folger').style.display = 'none'; oppdaterListe(); }
$('#folger-slipp').addEventListener('click', slippFolg);
// Følgevinkel: ovenfra (standard) eller bak passasjeren, i øyehøyde og med blikket forover langs flyet.
let folgBak = url.get('vinkel') === 'bak'; // ?vinkel=bak starter rett bak passasjeren
let autoFulgt = false; // ?navn= følger den chatteren én gang, til brukeren velger noe annet selv
function byttFolgVinkel() {
  if (!folgerSete) return;
  folgBak = !folgBak;
  $('#folger-vinkel').textContent = folgBak ? '🎥 Ovenfra' : '🎥 Bak';
  if (!folgBak) folg(folgerSete);
}
$('#folger-vinkel').addEventListener('click', byttFolgVinkel);

function folgTick() {
  if (!folgerSete || fart) return;
  const f = folk.figurer.get(folgerNokkel);
  if (!f) { slippFolg(); return; }
  if (f.sete && f.sete !== folgerSete) { folgerSete = f.sete; oppdaterListe(); }
  f.g.getWorldPosition(_p);
  for (const x of folk.figurer.values()) x.skjulSkilt = folgBak && x === f; // ikke skilt rett foran kameraet
  if (folgBak) {
    // Bak og litt over hodet, blikket forover (-z) langs midtgangen.
    const maal = _p.clone().add(new THREE.Vector3(0, 0.9, -3.6));
    const kam = _p.clone().add(new THREE.Vector3(0, 2.05, 1.35));
    orbit.target.lerp(maal, 0.12);
    kamera.position.lerp(kam, 0.12);
  } else {
    const flytt = _p.add(FOLG_MAAL).sub(orbit.target).multiplyScalar(0.12); // mykt etter, samme vinkel
    orbit.target.add(flytt);
    kamera.position.add(flytt);
  }
  const el = $('#folger');
  el.style.display = 'flex';
  el.querySelector('span').textContent = `Følger ${f.navn} (${folgerSete})`;
}

/* ---------- Passasjerlista ---------- */
const liste = $('#liste');
function oppdaterListe() {
  if (!liste.classList.contains('apen') || !kabinData) return;
  const ul = liste.querySelector('ul');
  const naa = folk.naa();
  const pax = [...kabinData.pax].sort((a, b) => (parseInt(a.sete) || 0) - (parseInt(b.sete) || 0) || a.sete.localeCompare(b.sete));
  liste.querySelector('h2').textContent = `Om bord (${pax.length})`;
  ul.replaceChildren(...(pax.length ? pax.map((p) => {
    const li = document.createElement('li');
    li.className = p.sete === folgerSete ? 'valgt' : '';
    const [, tekst] = status(p, naa, kabinData.belte);
    const sete = document.createElement('span'); sete.className = 'sete'; sete.textContent = p.sete;
    const navn = document.createElement('span'); navn.className = 'navn'; navn.textContent = p.navn;
    const hva = document.createElement('span'); hva.className = 'hva'; hva.textContent = tekst || 'sitter';
    li.append(sete, navn, hva);
    li.addEventListener('click', () => folg(p.sete));
    return li;
  }) : [Object.assign(document.createElement('li'), { className: 'tom', textContent: 'Ingen om bord akkurat nå. Skriv !board i chatten når gaten er åpen.' })]));
}
const vekslListe = () => { liste.classList.toggle('apen'); oppdaterListe(); };
$('#knapp-liste').addEventListener('click', vekslListe);
const fullskjerm = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.());
$('#knapp-fullskjerm').addEventListener('click', fullskjerm);
document.querySelectorAll('#verktoy [data-vis]').forEach((b) => b.addEventListener('click', () => gaaTil(b.dataset.vis)));

/* ---------- Streamen ---------- */
// Twitch sin innebygde spiller. parent må være domenet siden kjører på; den starter dempet.
/* Flyttbare ruter: tittellinje å dra i, størrelse i hjørnet (CSS resize), husket i nettleseren. */
function flyttbar(el, navn, tittel) {
  const NOKKEL = `tmt-rute-${navn}`;
  const linje = document.createElement('div');
  linje.className = 'handtak';
  linje.innerHTML = `<span></span><button type="button" title="Tilbake til standardplass">↺</button>`;
  linje.firstChild.textContent = tittel;
  const innhold = document.createElement('div');
  innhold.className = 'innhold';
  el.replaceChildren(linje, innhold);
  const lagre = () => {
    if (!el.dataset.flyttet) return;
    try { localStorage.setItem(NOKKEL, JSON.stringify({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight })); } catch { /* privat modus */ }
  };
  const plasser = (x, y) => {
    // Første flytt: lås størrelsen, ellers krymper ruta når den slipper høyre/bunn-forankringen.
    if (!el.dataset.flyttet && el.offsetWidth) Object.assign(el.style, { width: `${el.offsetWidth}px`, height: `${el.offsetHeight}px` }); // (skjult rute: behold lagret størrelse)
    x = Math.max(0, Math.min(innerWidth - 80, x));
    y = Math.max(0, Math.min(innerHeight - 40, y));
    Object.assign(el.style, { left: `${x}px`, top: `${y}px`, right: 'auto', bottom: 'auto' });
    // Hold ruta innenfor vinduet nedover (krymp heller enn å havne under kanten).
    const maksH = innerHeight - y - 8;
    if (el.offsetHeight > maksH) el.style.height = `${Math.max(parseFloat(getComputedStyle(el).minHeight) || 120, maksH)}px`;
    el.dataset.flyttet = '1';
  };
  try {
    const p = JSON.parse(localStorage.getItem(NOKKEL) || 'null');
    if (p) {
      // Lagret størrelse under minstemålet (f.eks. fra en eldre versjon) overses.
      const cs = getComputedStyle(el);
      const w = Math.max(p.w, parseFloat(cs.minWidth) || 0), h = Math.max(p.h, parseFloat(cs.minHeight) || 0);
      Object.assign(el.style, { width: `${w}px`, height: `${h}px` });
      plasser(p.x, p.y);
    }
  } catch { /* ugyldig */ }
  // Dra: lytt på hele vinduet mens knappen er nede, så det virker uansett hvor musa er.
  linje.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button') || e.button !== 0) return;
    const dx = e.clientX - el.offsetLeft, dy = e.clientY - el.offsetTop;
    document.body.classList.add('drar-rute'); // iframene tar ikke imot musa mens vi drar
    const flytt = (ev) => plasser(ev.clientX - dx, ev.clientY - dy);
    const slipp = () => {
      removeEventListener('pointermove', flytt); removeEventListener('pointerup', slipp); removeEventListener('pointercancel', slipp);
      document.body.classList.remove('drar-rute');
      lagre();
    };
    addEventListener('pointermove', flytt); addEventListener('pointerup', slipp); addEventListener('pointercancel', slipp);
    e.preventDefault();
    e.stopPropagation();
  });
  linje.querySelector('button').addEventListener('click', () => {
    el.removeAttribute('style'); delete el.dataset.flyttet;
    try { localStorage.removeItem(NOKKEL); } catch { /* privat modus */ }
  });
  // Størrelse endret med hjørnet: husk den (bare etter at brukeren faktisk har dratt i den).
  let forrige = '';
  new ResizeObserver(() => {
    const str = `${el.offsetWidth}x${el.offsetHeight}`;
    if (forrige && str !== forrige && el.classList.contains('apen')) { if (!el.dataset.flyttet) plasser(el.offsetLeft, el.offsetTop); lagre(); }
    if (el.classList.contains('apen')) forrige = str;
  }).observe(el);
  return innhold;
}

const streamEl = $('#stream');
const streamInnhold = flyttbar(streamEl, 'stream', '📺 TrasMaTech på Twitch');
function visStream(paa) {
  streamEl.classList.toggle('apen', paa);
  $('#knapp-stream').classList.toggle('aktiv', paa);
  if (paa && !streamInnhold.firstChild) {
    const f = document.createElement('iframe');
    f.src = `https://player.twitch.tv/?channel=trasmatech&parent=${encodeURIComponent(location.hostname)}&muted=true&autoplay=true`;
    f.allow = 'autoplay; fullscreen';
    f.allowFullscreen = true;
    f.title = 'TrasMaTech på Twitch';
    streamInnhold.appendChild(f);
  }
  if (!paa) streamInnhold.replaceChildren(); // stopper videoen helt når ruta lukkes
  try { localStorage.setItem('tmt-stream', paa ? '1' : '0'); } catch { /* privat modus */ }
}
const byttStream = () => visStream(!streamEl.classList.contains('apen'));
$('#knapp-stream').addEventListener('click', byttStream);
visStream((() => { try { return localStorage.getItem('tmt-stream') ?? (innerWidth > 1000 ? '1' : '0'); } catch { return '0'; } })() === '1');

/* ---------- Chatten ---------- */
// Twitch sin innebygde chat (mørk). Lese kan alle; skrive krever innlogging på Twitch i nettleseren.
const chatEl = $('#chat');
const chatInnhold = flyttbar(chatEl, 'chat', '💬 Chatten');
function visChat(paa) {
  chatEl.classList.toggle('apen', paa);
  $('#knapp-chat').classList.toggle('aktiv', paa);
  if (paa && !chatInnhold.firstChild) {
    const f = document.createElement('iframe');
    f.src = `https://www.twitch.tv/embed/trasmatech/chat?parent=${encodeURIComponent(location.hostname)}&darkpopout`;
    f.title = 'Chatten på Twitch';
    chatInnhold.appendChild(f);
  }
  try { localStorage.setItem('tmt-chat', paa ? '1' : '0'); } catch { /* privat modus */ }
}
const byttChat = () => visChat(!chatEl.classList.contains('apen'));
$('#knapp-chat').addEventListener('click', byttChat);
visChat((() => { try { return localStorage.getItem('tmt-chat') ?? (innerWidth > 1300 ? '1' : '0'); } catch { return '0'; } })() === '1');

/* ---------- Kabinlyset: automatisk eller styrt selv ---------- */
const lysKnapp = $('#knapp-lys'), lysNiva = $('#lys-niva');
function settLysModus(manuell) {
  lysManuell = manuell;
  lysKnapp.firstChild.textContent = manuell ? '💡 Manuell' : '💡 Auto';
  lysKnapp.classList.toggle('aktiv', manuell);
  document.body.classList.toggle('lys-manuell', manuell);
  if (manuell && !lysNiva.dataset.satt) lysNiva.value = Math.round(KABIN.value * 100); // start der lyset er nå
  oppdaterKabinLys();
  try { localStorage.setItem('tmt-lys', manuell ? lysNiva.value : 'auto'); } catch { /* privat modus */ }
}
const byttLysModus = () => settLysModus(!lysManuell);
lysKnapp.addEventListener('click', byttLysModus);
lysNiva.addEventListener('input', () => {
  lysNiva.dataset.satt = '1';
  oppdaterKabinLys();
  try { localStorage.setItem('tmt-lys', lysNiva.value); } catch { /* privat modus */ }
});
(() => {
  let v = null;
  try { v = localStorage.getItem('tmt-lys'); } catch { /* privat modus */ }
  if (v && v !== 'auto') { lysNiva.value = v; lysNiva.dataset.satt = '1'; settLysModus(true); }
})();

/* ---------- Kabinlyden ---------- */
// Må slås på med et trykk (nettlesere spiller ikke lyd før brukeren har gjort noe). Valget og volumet huskes,
// men lyden starter først ved neste trykk på siden.
const lydKnapp = $('#knapp-lyd'), lydVolum = $('#lyd-volum');
try { lydVolum.value = localStorage.getItem('tmt-lydvolum') ?? 80; } catch { /* privat modus */ }
kabinlyd.settVolum(lydVolum.value / 100);
async function settLyd(paa) {
  await kabinlyd.settPaa(paa);
  lydKnapp.classList.toggle('aktiv', paa);
  lydKnapp.firstChild.textContent = paa ? '🔊 Lyd' : '🔈 Lyd';
  document.body.classList.toggle('lyd-paa', paa);
  try { localStorage.setItem('tmt-lyd', paa ? '1' : '0'); } catch { /* privat modus */ }
}
const byttLyd = () => settLyd(!kabinlyd.paa);
lydKnapp.addEventListener('click', byttLyd);
lydVolum.addEventListener('input', () => {
  kabinlyd.settVolum(lydVolum.value / 100);
  try { localStorage.setItem('tmt-lydvolum', lydVolum.value); } catch { /* privat modus */ }
});
// Var lyden på sist: slå den på igjen ved første trykk hvor som helst.
if ((() => { try { return localStorage.getItem('tmt-lyd') === '1'; } catch { return false; } })()) {
  addEventListener('pointerdown', () => { if (!kabinlyd.paa) settLyd(true); }, { once: true, capture: true });
}
setInterval(() => kabinlyd.tick(), 250);

/* ---------- Dag, kveld og natt ---------- */
// Auto regner ut solhøyden der flyet er (eller i Oslo uten posisjon); valget huskes i nettleseren.
const TIDSVALG = ['auto', 'dag', 'kveld', 'natt'];
const TIDSTEKST = { auto: '🌗 Auto', dag: '☀️ Dag', kveld: '🌆 Kveld', natt: '🌙 Natt' };
let tidsvalg = (() => { try { return TIDSVALG.includes(localStorage.getItem('tmt-tid')) ? localStorage.getItem('tmt-tid') : 'auto'; } catch { return 'auto'; } })();
function autoTid() {
  const h = solhoyde(kartData?.lat ?? 59.9, kartData?.lon ?? 10.75);
  return h > 6 ? 'dag' : h > -6 ? 'kveld' : 'natt';
}
function brukTid() {
  const navn = tidsvalg === 'auto' ? autoTid() : tidsvalg;
  omgivelser.settTid(navn);
  tidNaa = navn;
  oppdaterKabinLys();
  const knapp = $('#knapp-tid');
  knapp.firstChild.textContent = tidsvalg === 'auto' ? `🌗 Auto (${navn})` : TIDSTEKST[tidsvalg];
}
const byttTid = () => {
  tidsvalg = TIDSVALG[(TIDSVALG.indexOf(tidsvalg) + 1) % TIDSVALG.length];
  try { localStorage.setItem('tmt-tid', tidsvalg); } catch { /* privat modus */ }
  brukTid();
};
$('#knapp-tid').addEventListener('click', byttTid);
brukTid();
setInterval(() => { if (tidsvalg === 'auto') brukTid(); }, 30000);

/* ---------- Oppdatering fra data ---------- */
function hjorne() {
  if (!UTHEV || !kabinData) return '';
  const p = kabinData.pax.find((x) => x.navn.toLowerCase() === UTHEV);
  return p ? `${p.navn}: sete ${p.sete}` : '';
}

function oppdaterScene() {
  if (!kabinData || !layout) return;
  folk.oppdater(kabinData, UTHEV);
  // ?navn=: gå til den chatteren og følg dem, så snart de er om bord (også om de boarder senere).
  if (UTHEV && !autoFulgt) {
    const meg = kabinData.pax.find((p) => p.navn.toLowerCase() === UTHEV);
    if (meg && folk.figurFor(meg.sete)) {
      autoFulgt = true;
      folg(meg.sete);
      if (folgBak) $('#folger-vinkel').textContent = '🎥 Ovenfra';
    }
  }
  lasterom.oppdater(kabinData.lasterom, kabinData.lasteromInfo, folk.naa());
  kabin.skiltMat.emissive.set(kabinData.belte === 'on' ? 0xffa53a : 0x000000);
  oppdaterKabinLys();
  const v = kabinData.servering === 'open' && kabinData.vogn && kabinData.vogn.rad > 0 ? kabinData.vogn : null;
  if (v && !kabin.vogn.visible) kabin.vogn.position.z = (layout.rader[0]?.z ?? 0) - 0.4; // ruller ut fra byssa
  kabin.vogn.visible = !!v;
  kabin.vognMaal = v ? (layout.radZ.get(v.rad) ?? kabin.vogn.position.z) + 0.38 : null; // mellom radene
  tavle.tegn(kabinData, kartData, '', hjorne());
  oppdaterListe();
}

function visStatus() {
  const f = kabinData?.fly;
  const deler = [DEMO ? 'Demo' : 'Live'];
  if (f) deler.push(f.callsign, f.faseTekst?.no || f.fase, `${kabinData.pax.length} om bord`);
  if (feilTekst) deler.push(`⚠ ${feilTekst}`);
  else if (!DEMO && sistOk && Date.now() - sistOk > 20000) deler.push('⚠ gamle data');
  statusEl.textContent = deler.filter(Boolean).join(' · ');
}

const kilder = {
  onKabin(d) {
    if (!d) return;
    kabinData = d; sistOk = Date.now(); feilTekst = '';
    kabinlyd.data(d.lyd);
    byggPaaNytt();
    oppdaterScene();
    visStatus();
  },
  onKart(d) {
    if (!d) return;
    kartData = d;
    omgivelser.sett(d);
    flytilstand.sett(d, kabinData);
    if (kabinData) tavle.tegn(kabinData, kartData, '', hjorne());
  },
  onFeil(e) {
    feilTekst = e.message;
    visStatus();
    if (!kabinData) tavle.tegn(null, null, 'Får ikke kontakt med TrasmaBot');
  },
};
// På den hostede versjonen: last siden på nytt når det kommer et nytt bygg (ikke i Vite-dev, som har egen HMR).
if (import.meta.env.PROD && 'EventSource' in window) {
  let forste = null;
  new EventSource('/api/versjon').onmessage = (e) => {
    if (forste === null) forste = e.data;
    else if (e.data !== forste) location.reload();
  };
}
// Synk med streamen: vis alt like mye forsinket som nettsiden spiller lyden (lyd.forsinkelse, nå ~5 s),
// så det som skjer i appen treffer samtidig med bildet og kabinlyden i streamen. ?forsinkelse=0 viser alt med en gang.
const FAST_FORSINKELSE = url.has('forsinkelse') ? Math.max(0, Math.min(30, Number(url.get('forsinkelse')) || 0)) : null;
let forsinkelseS = DEMO ? 0 : FAST_FORSINKELSE ?? 5;
let sistNa = 0; // botens klokke i siste kabindata (kartdataene har ingen egen)
const forsinket = (fn) => (d) => {
  if (d?.forsinkelse != null && FAST_FORSINKELSE == null && !DEMO) forsinkelseS = d.forsinkelse;
  if (d?.na) sistNa = d.na;
  if (!forsinkelseS) return fn(d);
  // Regn fra når boten laget dataene (som nettsiden gjør), ikke fra når vi fikk dem: mellomlagring og
  // hentetakt er da allerede med i regnestykket.
  const alder = sistNa ? Math.max(0, Date.now() - (d?.na || sistNa)) : 0;
  setTimeout(() => fn(d), Math.max(0, forsinkelseS * 1000 - alder));
};
(DEMO ? startDemo : startLive)({ ...kilder, onKabin: forsinket(kilder.onKabin), onKart: forsinket(kilder.onKart), fraFase: url.get('demo') });
window.__kabinXR = { scene, kamera, orbit, rigg, folk, gaaTil, folg, layout: () => layout, data: () => kabinData, kabinLys: () => KABIN.value, kabinlyd };

/* ---------- Desktop: klikk følger en passasjer, dobbeltklikk ser på et punkt ---------- */
const straale = new THREE.Raycaster();
const pek = (e) => {
  straale.setFromCamera(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), kamera);
  return straale.intersectObject(fly, true).filter((t) => t.object.visible && !t.object.isSprite);
};
let ned = null;
renderer.domElement.addEventListener('pointerdown', (e) => { ned = { x: e.clientX, y: e.clientY }; fart = null; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!ned || Math.hypot(e.clientX - ned.x, e.clientY - ned.y) > 4 || e.button !== 0) return;
  const t = pek(e).find((x) => x.object.userData.figur);
  const n = t?.object.userData.figur;
  if (n?.startsWith('pax:')) folg(n);
});
renderer.domElement.addEventListener('dblclick', (e) => {
  const treff = pek(e).find((t) => t.point.y <= CUT + 0.6);
  if (!treff) return;
  slippFolg();
  fart = { fraM: orbit.target.clone(), fraK: kamera.position.clone(), tilM: treff.point.clone(), tilK: kamera.position.clone().add(treff.point.clone().sub(orbit.target)), t: 0 };
});

// Tastatur: 1–6 visninger, WASD/piler flytter, Q/E opp/ned, P liste, F fullskjerm, Esc slipp.
const taster = new Set();
addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, textarea')) return;
  const k = e.key.toLowerCase();
  if (/^[1-6]$/.test(k)) gaaTil(REKKEFOLGE[Number(k) - 1]);
  else if (k === 'escape') slippFolg();
  else if (k === 'v') byttFolgVinkel();
  else if (k === 'p') vekslListe();
  else if (k === 'f') fullskjerm();
  else if (k === 'n') byttTid();
  else if (k === 't') byttStream();
  else if (k === 'c') byttChat();
  else if (k === 'l') byttLyd();
  else if (k === 'b') byttLysModus();
  else taster.add(k);
});
addEventListener('keyup', (e) => taster.delete(e.key.toLowerCase()));
addEventListener('blur', () => taster.clear());
const _fr = new THREE.Vector3(), _hy = new THREE.Vector3();
function tastFlytt(dt) {
  let fx = 0, fz = 0, fy = 0;
  if (taster.has('w') || taster.has('arrowup')) fz += 1;
  if (taster.has('s') || taster.has('arrowdown')) fz -= 1;
  if (taster.has('a') || taster.has('arrowleft')) fx -= 1;
  if (taster.has('d') || taster.has('arrowright')) fx += 1;
  if (taster.has('e')) fy += 1;
  if (taster.has('q')) fy -= 1;
  if (!fx && !fz && !fy) return;
  if (folgerSete) slippFolg();
  fart = null;
  kamera.getWorldDirection(_fr); _fr.y = 0; _fr.normalize();
  _hy.set(-_fr.z, 0, _fr.x);
  const v = Math.max(3, kamera.position.distanceTo(orbit.target) * 0.9) * dt;
  const d = _fr.multiplyScalar(fz * v).add(_hy.multiplyScalar(fx * v)).add(new THREE.Vector3(0, fy * v, 0));
  orbit.target.add(d);
  kamera.position.add(d);
}

addEventListener('resize', () => {
  kamera.aspect = innerWidth / innerHeight;
  kamera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

/* ---------- VR ---------- */
const handTavle = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.15), new THREE.MeshBasicMaterial({ map: tavle.tex, toneMapped: false }));
handTavle.position.set(0, 0.06, 0.02);
handTavle.rotation.set(-1.1, 0, 0);
const peker = new THREE.Mesh(new THREE.RingGeometry(0.12, 0.17, 32), new THREE.MeshBasicMaterial({ color: 0x6aa0ff, depthTest: false, transparent: true, opacity: 0.85 }));
peker.rotation.x = -Math.PI / 2;
peker.renderOrder = 20;
peker.visible = false;
scene.add(peker);
const kontrollere = [0, 1].map((i) => {
  const grep = renderer.xr.getControllerGrip(i);
  grep.addEventListener('connected', (e) => { if (e.data.handedness === 'left') grep.add(handTavle); });
  grep.addEventListener('disconnected', () => { if (handTavle.parent === grep) grep.remove(handTavle); });
  rigg.add(grep);
  const c = renderer.xr.getController(i);
  const linje = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]), new THREE.LineBasicMaterial({ color: 0x6aa0ff }));
  linje.scale.z = 30;
  c.add(linje);
  // Avtrekkeren: flytt deg dit du peker (føttene havner over punktet, litt over taket på kabinen).
  // Grepknappen (AR): hold for å flytte flyet; med begge hender zoomer og roterer du.
  c.addEventListener('squeezestart', () => { c.userData.grep = true; ar.grep.set(c, c.getWorldPosition(new THREE.Vector3())); });
  c.addEventListener('squeezeend', () => { c.userData.grep = false; ar.grep.delete(c); });
  c.addEventListener('select', () => {
    if (arModus) { // AR: sett flyet der ringen viser (på bordet eller gulvet)
      if (arRing.visible) { ar.anker.copy(arRing.position); ar.plassert = true; }
      return;
    }
    const t = vrSikt(c);
    if (!t) return;
    renderer.xr.getCamera().getWorldPosition(_hode);
    rigg.position.x += t.point.x - _hode.x;
    rigg.position.z += t.point.z - _hode.z;
    rigg.position.y = t.point.y < 0 ? t.point.y - 1.2 : Math.max(CUT + 0.2, rigg.position.y);
  });
  rigg.add(c);
  return c;
});

const _m4 = new THREE.Matrix4();
function vrSikt(c) {
  _m4.identity().extractRotation(c.matrixWorld);
  straale.ray.origin.setFromMatrixPosition(c.matrixWorld);
  straale.ray.direction.set(0, 0, -1).applyMatrix4(_m4);
  return straale.intersectObject(fly, true).find((t) => t.object.visible && !t.object.isSprite);
}

function vrVisning(retning) {
  const i = (REKKEFOLGE.indexOf(aktivVisning) + retning + REKKEFOLGE.length) % REKKEFOLGE.length;
  aktivVisning = REKKEFOLGE[i];
  const [, , fot] = visninger()[aktivVisning];
  renderer.xr.getCamera().getWorldPosition(_hode);
  rigg.position.x += fot.x - _hode.x;
  rigg.position.z += fot.z - _hode.z;
  rigg.position.y = fot.y;
}

const _fram = new THREE.Vector3();
const _hode = new THREE.Vector3();
let snuKlar = true;
const knappFor = new Map();
function vrFlytt(dt) {
  const okt = renderer.xr.getSession();
  if (!okt) return;
  for (const kilde of okt.inputSources) {
    const gp = kilde.gamepad;
    if (!gp) continue;
    // A/X (knapp 4) = neste visning, B/Y (knapp 5) = forrige; reagerer på trykk, ikke hold.
    for (const [b, r] of [[4, 1], [5, -1]]) {
      const n = `${kilde.handedness}${b}`;
      const trykt = !!gp.buttons[b]?.pressed;
      if (trykt && !knappFor.get(n)) vrVisning(r);
      knappFor.set(n, trykt);
    }
    if (gp.axes.length < 4) continue;
    const ax = Math.abs(gp.axes[2]) > 0.15 ? gp.axes[2] : 0;
    const ay = Math.abs(gp.axes[3]) > 0.15 ? gp.axes[3] : 0;
    if (kilde.handedness === 'left' && (ax || ay)) {
      renderer.xr.getCamera().getWorldDirection(_fram);
      _fram.y = 0; _fram.normalize();
      const v = (2.2 + Math.max(0, rigg.position.y - CUT) * 0.4) * dt;
      rigg.position.addScaledVector(_fram, -ay * v);
      rigg.position.addScaledVector(new THREE.Vector3(-_fram.z, 0, _fram.x), ax * v);
    } else if (kilde.handedness === 'right') {
      if (Math.abs(ax) > 0.7 && snuKlar) {
        renderer.xr.getCamera().getWorldPosition(_hode);
        const v = -Math.sign(ax) * Math.PI / 6;
        rigg.position.sub(_hode).applyAxisAngle(THREE.Object3D.DEFAULT_UP, v).add(_hode);
        rigg.rotation.y += v;
        snuKlar = false;
      } else if (Math.abs(ax) < 0.3) snuKlar = true;
      if (ay) rigg.position.y = THREE.MathUtils.clamp(rigg.position.y - ay * 1.6 * dt, BAKKE_Y, 18);
    }
  }
  // Sikteringen viser hvor du havner.
  peker.visible = false;
  for (const c of kontrollere) {
    const t = vrSikt(c);
    if (t) { peker.position.copy(t.point).y += 0.02; peker.visible = true; break; }
  }
}
/* ---------- AR: modellen i rommet ---------- */
let arModus = false;
const AR_SKALA = 1 / 30; // ca. 1,5 m langt fly
const ar = { anker: new THREE.Vector3(), yaw: 0, skala: AR_SKALA, plassert: false, hitKilde: null, grep: new Map(), tohand: null };
const arRing = new THREE.Mesh(new THREE.RingGeometry(0.06, 0.08, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x6aa0ff, transparent: true, opacity: 0.9 }));
arRing.visible = false;
scene.add(arRing);
/** Flyets midtpunkt (i flyets koordinater) som står på ankeret: midt på flykroppen, hjulene på flaten. */
const arMidt = () => new THREE.Vector3(0, BAKKE_Y, layout ? (layout.zNese + layout.zBak) / 2 : 10);
function arOppdaterPlassering() {
  plassering.scale.setScalar(ar.skala);
  plassering.rotation.set(0, ar.yaw, 0);
  const c = arMidt().multiplyScalar(ar.skala).applyAxisAngle(THREE.Object3D.DEFAULT_UP, ar.yaw);
  plassering.position.copy(ar.anker).sub(c);
}
async function startAR(okt) {
  arModus = true;
  scene.background = null;
  omgivelser.bakke.visible = false;
  tavleSprite.visible = false;
  rigg.position.set(0, 0, 0); rigg.rotation.set(0, 0, 0);
  ar.skala = AR_SKALA; ar.plassert = false; ar.grep.clear(); ar.tohand = null;
  try {
    const visning = await okt.requestReferenceSpace('viewer');
    ar.hitKilde = await okt.requestHitTestSource?.({ space: visning });
  } catch { ar.hitKilde = null; }
}
function stoppAR() {
  arModus = false;
  scene.background = new THREE.Color(0x14171d);
  omgivelser.bakke.visible = true;
  plassering.position.set(0, 0, 0); plassering.rotation.set(0, 0, 0); plassering.scale.setScalar(1);
  ar.hitKilde = null; arRing.visible = false;
}
const _a = new THREE.Vector3(), _b = new THREE.Vector3();
function arStyr(dt, ramme) {
  const kam = renderer.xr.getCamera();
  // Første gang: rett foran deg, litt under øyehøyde, vendt med nesa mot venstre (sett fra siden).
  if (!ar.plassert) {
    kam.getWorldPosition(_a); kam.getWorldDirection(_b); _b.y = 0; _b.normalize();
    ar.anker.copy(_a).addScaledVector(_b, 1.1); ar.anker.y = Math.max(0.5, _a.y - 0.75);
    ar.yaw = Math.atan2(_b.x, _b.z) + Math.PI / 2;
    ar.plassert = true;
  }
  // Ringen der du ser på en flate (bord eller gulv).
  arRing.visible = false;
  if (ar.hitKilde && ramme) {
    const treff = ramme.getHitTestResults(ar.hitKilde)[0];
    const ref = renderer.xr.getReferenceSpace();
    const pose = treff?.getPose(ref);
    if (pose) { arRing.position.set(pose.transform.position.x, pose.transform.position.y, pose.transform.position.z); arRing.visible = true; }
  }
  // Stikkene: venstre opp/ned = størrelse, høyre sideveis = snu, høyre opp/ned = høyde.
  const okt = renderer.xr.getSession();
  for (const kilde of okt?.inputSources || []) {
    const gp = kilde.gamepad;
    if (!gp || gp.axes.length < 4) continue;
    const ax = Math.abs(gp.axes[2]) > 0.15 ? gp.axes[2] : 0, ay = Math.abs(gp.axes[3]) > 0.15 ? gp.axes[3] : 0;
    if (kilde.handedness === 'left' && ay) ar.skala = THREE.MathUtils.clamp(ar.skala * Math.exp(-ay * dt * 1.2), 1 / 200, 1);
    if (kilde.handedness === 'right') { ar.yaw -= ax * dt * 1.5; ar.anker.y -= ay * dt * 0.6; }
  }
  // Grepknappen: én hånd flytter, to hender zoomer (avstand) og roterer (vinkel mellom hendene).
  const holdt = [...ar.grep.entries()].filter(([c]) => c.userData.grep);
  if (holdt.length >= 2) {
    const [p, q] = holdt.map(([c]) => c.getWorldPosition(new THREE.Vector3()));
    const avst = p.distanceTo(q), vinkel = Math.atan2(q.x - p.x, q.z - p.z), midt = p.clone().add(q).multiplyScalar(0.5);
    if (ar.tohand) {
      ar.skala = THREE.MathUtils.clamp(ar.skala * (avst / ar.tohand.avst), 1 / 200, 1);
      ar.yaw += vinkel - ar.tohand.vinkel;
      ar.anker.add(midt.clone().sub(ar.tohand.midt));
    }
    ar.tohand = { avst, vinkel, midt };
  } else {
    ar.tohand = null;
    for (const [c, forrige] of holdt) {
      c.getWorldPosition(_a);
      ar.anker.add(_a.clone().sub(forrige));
      forrige.copy(_a);
    }
  }
  arOppdaterPlassering();
}

renderer.xr.addEventListener('sessionstart', () => {
  const okt = renderer.xr.getSession();
  xrKamera.add(lytter);
  // Quest i AR: «alpha-blend» (passthrough); VR: «opaque».
  if (okt.environmentBlendMode && okt.environmentBlendMode !== 'opaque') startAR(okt);
  else tavleSprite.visible = true;
});
renderer.xr.addEventListener('sessionend', () => { tavleSprite.visible = false; peker.visible = false; kamera.add(lytter); if (arModus) stoppAR(); });

/* ---------- Løkka ---------- */
const klokke = new THREE.Clock();
let statusT = 0;
renderer.setAnimationLoop(() => {
  const dt = Math.min(0.1, klokke.getDelta());
  const t = klokke.elapsedTime;
  omgivelser.oppdater(dt);
  const lys = omgivelser.lysTick(dt);
  settYtre(lys.ytre);
  settCockpitLys(lys.cockpit);
  flytilstand.tick(dt);
  kabin?.cockpit.tick(flytilstand, t);
  KABIN.value += (kabinLysMaal - KABIN.value) * Math.min(1, dt * 0.45); // rolig opp- og nedtoning (~5 s)
  // Lysrampa: varm når kabinen er lys, blå stemningsbelysning når den er dempet.
  const dempet = Math.min(1, Math.max(0, (0.75 - KABIN.value) / 0.3)); // blått stemningslys bare ved kraftig demping
  kabin?.lysrampe.color.setRGB(0.62 + 0.38 * lys.kabin - 0.35 * dempet, 0.55 + 0.35 * lys.kabin - 0.2 * dempet, 0.45 + 0.2 * lys.kabin + 0.45 * dempet);
  if (kabin) {
    // Gulvstripene gløder mer jo mørkere kabinen er; lysskjæret fra rampa har rampas farge.
    kabin.nodGlod.opacity = 0.12 + (1 - KABIN.value) * 0.9;
    kabin.veggSkjaer.color.copy(kabin.lysrampe.color);
    kabin.veggSkjaer.opacity = 0.1 + dempet * 0.35;
  }
  if (skrog) {
    skrog.lysTick(t);
    // Landingslys under ~3000 ft og på bakken (taxilys).
    const lav = omgivelser.paaBakken ? 0.7 : Math.max(0, 1 - omgivelser.agl / 900);
    skrog.effektTick(lav);
  }
  if (skrog) skrog.hjul.visible = omgivelser.paaBakken || omgivelser.agl < 250;
  if (kabin?.vogn.visible && kabin.vognMaal != null) {
    kabin.vogn.position.z += (kabin.vognMaal - kabin.vogn.position.z) * Math.min(1, dt * 0.8);
  }
  // Turbulens (!turbulens fra moderator): hele flyet rister.
  const turb = kabinData && kabinData.lasteromInfo.turbulens > folk.naa();
  fly.rotation.set(turb ? Math.sin(t * 7.3) * 0.012 : 0, 0, turb ? Math.sin(t * 5.1) * 0.02 : 0);
  fly.position.y = turb ? Math.sin(t * 9.7) * 0.06 : 0;
  fly.updateMatrixWorld();
  klipp.copy(KLIPP_FLY).applyMatrix4(fly.matrixWorld);
  folk.tick(dt, t);
  lasterom?.tick(t);
  if (renderer.xr.isPresenting) { if (arModus) arStyr(dt, renderer.xr.getFrame()); else vrFlytt(dt); }
  else { tastFlytt(dt); flyttKamera(dt); folgTick(); orbit.update(); }
  if ((statusT += dt) > 1) { statusT = 0; visStatus(); oppdaterListe(); }
  renderer.render(scene, renderer.xr.isPresenting ? xrKamera : kamera);
});
