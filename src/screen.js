import * as THREE from 'three';

// Infotavla over flyet (og på venstre hånd i VR): turen, fasen og tallene fra cockpiten.

export class Infotavle {
  constructor() {
    this.c = document.createElement('canvas');
    this.c.width = 1024; this.c.height = 640;
    this.tex = new THREE.CanvasTexture(this.c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    this.tegn(null, null, 'Kobler til …');
  }

  tegn(kabin, kart, melding, hjorne) {
    const x = this.c.getContext('2d');
    const W = 1024, H = 640;
    const bg = x.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#1b1036'); bg.addColorStop(1, '#0b0d18');
    x.fillStyle = bg; x.fillRect(0, 0, W, H);
    x.fillStyle = '#6b1fff'; x.fillRect(0, 0, W, 10);
    x.textBaseline = 'alphabetic';

    x.fillStyle = '#b9a6ff';
    x.font = '600 30px system-ui, sans-serif';
    x.fillText('TrasMaTech · B737 home cockpit', 48, 70);
    if (hjorne) { x.textAlign = 'right'; x.fillText(hjorne, W - 48, 70); x.textAlign = 'left'; }

    if (!kabin) {
      x.fillStyle = '#fff'; x.font = '600 56px system-ui, sans-serif';
      x.fillText(melding || 'Venter på data …', 48, 330);
      this.tex.needsUpdate = true;
      return;
    }
    const f = kabin.fly;
    x.fillStyle = '#fff';
    x.font = '700 92px system-ui, sans-serif';
    x.fillText(`${f.dep || '----'}  ✈  ${f.arr || '----'}`, 48, 180);
    x.fillStyle = '#cfd6e6';
    x.font = '34px system-ui, sans-serif';
    x.fillText(`${f.depNavn || ''} → ${f.arrNavn || ''}`, 48, 232, W - 96);
    x.fillStyle = '#ffd36b';
    x.font = '600 44px system-ui, sans-serif';
    x.fillText(`${f.callsign || ''}  ·  ${f.faseTekst?.no || f.fase || ''}`, 48, 306, W - 96);

    const felt = [];
    if (kart) {
      felt.push(['Høyde', `${Math.round(kart.altFt).toLocaleString('no')} ft`]);
      felt.push(['Fart', `${Math.round(kart.gsKt)} kt`]);
      if (kart.etaTs > Date.now()) felt.push(['Lander', new Date(kart.etaTs).toLocaleTimeString('no', { hour: '2-digit', minute: '2-digit' })]);
      else if (kart.igjenNm) felt.push(['Igjen', `${Math.round(kart.igjenNm)} NM`]);
    }
    felt.push(['Om bord', String(kabin.pax.length)]);
    const bw = (W - 96) / felt.length;
    felt.forEach(([k, v], i) => {
      const fx = 48 + i * bw;
      x.fillStyle = '#8f98ad'; x.font = '30px system-ui, sans-serif'; x.fillText(k, fx, 400);
      x.fillStyle = '#fff'; x.font = '600 52px system-ui, sans-serif'; x.fillText(v, fx, 462, bw - 16);
    });

    const merker = [
      [kabin.belte === 'on', 'Fest setebeltet'],
      [kabin.servering === 'open', 'Servering åpen'],
      [kabin.gate === 'open', 'Gaten er åpen – !board'],
    ];
    let mx = 48;
    x.font = '600 32px system-ui, sans-serif';
    for (const [paa, t] of merker) {
      if (!paa) continue;
      const w = x.measureText(t).width + 40;
      x.fillStyle = '#6b1fff'; x.beginPath(); x.roundRect(mx, 520, w, 60, 30); x.fill();
      x.fillStyle = '#fff'; x.fillText(t, mx + 20, 562);
      mx += w + 16;
    }
    if (!kabin.aktiv) { x.fillStyle = '#ff9a6b'; x.font = '32px system-ui, sans-serif'; x.fillText('Flyfunksjonene er av – vi flyr ikke på streamen nå', 48, 610); }
    else if (kart && !kart.live) { x.fillStyle = '#8f98ad'; x.font = '28px system-ui, sans-serif'; x.fillText('Kartet er ikke live akkurat nå', 48, 615); }
    this.tex.needsUpdate = true;
  }
}
