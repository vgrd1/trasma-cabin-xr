import * as THREE from 'three';

// Kabinlyden: de samme lydfilene og hendelsene som live-kabinen på trasmabot.trasma.tech, men spilt i 3D
// fra der det skjer i flyet (hosting fra setet, vogna i midtgangen, spyling på toalettet).
//
// Tilstanden (lyd-objektet fra live.php) sammenlignes med forrige gang: nye passasjerer, belter, ringeknapp,
// aktiviteter og belteskiltet gir lyd. Hendelsene (seerne sine !host, !klapp … og servering) spilles når de kommer.
// Volumene per gruppe følger det crew har stilt inn. Dataene er allerede forsinket like mye som streamen.

// Hvilken gruppe hver lyd hører til (samme grupper som crew stiller volum på).
const GRUPPE = {
  host: 'folk', kremt: 'folk', nys: 'folk', gjesp: 'folk', sukk: 'folk', snufs: 'folk', sete: 'folk', klapp: 'folk',
  snork: 'aktivitet', side: 'aktivitet', 'belte-pa': 'aktivitet', 'belte-av': 'aktivitet', spyl: 'aktivitet',
  dor: 'aktivitet', 'hylle-lukk': 'aktivitet', 'hylle-apne': 'aktivitet',
  'vogn-rull': 'servering', flaske: 'servering', skjenk: 'servering', boks: 'servering', glass: 'servering',
  brett: 'servering', pose: 'servering', betal: 'servering',
  'ding-ring': 'signal', 'ding-skilt': 'signal', kabinsus: 'sus', 'prat-loop': 'prat',
};
const gruppeAv = (k) => GRUPPE[k] || (k.startsWith('lekk-musikk') ? 'musikk' : k.startsWith('lekk-') ? 'film' : 'folk');
// Grupper crew ikke har egen glidebryter for.
const FAST = { signal: 85, sus: 60 };
const kategori = (n) => { const b = n.replace(/\.[a-z0-9]+$/, ''); const m = b.match(/^(.*)-(\d+)$/); return m ? m[1] : b; };
// Samme volumkurve som boten: 0–100 over 60 dB.
const forsterk = (v) => (v <= 0 ? 0 : Math.pow(10, ((Math.min(100, v) - 100) * 60) / 100 / 20));
const rnd = (a, b) => a + Math.random() * (b - a);

export class Kabinlyd {
  /**
   * lytter: THREE.AudioListener. sted(sete) → Vector3 i verden for et sete (eller null).
   * steder: { foran: () => Vector3, toalett: (sete) => Vector3, vogn: () => Vector3 | null }
   */
  constructor(lytter, sted, steder) {
    this.lytter = lytter;
    this.sted = sted;
    this.steder = steder;
    this.paa = false;
    this.master = 0.8;
    this.filer = {}; // navn → versjon
    this.perKategori = {};
    this.buffere = new Map();
    this.laster = new Map();
    this.sist = {}; // kategori → sist valgte fil (unngå samme to ganger på rad)
    this.forrige = null; // forrige lyd-tilstand
    this.sett = new Set(); // hendelser som er spilt (nr|t)
    this.paaFra = 0;
    this.scene = null;
    this.sus = null; // kabinsus-løkka
    this.vognLyd = null;
    this.lekker = new Map(); // sete → neste tid for lekkasje fra øretelefoner/film
  }

  festTil(scene) { this.scene = scene; }

  /** Slå lyden på (må skje i et brukertrykk) eller av. */
  async settPaa(paa) {
    this.paa = paa;
    const ctx = this.lytter.context;
    if (paa) {
      await ctx.resume();
      this.paaFra = Date.now();
      this.lytter.setMasterVolume(this.master);
      if (this.L) this.startLokker();
    } else {
      this.stoppLokker();
      await ctx.suspend();
    }
  }

  settVolum(v) { this.master = v; this.lytter.setMasterVolume(v); }

  /* ---------- Filene ---------- */
  async hentListe(sett) {
    if (!sett || sett === this.listeSett || this.henter) return;
    this.henter = true;
    try {
      const j = await (await fetch(`/kabinlyd/lyder.json?v=${encodeURIComponent(sett)}`)).json();
      this.filer = {};
      this.perKategori = {};
      for (const f of j.lyder || []) {
        if (typeof f?.f !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*\.(mp3|ogg|wav)$/.test(f.f)) continue;
        this.filer[f.f] = typeof f.v === 'string' && /^[0-9a-f]{1,16}$/.test(f.v) ? f.v : '';
        (this.perKategori[kategori(f.f)] ??= []).push(f.f);
      }
      this.listeSett = sett;
      this.buffere.clear();
      if (this.paa) this.startLokker();
    } catch { /* prøv igjen ved neste oppdatering */ }
    this.henter = false;
  }

  buffer(navn) {
    if (this.buffere.has(navn)) return Promise.resolve(this.buffere.get(navn));
    if (this.laster.has(navn)) return this.laster.get(navn);
    const p = fetch(`/kabinlyd/${navn}${this.filer[navn] ? `?v=${this.filer[navn]}` : ''}`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status))))
      .then((b) => this.lytter.context.decodeAudioData(b))
      .then((buf) => { this.buffere.set(navn, buf); this.laster.delete(navn); return buf; })
      .catch((e) => { this.laster.delete(navn); throw e; });
    this.laster.set(navn, p);
    return p;
  }

  velg(kat) {
    const liste = this.perKategori[kat];
    if (!liste?.length) return null;
    let n = liste[Math.floor(Math.random() * liste.length)];
    if (liste.length > 1 && n === this.sist[kat]) n = liste[(liste.indexOf(n) + 1) % liste.length];
    this.sist[kat] = n;
    return n;
  }

  volum(gruppe) {
    if (this.L?.laast?.includes(gruppe)) return 0;
    const v = gruppe in FAST ? FAST[gruppe] : this.L?.grupper?.[gruppe];
    return forsterk(v ?? 0);
  }

  /**
   * Spill en lyd. o: { pos (Vector3) | sete, om (sekunder til start), styrke, lokke, fra (sek inn i fila), varighet }.
   * Returnerer et håndtak med stopp(), eller null.
   */
  spill(kat, o = {}) {
    if (!this.paa || !this.scene) return null;
    const gruppe = o.gruppe || gruppeAv(kat);
    const vol = this.volum(gruppe) * (o.styrke ?? 1);
    if (vol <= 0.001) return null;
    const navn = this.velg(kat);
    if (!navn) return null;
    const pos = o.pos || (o.sete && this.sted(o.sete));
    const lyd = pos ? new THREE.PositionalAudio(this.lytter) : new THREE.Audio(this.lytter);
    if (pos) {
      lyd.setRefDistance(1.6);
      lyd.setRolloffFactor(0.45);
      lyd.setDistanceModel('inverse');
      lyd.panner.panningModel = 'HRTF';
      lyd.position.copy(pos);
    }
    lyd.setVolume(vol);
    this.scene.add(lyd);
    const handtak = {
      lyd,
      stopp: (fade = 0.2) => {
        try {
          const g = lyd.gain.gain, t = lyd.context.currentTime;
          g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(0, t + fade);
          setTimeout(() => { try { lyd.stop(); } catch { /* stoppet */ } this.scene.remove(lyd); }, fade * 1000 + 50);
        } catch { /* allerede borte */ }
      },
    };
    this.buffer(navn).then((buf) => {
      lyd.setBuffer(buf);
      lyd.setLoop(!!o.lokke);
      if (o.fra) lyd.offset = Math.min(o.fra, Math.max(0, buf.duration - 1));
      if (o.varighet) lyd.duration = o.varighet;
      lyd.onEnded = () => { lyd.isPlaying = false; this.scene.remove(lyd); };
      lyd.play((o.om || 0));
      if (o.varighet && !o.lokke) setTimeout(() => handtak.stopp(0.8), ((o.om || 0) + o.varighet) * 1000);
    }).catch(() => this.scene.remove(lyd));
    return handtak;
  }

  /* ---------- Løkkene: kabinsus og vogna ---------- */
  startLokker() {
    if (!this.sus && this.perKategori.kabinsus) this.sus = this.spill('kabinsus', { lokke: true, styrke: this.L?.luft ? 1 : 0.55 });
  }
  stoppLokker() {
    this.sus?.stopp(0.3); this.sus = null;
    this.vognLyd?.stopp(0.3); this.vognLyd = null;
  }

  /* ---------- Hver oppdatering fra boten ---------- */
  data(l) {
    if (!l) return;
    if (l.filer) this.hentListe(l.filer);
    const forrige = this.forrige;
    this.L = l;
    this.forrige = l;
    if (!this.paa || !l.aktiv) { if (!l.aktiv) this.stoppLokker(); return; }
    if (!this.sus) this.startLokker();
    else this.sus.lyd.setVolume(this.volum('sus') * (l.luft ? 1 : 0.55));
    if (forrige) this.forskjell(forrige, l);
    // Hendelsene: seerne sine lyder og servering. Bare de som skjedde etter at lyden ble slått på.
    for (const e of l.hendelser) {
      const k = `${e.nr}|${e.t}`;
      if (this.sett.has(k)) continue;
      this.sett.add(k);
      if (e.t < this.paaFra - 15000) continue;
      if (e.type === 'lyd') this.hendelse(e);
      else if (e.type === 'servert') this.servert(e);
    }
    if (this.sett.size > 500) this.sett = new Set([...this.sett].slice(-200));
  }

  forskjell(a, b) {
    const for_ = new Map(a.pax.map((p) => [p.s, p]));
    const naa = new Map(b.pax.map((p) => [p.s, p]));
    for (const [s, p] of naa) {
      const o = for_.get(s);
      if (!o) { // gått om bord: bagasjehylla opp og igjen, så setter seg
        const d = rnd(0, 4);
        this.spill('hylle-apne', { sete: s, om: d });
        this.spill('hylle-lukk', { sete: s, om: d + rnd(2.5, 5) });
        this.spill('sete', { sete: s, om: d + rnd(6, 8) });
        continue;
      }
      if (o.a !== p.a) this.aktivitet(s, o.a, p.a, b.skilt === 'on');
      if (o.l !== p.l) this.spill(p.l ? 'belte-av' : 'belte-pa', { sete: s, om: p.l ? 0 : rnd(0.2, 5) });
      if (p.r && !o.r) this.spill('ding-ring', { sete: s });
    }
    for (const [s] of for_) {
      if (naa.has(s)) continue;
      const d = rnd(0, 3);
      this.spill('sete', { sete: s, om: d });
      this.spill('hylle-apne', { sete: s, om: d + rnd(1.5, 3) });
    }
    if (a.skilt && b.skilt && a.skilt !== b.skilt) {
      this.spill('ding-skilt', { pos: this.steder.foran() });
      if (b.skilt === 'on') for (const [s] of naa) if (Math.random() < 0.35) this.spill('belte-pa', { sete: s, om: rnd(1, 7), styrke: 0.7 });
    }
  }

  aktivitet(s, fra, til, skilt) {
    if ((til === 'do' || til === 'strekk') && fra !== 'do' && fra !== 'strekk' && !(skilt && til === 'do')) {
      this.spill('sete', { sete: s });
      if (til === 'do') this.spill('dor', { pos: this.steder.toalett(s), om: rnd(5, 8) });
      if (til === 'strekk' && Math.random() < 0.5) this.spill('sukk', { sete: s, om: rnd(1, 3) });
    }
    if (fra === 'do' && til !== 'do') {
      const p = this.steder.toalett(s);
      this.spill('spyl', { pos: p, varighet: 3.5 });
      this.spill('dor', { pos: p, om: rnd(2.2, 3.2) });
      this.spill('sete', { sete: s, om: rnd(6, 9) });
    }
    if (fra === 'strekk' && til !== 'strekk') this.spill('sete', { sete: s, om: rnd(0, 2) });
    if (fra === 'sove' && til !== 'sove' && Math.random() < 0.5) this.spill('sukk', { sete: s, om: rnd(0.3, 2) });
    if (til === 'bok') this.spill('side', { sete: s, om: rnd(1, 4) });
  }

  hendelse(e) {
    const gruppe = ['host', 'kremt', 'nys', 'gjesp', 'sukk', 'snufs', 'snork', 'klapp'].includes(e.lyd) ? 'folk' : undefined;
    if (e.lyd.startsWith('lekk-')) { this.spill(e.lyd, { sete: e.sete, fra: rnd(0, 15), varighet: 10, gruppe }); return; }
    if (e.lyd === 'kabinsus' || e.lyd === 'prat-loop') { this.spill(e.lyd, { varighet: 8 }); return; }
    this.spill(e.lyd, { sete: e.sete, gruppe });
  }

  servert(e) {
    const seter = this.sted(e.sete);
    if (!seter) return;
    const gang = seter.clone(); gang.x *= 0.35; // fra midtgangen ved raden
    const d = 0.4;
    if (e.slag === 'drikke') {
      if (Math.random() < 0.4) this.spill('boks', { pos: gang, om: d });
      this.spill('skjenk', { pos: gang, om: d + 0.7 });
      this.spill('glass', { sete: e.sete, om: d + 3 });
    } else if (e.slag === 'mat') {
      this.spill('brett', { sete: e.sete, om: d });
      this.spill('glass', { sete: e.sete, om: d + rnd(0.8, 1.6), styrke: 0.7 });
    } else if (e.slag === 'snacks') {
      this.spill('pose', { sete: e.sete, om: d, styrke: 0.8 });
    } else if (e.slag === 'taxfree') {
      this.spill('pose', { pos: gang, om: d });
      this.spill('betal', { pos: gang, om: d + 1.4, styrke: 0.8 });
    }
  }

  /** Kalles jevnlig: vogna som ruller, og musikk/film som lekker fra øretelefoner. */
  tick() {
    if (!this.paa || !this.L?.aktiv) return;
    const vp = this.steder.vogn();
    if (vp && this.L.vogn.aktiv) {
      if (!this.vognLyd) this.vognLyd = this.spill('vogn-rull', { pos: vp, lokke: true, styrke: 0.5 });
      else this.vognLyd.lyd.position.copy(vp);
      if (Math.random() < 0.01) this.spill('flaske', { pos: vp, styrke: 0.5 });
    } else if (this.vognLyd) { this.vognLyd.stopp(0.6); this.vognLyd = null; }
    const naa = performance.now();
    for (const p of this.L.pax) {
      if (p.a !== 'musikk' && p.a !== 'film') continue;
      const neste = this.lekker.get(p.s) ?? naa + rnd(2000, 15000);
      if (naa < neste) { this.lekker.set(p.s, neste); continue; }
      const kat = p.a === 'film' ? 'lekk-film' : this.perKategori[`lekk-musikk-${p.g}`] ? `lekk-musikk-${p.g}` : 'lekk-musikk-pop';
      this.spill(kat, { sete: p.s, fra: rnd(0, 20), varighet: 10, styrke: 0.6 });
      this.lekker.set(p.s, naa + rnd(25000, 60000));
    }
  }
}
