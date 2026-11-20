import * as THREE from 'three';

// Cockpitskjermene i en 737NG, tegnet på canvas og oppdatert fra live-dataene:
// PFD (horisont, fart, høyde, kurs, FMA), ND (kompass og SimBrief-ruta), øvre og nedre EICAS,
// CDU (PROGRESS-siden) og MCP-vinduene på glareshielden.
// Krengning og stigning finnes ikke i dataene; de avledes av kurs- og høydeendringene.

const GRONN = '#3cf06e', MAGENTA = '#ff4dff', CYAN = '#4ee8ff', HVIT = '#f2f2f2', GUL = '#ffd23a', RAV = '#ffb000';
const FONT = (px, vekt = 600) => `${vekt} ${px}px "DejaVu Sans Mono", ui-monospace, monospace`;

function skjerm(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return { c, x: c.getContext('2d'), tex };
}

const tekst = (x, t, px, py, farge = HVIT, str = 18, just = 'left') => {
  x.fillStyle = farge; x.font = FONT(str); x.textAlign = just; x.textBaseline = 'middle'; x.fillText(t, px, py);
};

/** Flytilstanden instrumentene viser. Oppdateres fra kart- og kabindataene. */
export class Flytilstand {
  constructor() {
    Object.assign(this, { ias: 0, gs: 0, alt: 0, hdg: 0, vs: 0, pitch: 0, bank: 0, n1: 22, lat: null, lon: null,
      rute: { dep: null, arr: null, fix: [] }, dep: '', arr: '', callsign: '', fase: '', etaTs: 0, igjenNm: null, bakken: true });
    this.forrige = null;
  }

  sett(kart, kabin) {
    const naa = performance.now();
    if (this.forrige) {
      const dt = (naa - this.forrige.t) / 1000;
      if (dt > 0.5) {
        const vs = ((kart.altFt - this.forrige.alt) / dt) * 60;
        this.vs += (THREE.MathUtils.clamp(vs, -6000, 6000) - this.vs) * 0.5;
        let dh = kart.hdg - this.forrige.hdg; dh = ((dh + 540) % 360) - 180;
        this.svingRate = dh / dt; // grader per sekund
      }
    }
    this.forrige = { t: naa, alt: kart.altFt, hdg: kart.hdg };
    this.alt = kart.altFt;
    this.gs = kart.gsKt;
    this.hdg = kart.hdg;
    this.bakken = kart.bakken !== false && kart.gsKt < 60;
    this.ias = Math.max(0, kart.gsKt / (1 + 0.02 * Math.max(0, kart.altFt) / 1000)); // grovt: IAS ≈ TAS minus høydeøkningen, uten vind
    this.lat = kart.lat; this.lon = kart.lon;
    this.rute = kart.rute || this.rute;
    this.etaTs = kart.etaTs; this.igjenNm = kart.igjenNm;
    this.callsign = kart.callsign || kabin?.fly.callsign || '';
    this.dep = kart.dep || kabin?.fly.dep || ''; this.arr = kart.arr || kabin?.fly.arr || '';
    this.fase = (kabin?.fly.fase || kart.fase || '').toUpperCase();
    // N1 etter fasen (det finnes ingen motordata).
    const f = this.fase;
    this.n1 = this.bakken ? (this.gs > 5 ? 28 : 21) : f.includes('CLIMB') || f.includes('TAKEOFF') ? (this.alt < 2000 ? 95 : 89)
      : f.includes('DESC') || f.includes('APPR') ? 42 : this.vs < -500 ? 40 : 84;
  }

  /** Mykt mot målene hvert bilde, så instrumentene ikke hopper. */
  tick(dt) {
    const a = Math.min(1, dt * 2);
    const maalPitch = this.bakken ? 0 : 2.5 + THREE.MathUtils.clamp(this.vs / 1000, -3, 4) * 1.6;
    const maalBank = this.bakken ? 0 : THREE.MathUtils.clamp((this.svingRate || 0) * 9, -25, 25);
    this.pitch += (maalPitch - this.pitch) * a;
    this.bank += (maalBank - this.bank) * a;
  }

  /** Valgt høyde i MCP: marsjhøyde i lufta, 0 på bakken. */
  get valgtAlt() { return this.bakken ? 0 : this.vs > 300 ? Math.ceil((this.alt + 4000) / 1000) * 1000 : this.vs < -300 ? Math.max(3000, Math.floor((this.alt - 6000) / 1000) * 1000) : Math.round(this.alt / 100) * 100; }

  get fma() {
    if (this.bakken) return ['', this.gs > 5 ? 'TAXI' : '', ''];
    if (this.vs > 300) return ['N1', 'LNAV', 'VNAV SPD'];
    if (this.vs < -300) return ['SPD', 'LNAV', 'VNAV PTH'];
    return ['SPD', 'LNAV', 'VNAV PTH'];
  }
}

/* ---------- PFD ---------- */
function tegnPFD(x, w, h, s) {
  x.fillStyle = '#000'; x.fillRect(0, 0, w, h);
  const cx = w * 0.5, cy = h * 0.5;
  const ppg = 6; // piksler per grad stigning
  // Kunstig horisont, klippet til et rektangel.
  x.save();
  x.beginPath(); x.rect(cx - 95, cy - 110, 190, 220); x.clip();
  x.translate(cx, cy); x.rotate((-s.bank * Math.PI) / 180); x.translate(0, s.pitch * ppg);
  x.fillStyle = '#2f7bd6'; x.fillRect(-400, -800, 800, 800);
  x.fillStyle = '#8a5a2b'; x.fillRect(-400, 0, 800, 800);
  x.strokeStyle = HVIT; x.lineWidth = 2;
  x.beginPath(); x.moveTo(-400, 0); x.lineTo(400, 0); x.stroke();
  for (let p = -20; p <= 20; p += 2.5) {
    if (!p) continue;
    const lang = p % 10 === 0 ? 40 : p % 5 === 0 ? 24 : 10;
    x.beginPath(); x.moveTo(-lang, -p * ppg); x.lineTo(lang, -p * ppg); x.stroke();
    if (p % 10 === 0) { tekst(x, String(Math.abs(p)), -lang - 14, -p * ppg, HVIT, 12, 'center'); tekst(x, String(Math.abs(p)), lang + 14, -p * ppg, HVIT, 12, 'center'); }
  }
  x.restore();
  // Flysymbolet.
  x.strokeStyle = '#000'; x.fillStyle = '#000'; x.lineWidth = 7;
  x.beginPath(); x.moveTo(cx - 60, cy); x.lineTo(cx - 22, cy); x.lineTo(cx - 22, cy + 10); x.stroke();
  x.beginPath(); x.moveTo(cx + 60, cy); x.lineTo(cx + 22, cy); x.lineTo(cx + 22, cy + 10); x.stroke();
  x.strokeStyle = HVIT; x.lineWidth = 3;
  x.beginPath(); x.moveTo(cx - 60, cy); x.lineTo(cx - 22, cy); x.lineTo(cx - 22, cy + 10); x.stroke();
  x.beginPath(); x.moveTo(cx + 60, cy); x.lineTo(cx + 22, cy); x.lineTo(cx + 22, cy + 10); x.stroke();
  x.fillStyle = '#000'; x.fillRect(cx - 5, cy - 5, 10, 10); x.strokeRect(cx - 5, cy - 5, 10, 10);
  // Krengningsskala øverst.
  x.strokeStyle = HVIT; x.lineWidth = 2;
  x.beginPath(); x.arc(cx, cy, 100, Math.PI * 1.25, Math.PI * 1.75); x.stroke();
  for (const g of [-30, -20, -10, 0, 10, 20, 30]) {
    const v = ((g - 90) * Math.PI) / 180;
    x.beginPath(); x.moveTo(cx + Math.cos(v) * 100, cy + Math.sin(v) * 100); x.lineTo(cx + Math.cos(v) * (g % 30 ? 92 : 88), cy + Math.sin(v) * (g % 30 ? 92 : 88)); x.stroke();
  }
  const bv = ((-s.bank - 90) * Math.PI) / 180;
  x.fillStyle = HVIT; x.beginPath();
  x.moveTo(cx + Math.cos(bv) * 99, cy + Math.sin(bv) * 99);
  x.lineTo(cx + Math.cos(bv + 0.06) * 86, cy + Math.sin(bv + 0.06) * 86);
  x.lineTo(cx + Math.cos(bv - 0.06) * 86, cy + Math.sin(bv - 0.06) * 86); x.fill();
  // Fartstapen (venstre) og høydetapen (høyre).
  const tape = (x0, verdi, steg, enhet, rull, fmt) => {
    x.fillStyle = 'rgba(80,90,105,0.9)'; x.fillRect(x0, cy - 120, 62, 240);
    x.save(); x.beginPath(); x.rect(x0, cy - 120, 62, 240); x.clip();
    const forste = Math.floor((verdi - rull) / steg) * steg;
    for (let v = forste; v < verdi + rull; v += steg) {
      if (v < 0) continue;
      const y = cy - ((v - verdi) / rull) * 120;
      x.strokeStyle = HVIT; x.lineWidth = 2;
      x.beginPath(); x.moveTo(x0 + (enhet === 'kt' ? 52 : 0), y); x.lineTo(x0 + (enhet === 'kt' ? 62 : 10), y); x.stroke();
      if (v % (steg * 2) === 0) tekst(x, fmt(v), x0 + 31, y, HVIT, 15, 'center');
    }
    x.restore();
    x.fillStyle = '#000'; x.fillRect(x0 - 2, cy - 15, 66, 30);
    x.strokeStyle = HVIT; x.lineWidth = 2; x.strokeRect(x0 - 2, cy - 15, 66, 30);
    tekst(x, fmt(Math.round(verdi)), x0 + 31, cy, HVIT, 19, 'center');
  };
  tape(8, s.ias, 10, 'kt', 80, (v) => String(v));
  tape(w - 70, s.alt, 100, 'ft', 600, (v) => String(Math.round(v / 10) * 10));
  tekst(x, `${Math.round(s.gs)} GS`, 40, cy + 145, HVIT, 14, 'center');
  tekst(x, String(s.valgtAlt), w - 39, cy - 140, MAGENTA, 15, 'center');
  // V/S-viser.
  const vsY = cy - THREE.MathUtils.clamp(s.vs / 4000, -1, 1) * 70;
  x.strokeStyle = HVIT; x.lineWidth = 2;
  x.beginPath(); x.moveTo(w - 4, cy); x.lineTo(w - 4, vsY); x.stroke();
  if (Math.abs(s.vs) > 400) tekst(x, String(Math.round(s.vs / 50) * 50), w - 38, s.vs > 0 ? cy - 135 + 270 : cy + 140, HVIT, 12, 'center');
  // Kursbåndet nederst.
  x.fillStyle = 'rgba(80,90,105,0.9)'; x.fillRect(cx - 90, h - 34, 180, 30);
  x.save(); x.beginPath(); x.rect(cx - 90, h - 34, 180, 30); x.clip();
  for (let d = Math.floor(s.hdg / 5) * 5 - 30; d <= s.hdg + 30; d += 5) {
    const px = cx + (d - s.hdg) * 3;
    x.strokeStyle = HVIT; x.beginPath(); x.moveTo(px, h - 34); x.lineTo(px, h - 34 + (d % 10 ? 6 : 10)); x.stroke();
    if (d % 10 === 0) tekst(x, String(((d % 360) + 360) % 360 / 10 | 0).padStart(2, '0'), px, h - 14, HVIT, 12, 'center');
  }
  x.restore();
  tekst(x, String(Math.round(((s.hdg % 360) + 360) % 360)).padStart(3, '0'), cx, h - 46, HVIT, 15, 'center');
  // FMA øverst.
  const fma = s.fma;
  x.fillStyle = '#000'; x.fillRect(0, 0, w, 26);
  fma.forEach((t, i) => { tekst(x, t, w * (0.2 + i * 0.3), 14, GRONN, 14, 'center'); });
  x.strokeStyle = HVIT; x.lineWidth = 1;
  for (const i of [1, 2]) { x.beginPath(); x.moveTo(w * (0.05 + i * 0.3), 2); x.lineTo(w * (0.05 + i * 0.3), 24); x.stroke(); }
  if (!s.bakken) tekst(x, 'CMD', cx, 42, GRONN, 14, 'center');
}

/* ---------- ND ---------- */
function tegnND(x, w, h, s) {
  x.fillStyle = '#000'; x.fillRect(0, 0, w, h);
  const cx = w / 2, cy = h * 0.78, r = h * 0.62;
  const rekkevidde = 40; // NM til buen
  // Kompassbuen (kurs opp).
  x.strokeStyle = HVIT; x.lineWidth = 2;
  x.beginPath(); x.arc(cx, cy, r, Math.PI * 1.17, Math.PI * 1.83); x.stroke();
  for (let d = 0; d < 360; d += 5) {
    const rel = ((d - s.hdg + 540) % 360) - 180;
    if (Math.abs(rel) > 60) continue;
    const v = ((rel - 90) * Math.PI) / 180;
    const l = d % 10 ? 7 : 12;
    x.beginPath(); x.moveTo(cx + Math.cos(v) * r, cy + Math.sin(v) * r); x.lineTo(cx + Math.cos(v) * (r - l), cy + Math.sin(v) * (r - l)); x.stroke();
    if (d % 30 === 0) tekst(x, String(d / 10), cx + Math.cos(v) * (r - 24), cy + Math.sin(v) * (r - 24), HVIT, 14, 'center');
  }
  x.setLineDash([6, 6]); x.beginPath(); x.arc(cx, cy, r / 2, Math.PI * 1.17, Math.PI * 1.83); x.stroke(); x.setLineDash([]);
  tekst(x, String(rekkevidde / 2), cx - r / 2 * 0.86 - 12, cy - r / 2 * 0.5, HVIT, 11, 'center');
  // Ruta i magenta (lat/lon → NM, rotert så kursen peker opp).
  if (s.lat != null && s.lon != null) {
    const pkt = [s.rute.dep, ...s.rute.fix, s.rute.arr].filter(Boolean);
    const til = ([la, lo]) => {
      const dy = (la - s.lat) * 60, dx = (lo - s.lon) * 60 * Math.cos((s.lat * Math.PI) / 180);
      const a = (-s.hdg * Math.PI) / 180;
      const rx = dx * Math.cos(a) - dy * Math.sin(a), ry = dx * Math.sin(a) + dy * Math.cos(a);
      return [cx + (rx / rekkevidde) * r, cy - (ry / rekkevidde) * r];
    };
    x.save(); x.beginPath(); x.rect(0, 30, w, cy - 10); x.clip();
    x.strokeStyle = MAGENTA; x.lineWidth = 3;
    x.beginPath(); pkt.forEach((p, i) => { const [px, py] = til(p); if (i) x.lineTo(px, py); else x.moveTo(px, py); }); x.stroke();
    pkt.forEach((p, i) => {
      const [px, py] = til(p);
      x.strokeStyle = i === 0 || i === pkt.length - 1 ? CYAN : MAGENTA; x.lineWidth = 2;
      x.beginPath(); x.moveTo(px, py - 6); x.lineTo(px + 6, py); x.lineTo(px, py + 6); x.lineTo(px - 6, py); x.closePath(); x.stroke();
    });
    const [ax, ay] = s.rute.arr ? til(s.rute.arr) : [-99, -99];
    tekst(x, s.arr, ax + 10, ay - 10, CYAN, 13);
    x.restore();
  }
  // Flysymbolet.
  x.strokeStyle = HVIT; x.lineWidth = 3;
  x.beginPath(); x.moveTo(cx, cy - 14); x.lineTo(cx, cy + 16); x.moveTo(cx - 12, cy); x.lineTo(cx + 12, cy); x.moveTo(cx - 6, cy + 14); x.lineTo(cx + 6, cy + 14); x.stroke();
  // Topplinje: GS, TAS, kurs; høyre: neste punkt og avstand.
  tekst(x, `GS ${Math.round(s.gs)}`, 10, 16, HVIT, 14);
  tekst(x, `TAS ${Math.round(s.gs)}`, 10, 34, HVIT, 12);
  x.fillStyle = '#000'; x.fillRect(cx - 34, 4, 68, 24); x.strokeStyle = HVIT; x.lineWidth = 2; x.strokeRect(cx - 34, 4, 68, 24);
  tekst(x, String(Math.round(((s.hdg % 360) + 360) % 360)).padStart(3, '0'), cx, 16, HVIT, 16, 'center');
  tekst(x, 'TRK MAG', cx + 50, 16, GRONN, 11);
  tekst(x, s.arr || '----', w - 10, 16, MAGENTA, 14, 'right');
  if (s.igjenNm != null) tekst(x, `${Math.round(s.igjenNm)} NM`, w - 10, 34, HVIT, 12, 'right');
  if (s.etaTs > Date.now()) tekst(x, new Date(s.etaTs).toISOString().slice(11, 16) + 'z', w - 10, 50, HVIT, 12, 'right');
}

/* ---------- EICAS ---------- */
function urskive(x, cx, cy, r, verdi, maks, etikett, fmt, rod = 0.98) {
  const fra = Math.PI * 0.75, spenn = Math.PI * 1.25;
  x.strokeStyle = HVIT; x.lineWidth = 2;
  x.beginPath(); x.arc(cx, cy, r, fra, fra + spenn * rod); x.stroke();
  x.strokeStyle = '#ff3b30'; x.beginPath(); x.arc(cx, cy, r, fra + spenn * rod, fra + spenn); x.stroke();
  const v = fra + spenn * Math.min(1, verdi / maks);
  x.fillStyle = 'rgba(120,130,140,0.5)';
  x.beginPath(); x.moveTo(cx, cy); x.arc(cx, cy, r - 2, fra, v); x.closePath(); x.fill();
  x.strokeStyle = HVIT; x.lineWidth = 3;
  x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + Math.cos(v) * r, cy + Math.sin(v) * r); x.stroke();
  x.strokeStyle = HVIT; x.lineWidth = 1.5; x.strokeRect(cx + 4, cy - r - 4, 58, 22);
  tekst(x, fmt(verdi), cx + 58, cy - r + 7, HVIT, 16, 'right');
  tekst(x, etikett, cx, cy + r + 12, CYAN, 12, 'center');
}

function tegnEICAS(x, w, h, s, tid) {
  x.fillStyle = '#000'; x.fillRect(0, 0, w, h);
  const n1 = s.n1 + Math.sin(tid * 0.7) * 0.3;
  const egt = 350 + s.n1 * 5.2;
  for (const [i, cx] of [[0, w * 0.27], [1, w * 0.73]]) {
    urskive(x, cx, h * 0.27, 44, n1 + i * 0.2, 110, 'N1', (v) => v.toFixed(1));
    urskive(x, cx, h * 0.66, 38, egt + i * 4, 1000, 'EGT', (v) => String(Math.round(v)), 0.95);
  }
  tekst(x, 'TAT ' + (s.alt > 20000 ? '-28c' : '+12c'), 10, 14, CYAN, 13);
  tekst(x, s.bakken ? 'TO' : s.vs > 300 ? 'CLB' : 'CRZ', w - 10, 14, GRONN, 14, 'right');
  tekst(x, 'FUEL', w / 2, h - 34, CYAN, 12, 'center');
  tekst(x, `${(5.2 - (s.igjenNm != null ? 0 : 0)).toFixed(1)}  ${(8.4).toFixed(1)}  ${(5.2).toFixed(1)}`, w / 2, h - 16, HVIT, 14, 'center');
}

function tegnNedre(x, w, h, s) {
  x.fillStyle = '#000'; x.fillRect(0, 0, w, h);
  const n2 = s.n1 * 0.92 + 8, ff = s.bakken ? 0.35 : s.n1 > 85 ? 2.9 : s.n1 > 70 ? 1.2 : 0.6;
  for (const [i, cx] of [[0, w * 0.27], [1, w * 0.73]]) {
    urskive(x, cx, h * 0.3, 38, n2 + i * 0.3, 110, 'N2', (v) => v.toFixed(1));
    tekst(x, 'FF', cx - 30, h * 0.62, CYAN, 12);
    tekst(x, (ff + i * 0.02).toFixed(2), cx + 30, h * 0.62, HVIT, 15, 'right');
    tekst(x, 'OIL P', cx - 30, h * 0.75, CYAN, 12);
    tekst(x, String(Math.round(30 + s.n1 * 0.4)), cx + 30, h * 0.75, HVIT, 15, 'right');
    tekst(x, 'VIB', cx - 30, h * 0.88, CYAN, 12);
    tekst(x, '0.4', cx + 30, h * 0.88, HVIT, 15, 'right');
  }
}

/* ---------- CDU (PROGRESS) ---------- */
function tegnCDU(x, w, h, s) {
  x.fillStyle = '#05060a'; x.fillRect(0, 0, w, h);
  tekst(x, 'ACT PROGRESS', w / 2, 16, HVIT, 15, 'center');
  tekst(x, '1/4', w - 8, 16, HVIT, 12, 'right');
  const rad = (i, v, venstre, hoyre, farge = HVIT) => {
    tekst(x, v, 8, 36 + i * 34, HVIT, 11);
    tekst(x, venstre, 8, 52 + i * 34, farge, 15);
    if (hoyre) tekst(x, hoyre, w - 8, 52 + i * 34, farge, 15, 'right');
  };
  const eta = s.etaTs > Date.now() ? new Date(s.etaTs).toISOString().slice(11, 15) + 'z' : '----z';
  rad(0, 'FROM', s.dep || '----', s.callsign || '');
  rad(1, 'DEST', s.arr || '----', `${s.igjenNm != null ? Math.round(s.igjenNm) : '---'} ${eta}`, MAGENTA);
  rad(2, 'ALT  /  GS', `${s.bakken ? 'GND' : 'FL' + String(Math.round(s.alt / 100)).padStart(3, '0')}`, `${Math.round(s.gs)}KT`);
  rad(3, 'POS', s.lat != null ? `N${s.lat.toFixed(2)} E${s.lon.toFixed(2)}` : '---', '');
  tekst(x, '<POS REPORT', 8, h - 14, HVIT, 13);
  tekst(x, 'POS REF>', w - 8, h - 14, HVIT, 13, 'right');
}

/* ---------- MCP ---------- */
function tegnMCP(x, w, h, s) {
  x.fillStyle = '#2b2f36'; x.fillRect(0, 0, w, h);
  const vindu = (cx, etikett, verdi, bredde = 70) => {
    tekst(x, etikett, cx, 12, HVIT, 10, 'center');
    x.fillStyle = '#000'; x.fillRect(cx - bredde / 2, 22, bredde, 26);
    tekst(x, verdi, cx, 36, RAV, 18, 'center');
  };
  const knapp = (cx, cy, t, paa) => {
    x.fillStyle = '#1b1e23'; x.fillRect(cx - 24, cy - 10, 48, 20);
    x.fillStyle = paa ? GRONN : '#555'; x.fillRect(cx - 18, cy - 9, 36, 3);
    tekst(x, t, cx, cy + 3, HVIT, 9, 'center');
  };
  vindu(w * 0.05, 'COURSE', String(Math.round(s.hdg)).padStart(3, '0'), 54);
  vindu(w * 0.2, 'IAS/MACH', s.alt > 26000 ? (s.gs / 600).toFixed(3).slice(1) : String(Math.round(Math.max(s.ias, 100))));
  vindu(w * 0.42, 'HEADING', String(Math.round(s.hdg)).padStart(3, '0'), 54);
  vindu(w * 0.62, 'ALTITUDE', String(s.valgtAlt).padStart(5, ' '), 80);
  vindu(w * 0.8, 'VERT SPEED', Math.abs(s.vs) > 200 ? String(Math.round(s.vs / 100) * 100) : '', 72);
  vindu(w * 0.95, 'COURSE', String(Math.round(s.hdg)).padStart(3, '0'), 54);
  const luft = !s.bakken;
  [['N1', luft && s.vs > 300], ['SPEED', luft && s.vs <= 300], ['VNAV', luft], ['LNAV', luft], ['HDG SEL', false], ['ALT HLD', false], ['V/S', false], ['CMD A', luft]]
    .forEach(([t, paa], i) => knapp(w * (0.1 + i * 0.115), h - 16, t, paa));
}

/** Alle skjermene. tegn(s, tid) oppdaterer dem (ikke hvert bilde – canvas er dyrt). */
export class Skjermer {
  constructor() {
    this.pfd = skjerm(320, 320);
    this.nd = skjerm(320, 320);
    this.eicas = skjerm(320, 320);
    this.nedre = skjerm(320, 320);
    this.cdu = skjerm(320, 256);
    this.mcp = skjerm(1024, 96);
  }

  tegn(s, tid) {
    tegnPFD(this.pfd.x, 320, 320, s);
    tegnND(this.nd.x, 320, 320, s);
    tegnEICAS(this.eicas.x, 320, 320, s, tid);
    tegnNedre(this.nedre.x, 320, 320, s);
    tegnCDU(this.cdu.x, 320, 256, s);
    tegnMCP(this.mcp.x, 1024, 96, s);
    for (const k of ['pfd', 'nd', 'eicas', 'nedre', 'cdu', 'mcp']) this[k].tex.needsUpdate = true;
  }
}
