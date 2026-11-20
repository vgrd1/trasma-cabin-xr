import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// Det nøytrale rommet rundt flyet: mørk bakgrunn, et rutenett som «bakke» med skygge, og lys.
// Når flyet er i lufta synker bakken og glir bakover i bakkefarten, så man ser at vi flyr.

const FT = 0.3048;
const KT = 0.514444;
const RUTE = 4; // meter per rute i rutenettet
const MAKS_SENK = 40; // så langt ned bakken går i marsjhøyde (m)

// Dag, kveld og natt. Lyset i scenen er det samme hele døgnet, så kabinen alltid er godt opplyst;
// det er bare det utvendige som dempes: bakgrunn, rutenett og flyets utside (ytre). kabin = lysrampa.
const LYS = { himmel: 0xfff4e2, bakke: 0x3a4250, hemi: 1.1, sol: 2.4, env: 0.55 };
export const TIDER = {
  dag: { ...LYS, bak: 0x6f8199, nett: 0.75, solFarge: 0xfff1dc, ytre: 1, kabin: 0, cockpit: 0.6 },
  kveld: { ...LYS, bak: 0x1e1828, nett: 0.4, solFarge: 0xffe2c4, ytre: 0.14, kabin: 0.75, cockpit: 0.36 },
  natt: { ...LYS, bak: 0x05070c, nett: 0.22, solFarge: 0xfff1dc, ytre: 0.045, kabin: 1, cockpit: 0.24 },
};

/** Solhøyden (grader) på et sted nå, nok til å skille dag, skumring og natt. */
export function solhoyde(lat, lon, dato = new Date()) {
  const r = Math.PI / 180;
  const start = Date.UTC(dato.getUTCFullYear(), 0, 0);
  const dag = (dato - start) / 864e5;
  const dekl = -23.44 * Math.cos((2 * Math.PI / 365) * (dag + 10));
  const timer = dato.getUTCHours() + dato.getUTCMinutes() / 60;
  const timevinkel = 15 * (timer + lon / 15 - 12);
  return Math.asin(Math.sin(lat * r) * Math.sin(dekl * r) + Math.cos(lat * r) * Math.cos(dekl * r) * Math.cos(timevinkel * r)) / r;
}

export class Omgivelser {
  constructor(scene, renderer, { bakkeY, skygger }) {
    this.bakkeY = bakkeY;
    scene.background = new THREE.Color(0x14171d);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.55;

    this.scene = scene;
    this.hemi = new THREE.HemisphereLight(0xfff4e2, 0x2a2f3a, 1.1);
    scene.add(this.hemi);
    this.sol = new THREE.DirectionalLight(0xfff1dc, 2.4);
    this.sol.position.set(9, 26, 6);
    this.sol.target.position.set(0, 0, 10);
    scene.add(this.sol, this.sol.target);
    if (skygger) {
      this.sol.castShadow = true;
      this.sol.shadow.mapSize.set(2048, 2048);
      const c = this.sol.shadow.camera;
      c.left = -20; c.right = 20; c.top = 28; c.bottom = -28; c.near = 1; c.far = 80;
      this.sol.shadow.bias = -0.0004;
      this.sol.shadow.normalBias = 0.02;
    }

    this.bakke = new THREE.Group();
    const rutenett = new THREE.GridHelper(400, 400 / RUTE, 0x3b4252, 0x262b35);
    rutenett.material.transparent = true;
    rutenett.material.opacity = 0.7;
    const fanger = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.ShadowMaterial({ opacity: 0.45 }));
    fanger.rotation.x = -Math.PI / 2;
    fanger.position.y = 0.01;
    fanger.receiveShadow = true;
    this.rutenett = rutenett;
    this.bakke.add(rutenett, fanger);
    this.bakke.position.y = bakkeY;
    scene.add(this.bakke);

    this.agl = 0;
    this.maalAgl = 0;
    this.gs = 0;
    this.strekning = 0;
    this.bakkeRef = null;
    this.paaBakken = true;
    const F = ['bak', 'himmel', 'bakke', 'solFarge'];
    this.lys = { ...TIDER.dag }; // nåværende (glir mot målet); fargene som flyttall så de ikke stopper halvveis
    for (const k of F) this.lys[k] = new THREE.Color(TIDER.dag[k]);
    this.maalLys = TIDER.dag;
  }

  /** Velg dag, kveld eller natt. Overgangen tar et par sekunder. */
  settTid(navn) { this.maalLys = TIDER[navn] || TIDER.dag; }

  _c = new THREE.Color();

  /** Kalles hvert bilde: blander lysene mot målet og returnerer gjeldende verdier. */
  lysTick(dt) {
    const a = Math.min(1, dt * 1.5);
    const L = this.lys, M = this.maalLys;
    for (const k of ['nett', 'hemi', 'sol', 'env', 'ytre', 'kabin', 'cockpit']) L[k] += (M[k] - L[k]) * a;
    for (const k of ['bak', 'himmel', 'bakke', 'solFarge']) L[k].lerp(this._c.setHex(M[k]), a);
    if (this.scene.background) this.scene.background.copy(L.bak); // null i AR (passthrough)
    this.hemi.color.copy(L.himmel); this.hemi.groundColor.copy(L.bakke); this.hemi.intensity = L.hemi;
    this.sol.color.copy(L.solFarge); this.sol.intensity = L.sol;
    this.scene.environmentIntensity = L.env;
    this.rutenett.material.opacity = L.nett;
    return L;
  }

  /** Nye kartdata: regn ut høyde over bakken (alt er over havet). */
  sett(kart) {
    if (!kart) return;
    const paaBakken = kart.bakken === true || (kart.bakken === null && kart.gsKt < 45 && (this.bakkeRef === null || kart.altFt - this.bakkeRef < 100));
    if (paaBakken) this.bakkeRef = kart.altFt;
    this.paaBakken = paaBakken;
    this.maalAgl = paaBakken ? 0 : Math.max(0, (kart.altFt - (this.bakkeRef ?? 0)) * FT);
    this.gs = kart.gsKt * KT;
  }

  oppdater(dt) {
    this.agl += (this.maalAgl - this.agl) * Math.min(1, dt * 0.6);
    this.strekning += this.gs * dt;
    // Logaritmisk senking: de første hundre metrene synes godt, marsjhøyde gir MAKS_SENK.
    const senk = MAKS_SENK * Math.min(1, Math.log10(1 + this.agl) / Math.log10(1 + 11000));
    this.bakke.position.y = this.bakkeY - senk;
    this.rutenett.position.z = this.strekning % RUTE;
  }
}
