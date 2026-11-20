import * as THREE from 'three';
import { halvBredde } from './cabin.js';
import { logoLerret } from './textures.js';

// Lasterommet under kabingulvet med TrasMaTech Express-pakkene (!board express, !bank, !rist,
// !kjeks, !klistremerke). Synlig gjennom åpningen på venstre side av skroget.

const GULV = -1.0;
const TAK = -0.06;
const STR = 0.42; // pakkestørrelse

function pakkeTekstur(navn, sporing, merker, wifi) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#b98a55'; x.fillRect(0, 0, 256, 256);
  x.fillStyle = 'rgba(0,0,0,0.08)'; for (let i = 0; i < 256; i += 6) x.fillRect(0, i, 256, 2);
  x.fillStyle = '#d9b47c'; x.fillRect(112, 0, 32, 256); // tape
  x.fillStyle = '#fff'; x.fillRect(16, 150, 224, 92);
  x.drawImage(logoLerret(56, '#0b1d4d'), 22, 156, 56, 56);
  x.fillStyle = '#0b1d4d'; x.font = '700 26px system-ui, sans-serif';
  x.fillText(navn, 84, 186, 150);
  x.font = '22px ui-monospace, monospace';
  x.fillText(sporing, 84, 218, 150);
  if (wifi) { x.font = '40px system-ui'; x.fillText('📶', 190, 50); }
  // Klistremerkene som runde, fargede merker øverst.
  const farger = ['#e74c3c', '#f1c40f', '#2ecc71', '#9b59b6', '#3498db', '#e67e22', '#1abc9c', '#ecf0f1'];
  merker.forEach((m, i) => {
    const mx = 30 + (i % 4) * 52, my = 30 + Math.floor(i / 4) * 52;
    x.fillStyle = farger[i % farger.length];
    x.beginPath(); x.arc(mx, my, 22, 0, 7); x.fill();
    x.fillStyle = '#111'; x.font = '700 13px system-ui'; x.textAlign = 'center';
    x.fillText(m.no.slice(0, 6), mx, my + 5);
    x.textAlign = 'left';
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const kjeksGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.015, 16);
const kjeksMat = new THREE.MeshStandardMaterial({ color: 0xc58b3d, roughness: 0.9 });

export class Lasterom {
  constructor(layout) {
    this.gruppe = new THREE.Group();
    this.layout = layout;
    this.pakker = new Map();
    this.plasser = [];
    const mat = new THREE.MeshStandardMaterial({ color: 0x6d7380, roughness: 0.9, side: THREE.DoubleSide });
    const nett = new THREE.MeshStandardMaterial({ color: 0x2e3440, roughness: 0.8, wireframe: true });
    for (const [z0, z1] of layout.lasterom) {
      if (z1 - z0 < 1) continue;
      const lengde = z1 - z0, mz = (z0 + z1) / 2;
      const b = halvBredde(GULV) * 2;
      const gulv = new THREE.Mesh(new THREE.PlaneGeometry(b, lengde), mat);
      gulv.rotation.x = -Math.PI / 2; gulv.position.set(0, GULV, mz); gulv.receiveShadow = true;
      const tak = new THREE.Mesh(new THREE.PlaneGeometry(halvBredde(TAK) * 2, lengde), mat);
      tak.rotation.x = Math.PI / 2; tak.position.set(0, TAK, mz);
      this.gruppe.add(gulv, tak);
      for (const z of [z0, z1]) {
        const vegg = new THREE.Mesh(new THREE.PlaneGeometry(b + 0.6, TAK - GULV), mat);
        vegg.position.set(0, (GULV + TAK) / 2, z);
        const sikring = new THREE.Mesh(new THREE.PlaneGeometry(b, (TAK - GULV) * 0.9, 8, 6), nett);
        sikring.position.set(0, (GULV + TAK) / 2, z + (z === z0 ? 0.02 : -0.02));
        this.gruppe.add(vegg, sikring);
      }
      // Plasser til pakker: to i bredden, langs hele rommet.
      for (let z = z0 + 0.35; z < z1 - 0.3; z += 0.55) for (const x of [-0.25, 0.3]) this.plasser.push(new THREE.Vector3(x, GULV + STR / 2, z));
    }
    // Konsertlys (!konsert): fargede lamper i taket. Ikke ekte lyskilder, så kabinen over ikke farges.
    this.lys = [0xff3bd4, 0x3bd4ff, 0xffe03b, 0x7bff3b].map((f, i) => {
      const [z0, z1] = layout.lasterom[0];
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), new THREE.MeshBasicMaterial({ color: f }));
      l.position.set(-0.2 + (i % 2) * 0.4, TAK - 0.08, z0 + ((z1 - z0) * (i + 1)) / 5);
      l.visible = false;
      this.gruppe.add(l);
      return l;
    });
  }

  /** Synk pakkene med dataene. naa = botens klokke nå (ms). */
  oppdater(liste, info, naa) {
    const brukt = new Set();
    liste.slice(0, this.plasser.length).forEach((p, i) => {
      brukt.add(p.sporing);
      let k = this.pakker.get(p.sporing);
      const nokkel = `${p.navn}|${p.merker.map((m) => m.no).join(',')}|${p.wifi}|${p.kjeks}`;
      if (!k || k.nokkel !== nokkel) {
        if (k) this.fjern(p.sporing);
        const mat = new THREE.MeshStandardMaterial({ map: pakkeTekstur(p.navn, p.sporing, p.merker, p.wifi), roughness: 0.85 });
        const boks = new THREE.Mesh(new THREE.BoxGeometry(STR, STR, STR * 0.9), mat);
        boks.castShadow = boks.receiveShadow = true;
        const g = new THREE.Group();
        g.add(boks);
        for (let j = 0; j < Math.min(p.kjeks, 6); j++) {
          const kj = new THREE.Mesh(kjeksGeo, kjeksMat);
          kj.position.set(-0.12 + (j % 3) * 0.12, STR / 2 + 0.01 + Math.floor(j / 3) * 0.016, -0.06 + Math.floor(j / 3) * 0.1);
          g.add(kj);
        }
        k = { g, mat, nokkel };
        this.pakker.set(p.sporing, k);
        this.gruppe.add(g);
      }
      k.plass = this.plasser[i];
      k.bank = p.bank > naa;
      k.rist = p.rist > naa;
    });
    for (const s of [...this.pakker.keys()]) if (!brukt.has(s)) this.fjern(s);
    this.konsert = info.konsert > naa;
  }

  tick(t) {
    for (const k of this.pakker.values()) {
      if (!k.plass) continue;
      k.g.position.copy(k.plass);
      k.g.rotation.set(0, 0, 0);
      if (k.rist) { k.g.rotation.set(Math.sin(t * 40) * 0.12, Math.sin(t * 33) * 0.1, Math.cos(t * 37) * 0.12); k.g.position.y += Math.abs(Math.sin(t * 25)) * 0.05; }
      else if (k.bank) k.g.position.x += Math.max(0, Math.sin(t * 18)) * 0.03; // det banker fra innsiden
    }
    this.lys.forEach((l, i) => { l.visible = this.konsert && Math.sin(t * 8 + i * 1.7) > -0.2; });
    // Under konserten blinker pakkene i farger.
    for (const [i, k] of [...this.pakker.values()].entries()) {
      if (this.konsert) k.mat.emissive.setHSL((t * 0.5 + i * 0.13) % 1, 1, 0.25 + 0.15 * Math.sin(t * 9 + i));
      else k.mat.emissive.setRGB(0, 0, 0);
    }
  }

  fjern(s) {
    const k = this.pakker.get(s);
    if (!k) return;
    this.gruppe.remove(k.g);
    k.mat.map.dispose(); k.mat.dispose();
    k.g.children[0].geometry.dispose();
    this.pakker.delete(s);
  }
}
