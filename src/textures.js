import * as THREE from 'three';

// Prosedyriske teksturer tegnet på canvas: ingen bildefiler å laste, og alt kan justeres i kode.

function lerret(w, h, tegn) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  tegn(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

function stoy(x, w, h, styrke, frø = 1) {
  let s = frø;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const d = x.getImageData(0, 0, w, h);
  for (let i = 0; i < d.data.length; i += 4) {
    const n = (rnd() - 0.5) * styrke;
    d.data[i] += n; d.data[i + 1] += n; d.data[i + 2] += n;
  }
  x.putImageData(d, 0, 0);
}

/** Setestoff: vevd mørkeblått med et diskret rutemønster. */
export const seteStoff = () => lerret(256, 256, (x, w, h) => {
  x.fillStyle = '#1f3270'; x.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 2) { x.fillStyle = y % 4 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.06)'; x.fillRect(0, y, w, 1); }
  for (let i = 0; i < w; i += 2) { x.fillStyle = 'rgba(0,0,0,0.04)'; x.fillRect(i, 0, 1, h); }
  x.strokeStyle = 'rgba(120,150,230,0.12)'; x.lineWidth = 2;
  for (let i = 0; i <= w; i += 64) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, h); x.stroke(); x.beginPath(); x.moveTo(0, i); x.lineTo(w, i); x.stroke(); }
  stoy(x, w, h, 14, 3);
});

/** Nakkestøttetrekk: hvitt med blå stripe og logoen. */
export const nakkeTrekk = () => lerret(256, 256, (x, w, h) => {
  x.fillStyle = '#efede8'; x.fillRect(0, 0, w, h);
  x.fillStyle = '#1f5be0'; x.fillRect(0, h * 0.8, w, h * 0.1);
  stoy(x, w, h, 10, 5);
  x.drawImage(logoLerret(110, '#0b1d4d'), w / 2 - 55, h * 0.22, 110, 110);
});

/** Kabinteppe: mørk blågrå med små lilla prikker. */
export const teppe = () => lerret(256, 256, (x, w, h) => {
  x.fillStyle = '#2a3142'; x.fillRect(0, 0, w, h);
  stoy(x, w, h, 26, 7);
  x.fillStyle = 'rgba(140,100,255,0.35)';
  for (let yy = 8; yy < h; yy += 32) for (let xx = (yy / 32) % 2 ? 24 : 8; xx < w; xx += 32) { x.beginPath(); x.arc(xx, yy, 2.2, 0, 7); x.fill(); }
});

/** Bysse: stålfronter med skuffer og håndtak. */
export const bysseFront = () => lerret(256, 256, (x, w, h) => {
  x.fillStyle = '#b9bec6'; x.fillRect(0, 0, w, h);
  x.strokeStyle = '#7d838c'; x.lineWidth = 3;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) x.strokeRect(6 + j * 125, 6 + i * 62, 119, 56);
  x.fillStyle = '#4b5058';
  for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) x.fillRect(46 + j * 125, 30 + i * 62, 40, 6);
  stoy(x, w, h, 8, 11);
});

/** Tekst på flykroppen. */
export const tittel = (tekst, farge = '#6b1fff') => {
  const t = lerret(1024, 192, (x, w, h) => {
    x.clearRect(0, 0, w, h);
    x.fillStyle = farge;
    x.font = 'italic 800 150px system-ui, sans-serif';
    x.textBaseline = 'middle';
    x.fillText(tekst, 20, h / 2, w - 40);
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
};

/** Halefinne: lilla med stor «T». */
export const finne = () => {
  const t = lerret(512, 512, (x, w, h) => {
    const g = x.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#7b33ff'); g.addColorStop(1, '#3d0fa3');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.fillStyle = '#ffffff';
    x.font = 'italic 900 300px system-ui, sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('T', w * 0.5, h * 0.52);
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
};

/* ---------- TrasMaTech-logoen ---------- */

// Merket fra kanalens profilbilde: en trekant delt i tre av buede kanaler som møtes i midten.
// Geometrien er målt fra profilbildet (600×600): topp (300,80), bunn (90/512,445), midtpunkt (300,318).
export const TMT_BLAA = '#1f5be0';
export const TMT_MARINE = '#0b1d4d';

/** Tegner logoen på et eget lerret (gjennomsiktig rundt), størrelse px × px. */
export function logoLerret(px, farge = '#ffffff') {
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const x = c.getContext('2d');
  const s = px / 600;
  const P = (a, b) => [a * s, b * s];
  const V0 = P(300, 80), V1 = P(512, 445), V2 = P(90, 445), M = P(300, 318);
  x.fillStyle = farge;
  x.beginPath(); x.moveTo(...V0); x.lineTo(...V1); x.lineTo(...V2); x.closePath(); x.fill();
  // Tre kanaler fra et punkt på hver kant inn til midten, alle bøyd samme vei (rotasjonssymmetri).
  const paa = (A, B, f) => [A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f];
  x.globalCompositeOperation = 'destination-out';
  x.lineWidth = 19 * s;
  x.lineCap = 'butt';
  for (const P0 of [paa(V0, V2, 0.29), paa(V1, V0, 0.34), paa(V2, V1, 0.32)]) {
    const dx = M[0] - P0[0], dy = M[1] - P0[1];
    const l = Math.hypot(dx, dy);
    const ux = dx / l, uy = dy / l;
    const k = [(P0[0] + M[0]) / 2 + uy * -0.25 * l * -1, (P0[1] + M[1]) / 2 - ux * 0.25 * l];
    const start = [P0[0] - ux * 12 * s, P0[1] - uy * 12 * s];
    x.beginPath(); x.moveTo(...start); x.quadraticCurveTo(...k, ...M); x.stroke();
  }
  return c;
}

/** Logo + «TrasMaTech» side om side, til flykroppen. */
export const logoNavn = (farge = TMT_MARINE) => {
  const t = lerret(1280, 220, (x, w, h) => {
    x.clearRect(0, 0, w, h);
    x.drawImage(logoLerret(220, farge), 0, -6, 220, 220);
    x.fillStyle = farge;
    x.font = '800 150px system-ui, sans-serif';
    x.textBaseline = 'middle';
    x.fillText('TrasMaTech', 240, h / 2 + 8, w - 250);
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
};

/** Bare merket, til motorer, pledd og pute. */
export const logoTekstur = (farge, bakgrunn) => {
  const t = lerret(256, 256, (x, w, h) => {
    if (bakgrunn) { x.fillStyle = bakgrunn; x.fillRect(0, 0, w, h); } else x.clearRect(0, 0, w, h);
    x.drawImage(logoLerret(200, farge), 28, 34, 200, 200);
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
};

/** Reserve for halefinnen hvis profilbildet ikke kan lastes: stjernehimmel med hvit logo. */
export const romLogo = () => {
  const t = lerret(600, 600, (x, w, h) => {
    x.fillStyle = '#05070f'; x.fillRect(0, 0, w, h);
    const g = x.createLinearGradient(120, 0, 520, 600);
    g.addColorStop(0, 'rgba(30,80,220,0)'); g.addColorStop(0.45, 'rgba(30,80,220,0.75)'); g.addColorStop(0.6, 'rgba(30,80,220,0)');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    let s = 9; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 220; i++) { x.fillStyle = `hsla(${rnd() * 360},70%,80%,${0.4 + rnd() * 0.6})`; x.fillRect(rnd() * w, rnd() * h, 2, 2); }
    x.drawImage(logoLerret(600, '#ffffff'), 0, 0);
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
};


/* ---------- Byssa ---------- */

/** Under benken: trallebåser med traller (endepanel, håndtak, bremsepedal og lås). Én bås per 0,32 m. */
export const byssaTraller = () => lerret(256, 256, (x, w, h) => {
  x.fillStyle = '#2c3036'; x.fillRect(0, 0, w, h); // mørk bås
  x.fillStyle = '#b4bac2'; x.fillRect(10, 14, w - 20, h - 30); // trallens endepanel
  x.fillStyle = 'rgba(0,0,0,0.12)'; for (let i = 0; i < 6; i++) x.fillRect(10, 40 + i * 34, w - 20, 2);
  x.fillStyle = '#7d848d'; x.fillRect(30, 24, w - 60, 12); // håndtak
  x.fillStyle = '#d23a2a'; x.fillRect(w / 2 - 14, 54, 28, 16); // lås
  x.fillStyle = '#1f5be0'; x.fillRect(w / 2 - 50, 110, 100, 26); // TMT-merke
  x.fillStyle = '#fff'; x.font = '700 18px system-ui'; x.textAlign = 'center'; x.fillText('TMT', w / 2, 129);
  x.fillStyle = '#c0392b'; x.fillRect(22, h - 30, 40, 12); // brems
  x.fillStyle = '#27ae60'; x.fillRect(w - 62, h - 30, 40, 12);
  x.fillStyle = '#15181c'; x.fillRect(0, h - 14, w, 14);
});

/** Over benken: ovner med vindu, kaffemaskin og standardbokser med røde låser. */
export const byssaOvn = () => lerret(512, 256, (x, w, h) => {
  x.fillStyle = '#c4c9d0'; x.fillRect(0, 0, w, h);
  // To ovner.
  for (const ox of [8, 136]) {
    x.fillStyle = '#9aa1aa'; x.fillRect(ox, 8, 120, 150);
    x.fillStyle = '#16191e'; x.fillRect(ox + 12, 24, 96, 90); // vindu
    x.fillStyle = 'rgba(255,170,80,0.18)'; x.fillRect(ox + 12, 24, 96, 90);
    x.fillStyle = '#5b626b'; x.fillRect(ox + 20, 124, 80, 10); // håndtak
    x.fillStyle = '#0d0f12'; x.fillRect(ox + 40, 140, 40, 10); // display
    x.fillStyle = '#3cf06e'; x.fillRect(ox + 44, 142, 18, 6);
  }
  // Kaffemaskin.
  x.fillStyle = '#25282d'; x.fillRect(266, 8, 100, 150);
  x.fillStyle = '#0e1013'; x.fillRect(282, 60, 68, 70);
  x.fillStyle = '#e74c3c'; x.beginPath(); x.arc(300, 30, 6, 0, 7); x.fill();
  x.fillStyle = '#2ecc71'; x.beginPath(); x.arc(320, 30, 6, 0, 7); x.fill();
  // Standardbokser (2 × 3) med røde låser.
  for (let r = 0; r < 3; r++) for (let k = 0; k < 2; k++) {
    const bx = 376 + k * 66, by = 8 + r * 50;
    x.fillStyle = '#d6dadf'; x.fillRect(bx, by, 60, 44);
    x.strokeStyle = '#8a9099'; x.lineWidth = 2; x.strokeRect(bx, by, 60, 44);
    x.fillStyle = '#c0392b'; x.fillRect(bx + 24, by + 18, 12, 8);
  }
  x.fillStyle = '#8a9099'; x.fillRect(0, 166, w, 4);
  // Nederste rad: skuffer.
  for (let i = 0; i < 8; i++) { x.fillStyle = '#b7bcc4'; x.fillRect(4 + i * 63, 176, 58, 70); x.fillStyle = '#5b626b'; x.fillRect(20 + i * 63, 204, 26, 6); }
});


/* ---------- Glød (lyseffekter) ---------- */
/** Myk glød: 'rund' (fra midten og ut) eller 'ned' (sterk øverst, fader nedover) eller 'kjegle' (fra spissen). */
export function glodTekstur(form = 'rund') {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  let g;
  if (form === 'ned') { g = x.createLinearGradient(0, 0, 0, 128); g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.3, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)'); }
  else if (form === 'kjegle') { g = x.createLinearGradient(0, 128, 0, 0); g.addColorStop(0, 'rgba(255,255,255,0.85)'); g.addColorStop(0.25, 'rgba(255,255,255,0.3)'); g.addColorStop(1, 'rgba(255,255,255,0)'); }
  else { g = x.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.35, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)'); }
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  if (form === 'kjegle') { // smalner mot spissen (nederst)
    x.globalCompositeOperation = 'destination-in';
    const s = x.createLinearGradient(0, 0, 128, 0);
    s.addColorStop(0, 'rgba(0,0,0,0)'); s.addColorStop(0.5, 'rgba(0,0,0,1)'); s.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = s; x.fillRect(0, 0, 128, 128);
  }
  return new THREE.CanvasTexture(c);
}
export const glodMat = (form, farge, opacity) => new THREE.MeshBasicMaterial({
  map: glodTekstur(form), color: farge, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, fog: false,
});
