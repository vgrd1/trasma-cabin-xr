// Henter TrasmaBots udokumenterte live-data (samme kilde som kabinen.html og kart.html på
// trasmabot.trasma.tech) og renser dem til det scenen trenger. Alt herfra er data fra en
// annen tjeneste: tall klemmes, tekst kuttes, og ukjente verdier blir trygge standardverdier.

const AKTER = ['do', 'strekk', 'sove', 'film', 'bok', 'nettbrett', 'musikk'];
const KABIN_MS = 2000; // samme takt som kabinen.html (live.php mellomlagrer selv i ~3 s)
const KART_MS = 5000;

const tekst = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const tall = (v, min, max, std) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Math.min(max, Math.max(min, Number(v))) : std);
const tospraak = (v) => (v && typeof v === 'object' ? { no: tekst(v.no, 80), en: tekst(v.en, 80) } : null);
/** Tidsstempel i ms (boten sender epoke-millisekunder), ellers 0. */
const tid = (v) => (Number.isFinite(Number(v)) && Number(v) > 1e12 && Number(v) < 1e14 ? Number(v) : 0);
const bildeUrl = (v) => (typeof v === 'string' && /^https:\/\/[^\s"'<>]+$/.test(v) ? v : '');
const PLATTFORMER = ['twitch', 'kick', 'youtube'];

export function rensKabin(d) {
  if (!d || typeof d !== 'object') return null;
  const f = d.fly && typeof d.fly === 'object' ? d.fly : {};
  const pax = [];
  for (const p of Array.isArray(d.pax) ? d.pax.slice(0, 400) : []) {
    if (!p || typeof p !== 'object') continue;
    const sete = typeof p.sete === 'string' && (/^\d{1,2}[A-Z]$/.test(p.sete) || p.sete === 'JS') ? p.sete : '';
    if (!sete) continue;
    pax.push({
      sete,
      navn: tekst(p.navn, 40) || '?',
      bilde: bildeUrl(p.bilde),
      akt: AKTER.includes(p.akt) ? p.akt : '',
      hva: tospraak(p.hva),
      ikon: tekst(p.ikon, 8),
      til: tid(p.til),
      borte: p.borte === true,
      jumpseat: p.jumpseat === true || sete === 'JS',
      doKo: tall(p.doKo, 0, 999, 0),
      // Servering: bestillinger som venter, det som ble servert, ringeknappen og betjening.
      bestilt: Array.isArray(p.bestilt) ? p.bestilt.slice(0, 12).map((o) => ({ slag: tekst(o?.slag, 10), vare: tospraak(o?.vare), klar: tid(o?.klar) })).filter((o) => o.vare?.no) : [],
      servert: p.servert && typeof p.servert === 'object' && tospraak(p.servert.vare)?.no ? { vare: tospraak(p.servert.vare), t: tid(p.servert.t) } : null,
      tilkalt: tid(p.tilkalt),
      betjenes: tid(p.betjenes),
      belteAv: p.belteAv === true,
      pledd: tid(p.pledd),
      pute: tid(p.pute),
      plattform: PLATTFORMER.includes(p.plattform) ? p.plattform : '',
      // Det passasjeren nettopp gjorde (selfie, hoste, klappe …): type, ikon og tekst fra boten.
      gjorde: p.gjorde && typeof p.gjorde === 'object' && tospraak(p.gjorde.tekst)?.no && tid(p.gjorde.t)
        ? { slag: /^[a-z_]{1,20}$/.test(p.gjorde.slag) ? p.gjorde.slag : '', ikon: tekst(p.gjorde.ikon, 8), tekst: tospraak(p.gjorde.tekst), t: tid(p.gjorde.t) } : null,
    });
  }
  // Lasterommet: TrasMaTech Express-pakkene.
  const lasterom = [];
  for (const p of Array.isArray(d.lasterom) ? d.lasterom.slice(0, 200) : []) {
    if (!p || typeof p !== 'object') continue;
    const sporing = typeof p.sporing === 'string' && /^TMX-\d{4,6}$/.test(p.sporing) ? p.sporing : '';
    if (!sporing) continue;
    lasterom.push({
      navn: tekst(p.navn, 40) || '?', bilde: bildeUrl(p.bilde), sporing,
      kjeks: tall(p.kjeks, 0, 99, 0), merker: Array.isArray(p.merker) ? p.merker.slice(0, 8).map(tospraak).filter((m) => m?.no) : [],
      bank: tid(p.bank), rist: tid(p.rist), wifi: p.wifi === true,
    });
  }
  const li = d.lasteromInfo && typeof d.lasteromInfo === 'object' ? d.lasteromInfo : {};
  const vogn = d.vogn && typeof d.vogn === 'object' ? { rad: tall(d.vogn.rad, 0, 99, 0) } : null;
  return {
    aktiv: d.aktiv === true,
    fly: {
      callsign: tekst(f.callsign, 12),
      dep: tekst(f.dep, 4), arr: tekst(f.arr, 4),
      depNavn: tekst(f.depNavn, 40), arrNavn: tekst(f.arrNavn, 40),
      type: tekst(f.type, 20),
      fase: tekst(f.fase, 30),
      faseTekst: tospraak(f.faseTekst),
    },
    flytype: tekst(d.flytype, 40),
    rader: tall(d.rader, 1, 60, 31),
    oppsett: typeof d.oppsett === 'string' && /^[A-Z]{1,4}(\|[A-Z]{1,4}){0,3}$/.test(d.oppsett) ? d.oppsett : 'ABC|DEF',
    utenRader: Array.isArray(d.utenRader) ? d.utenRader.map(Number).filter(Number.isInteger) : [],
    gate: d.gate === 'open' ? 'open' : 'closed',
    belte: d.belte === 'on' ? 'on' : 'off',
    servering: d.servering === 'open' ? 'open' : 'closed',
    vogn,
    kabinpersonale: tall(d.kabinpersonale, 0, 8, 3),
    doPlass: Array.isArray(d.doPlass) ? d.doPlass.filter((x) => ['foran', 'midt', 'bak'].includes(x)).slice(0, 6) : ['foran', 'bak', 'bak'],
    pax,
    lasterom,
    lasteromInfo: { konsert: tid(li.konsert), turbulens: tid(li.turbulens), luft: li.luft === true, maksKjeks: tall(li.maksKjeks, 0, 99, 3) },
    na: tid(d.na) || Date.now(), // botens klokke; tidsstemplene over sammenlignes med den
    // Hvor mange sekunder nettsiden forsinker lyd og beskjeder for å treffe streamen (crew stiller den inn).
    forsinkelse: tall(d.lyd?.forsinkelse ?? d.meldinger?.forsinkelse, 0, 30, 5),
    lyd: rensLyd(d.lyd),
  };
}

/** Lyd-tilstanden (samme som live-kabinen på nettsiden spiller fra): hvem gjør hva, skilt, vogn, hendelser. */
function rensLyd(l) {
  if (!l || typeof l !== 'object') return null;
  const sete = (v) => (typeof v === 'string' && /^[0-9]{1,2}[A-Z]?$/.test(v) ? v : '');
  const grupper = {};
  if (l.grupper && typeof l.grupper === 'object') for (const [g, v] of Object.entries(l.grupper)) if (/^[a-z]{2,12}$/.test(g)) grupper[g] = tall(v, 0, 100, 0);
  return {
    aktiv: l.aktiv === true,
    grupper,
    laast: Array.isArray(l.laast) ? l.laast.filter((g) => typeof g === 'string') : [],
    filer: typeof l.filer === 'string' && /^[0-9a-f]{4,32}$/.test(l.filer) ? l.filer : '',
    luft: l.luft === true,
    skilt: l.skilt === 'on' || l.skilt === 'off' ? l.skilt : '',
    mengde: tall(l.mengde, 25, 300, 100),
    vogn: l.vogn && l.vogn.aktiv === true ? { aktiv: true, rad: tall(l.vogn.rad, 0, 99, 0) } : { aktiv: false },
    pax: (Array.isArray(l.pax) ? l.pax.slice(0, 400) : []).map((p) => (p && typeof p === 'object' ? {
      s: sete(p.s), a: typeof p.a === 'string' && /^[a-z]{1,12}$/.test(p.a) ? p.a : '',
      g: typeof p.g === 'string' && /^[a-z0-9]{1,12}$/.test(p.g) ? p.g : '', l: !!p.l, r: !!p.r,
    } : null)).filter((p) => p && p.s),
    hendelser: (Array.isArray(l.hendelser) ? l.hendelser.slice(-60) : []).map((e) => (e && typeof e === 'object' && (e.type === 'lyd' || e.type === 'servert') ? {
      nr: tall(e.nr, 0, 9e15, 0), t: tid(e.t), type: e.type, sete: sete(e.sete),
      lyd: typeof e.lyd === 'string' && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(e.lyd) && e.lyd.length <= 30 ? e.lyd : '',
      slag: ['mat', 'drikke', 'snacks', 'taxfree'].includes(e.slag) ? e.slag : '',
      test: e.test === 1,
    } : null)).filter((e) => e && e.t && (e.type === 'servert' || e.lyd)),
  };
}

export function rensKart(d) {
  if (!d || typeof d !== 'object') return null;
  const f = d.fly && typeof d.fly === 'object' ? d.fly : {};
  const t = d.tur && typeof d.tur === 'object' ? d.tur : {};
  return {
    live: d.live === true,
    bakken: d.bakken === true ? true : d.bakken === false ? false : null,
    lat: tall(f.lat, -90, 90, null),
    lon: tall(f.lon, -180, 180, null),
    altFt: tall(f.alt, -2000, 60000, 0),
    gsKt: tall(f.gs, 0, 700, 0),
    hdg: tall(f.hdg, 0, 360, 0),
    etaTs: tall(t.etaTs, 0, 1e14, 0),
    callsign: tekst(t.callsign, 12), dep: tekst(t.dep, 4), arr: tekst(t.arr, 4), fase: tekst(t.fase, 30),
    // Ruta fra SimBrief: avgang, ankomst og punktene underveis ([lat, lon]).
    rute: (() => {
      const r = d.rute && typeof d.rute === 'object' ? d.rute : {};
      const pkt = (v) => (Array.isArray(v) && v.length === 2 && v.every((x) => Number.isFinite(Number(x))) ? [Number(v[0]), Number(v[1])] : null);
      return { dep: pkt(r.dep), arr: pkt(r.arr), fix: (Array.isArray(r.fix) ? r.fix.slice(0, 300) : []).map(pkt).filter(Boolean) };
    })(),
    igjenNm: tall(t.igjenNm, 0, 20000, null),
  };
}

async function hent(d) {
  const r = await fetch(`/api/live?d=${d}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`live.php ${d}: HTTP ${r.status}`);
  const j = await r.json();
  if (!j || j.ok !== true) throw new Error(`live.php ${d}: ok=false`);
  return j.data;
}

function poll(fn, ms, cb, feil) {
  let stoppet = false;
  const tick = async () => {
    try { cb(await fn()); } catch (e) { feil(e); }
    if (!stoppet) setTimeout(tick, ms);
  };
  tick();
  return () => { stoppet = true; };
}

/** Starter henting. Gir rensede data til onKabin / onKart, eller feil til onFeil. */
export function startLive({ onKabin, onKart, onFeil }) {
  const a = poll(async () => rensKabin(await hent('kabin')), KABIN_MS, onKabin, onFeil);
  const b = poll(async () => rensKart(await hent('kart')), KART_MS, onKart, onFeil);
  return () => { a(); b(); };
}

/* ---------- Demo (?demo=1): en kort tur i løkke, for å teste uten at de flyr ---------- */

// Oppdiktede navn (ingen ekte chattere).
const DEMO_NAVN = ['vindkast', 'Fjellrev', 'tekoppen', 'skylagget', 'Polarlys', 'kaptein_k', 'nordlys', 'fjordfly',
  'Mira', 'Ola_N', 'pixelpilot', 'Tuva', 'glidebane', 'kaffekopp', 'Sigrid', 'Rullebane737', 'skyhopp', 'Eira'];
const DEMO_FASER = [
  // [fase, no, en, varighet s, altFt, gsKt, belte, servering]
  ['BOARDING', 'boarding pågår', 'boarding in progress', 25, 0, 0, 'off', 'closed'],
  ['TAXI_OUT', 'taxer ut', 'taxiing out', 15, 0, 18, 'on', 'closed'],
  ['CLIMB', 'stiger', 'climbing', 30, 24000, 380, 'on', 'closed'],
  ['CRUISE', 'i marsjhøyde', 'cruising', 60, 36000, 460, 'off', 'open'],
  ['DESCENT', 'synker', 'descending', 30, 6000, 300, 'on', 'closed'],
  ['TAXI_IN', 'taxer inn', 'taxiing in', 15, 0, 15, 'on', 'closed'],
];

// Handlinger fra nettsidens kommandoer, slik boten melder dem i «gjorde» (ikon + tekst).
const DEMO_GJORDE = [
  ['selfie', '🤳', 'tok en selfie', 'took a selfie'],
  ['videosamtale', '📹', 'ringer hjem på video', 'is on a video call'],
  ['host', '😷', 'hostet', 'coughed'],
  ['nys', '🤧', 'nøs', 'sneezed'],
  ['gjesp', '🥱', 'gjespet', 'yawned'],
  ['sukk', '😮‍💨', 'sukket', 'sighed'],
  ['klapp', '👏', 'klappet', 'clapped'],
  ['snork', '😴', 'snorket', 'snored'],
  ['fartstest', '📶', 'testet Wi-Fi-farten: 42 Mbit/s', 'ran a speed test: 42 Mbit/s'],
  ['nettspill', '🎮', 'spiller nettspill', 'is playing an online game'],
  ['nyheter', '📰', 'leser nyheter', 'is reading the news'],
  ['flysporing', '🛰️', 'følger flyet på radar', 'is tracking the flight'],
  ['vindu', '🪟', 'ser ut av vinduet', 'is looking out the window'],
  ['flymodus', '✈️', 'satte telefonen i flymodus', 'put the phone in flight mode'],
];
const DEMO_VARER = [['mat', 'Pasta bolognese', 'Pasta bolognese'], ['drikke', 'Kaffe', 'Coffee'], ['snacks', 'Sjokolade', 'Chocolate'], ['taxfree', 'Parfyme', 'Perfume'], ['drikke', 'Cola', 'Cola']];

export function startDemo({ onKabin, onKart, fraFase }) {
  const sete = (i) => `${1 + ((i * 7) % 31)}${'ABCDEF'[(i * 5) % 6]}`;
  const total = DEMO_FASER.reduce((s, f) => s + f[3], 0);
  // ?demo=CRUISE starter i den fasen (med høyden den har), ellers fra boarding.
  const fi = Math.max(0, DEMO_FASER.findIndex((f) => f[0] === String(fraFase).toUpperCase()));
  const start = performance.now() - (DEMO_FASER.slice(0, fi).reduce((s, f) => s + f[3], 0) + 0.5) * 1000;
  let alt = DEMO_FASER[fi][4];
  const varig = new Map(); // sete → hendelser som skal vare en stund
  const tick = () => {
    let t = ((performance.now() - start) / 1000) % total;
    let i = 0;
    while (t > DEMO_FASER[i][3]) { t -= DEMO_FASER[i][3]; i++; }
    const [fase, no, en, varighet, maalAlt, gs, belte, servering] = DEMO_FASER[i];
    alt += (maalAlt - alt) * 0.08;
    const na = Date.now();
    const s = Math.floor(performance.now() / 1000);
    const cruise = fase === 'CRUISE';
    const pax = DEMO_NAVN.map((navn, n) => {
      const r = (n * 13 + Math.floor(s / 9)) % 23;
      const akt = cruise ? ['', 'film', 'bok', 'sove', 'musikk', 'nettbrett', '', 'do', ''][r % 9] : (r === 3 ? 'sove' : '');
      const id = sete(n);
      const v = varig.get(id) || {};
      // Hvert sekund skjer det noe nytt hos én passasjer.
      if (cruise && (s + n * 5) % DEMO_NAVN.length === 0 && v.sist !== s) {
        v.sist = s;
        const g = DEMO_GJORDE[(s + n) % DEMO_GJORDE.length];
        v.gjorde = { slag: g[0], ikon: g[1], tekst: { no: g[2], en: g[3] }, t: na };
        const x = (s + n) % 5;
        if (x === 0) v.tilkalt = na + 20000;
        if (x === 1) { const vare = DEMO_VARER[(s + n) % DEMO_VARER.length]; v.bestilt = [{ slag: vare[0], vare: { no: vare[1], en: vare[2] }, klar: na + 12000 }]; v.serveresAt = na + 12000; v.vare = vare; }
        if (x === 2) v.pledd = na + 120000;
        if (x === 3) v.pute = na + 120000;
      }
      if (v.serveresAt && na > v.serveresAt) { v.bestilt = []; v.servert = { vare: { no: v.vare[1], en: v.vare[2] }, t: v.serveresAt }; v.serveresAt = 0; }
      if (v.tilkalt && na > v.tilkalt - 10000 && na < v.tilkalt) v.betjenes = v.tilkalt + 8000;
      varig.set(id, v);
      return {
        sete: id, navn, bilde: '', akt, hva: null, ikon: '', til: 0, borte: false, jumpseat: false,
        doKo: !cruise ? 0 : (r === 11 ? 1 : r === 12 ? 2 : 0),
        bestilt: v.bestilt || [], servert: v.servert || null, tilkalt: v.tilkalt || 0, betjenes: v.betjenes || 0,
        belteAv: belte === 'on' && n % 7 === 2, pledd: v.pledd || 0, pute: v.pute || 0, plattform: ['twitch', 'kick', 'youtube'][n % 3],
        gjorde: v.gjorde || null,
      };
    });
    const lasterom = DEMO_NAVN.slice(0, 9).map((navn, n) => ({
      navn, bilde: '', sporing: `TMX-${1040 + n}`, kjeks: (n + Math.floor(s / 15)) % 4, wifi: n % 4 === 1,
      merker: n % 3 === 0 ? [{ no: 'Skjør', en: 'Fragile' }] : n % 3 === 1 ? [{ no: 'Denne siden opp', en: 'This side up' }, { no: 'TMT', en: 'TMT' }] : [],
      bank: (s + n) % 9 === 0 ? na + 3000 : 0, rist: (s + n) % 13 === 0 ? na + 3000 : 0,
    }));
    onKabin({
      aktiv: true,
      fly: { callsign: 'TMT0DEMO', dep: 'ENGM', arr: 'ENBR', depNavn: 'Oslo Gardermoen', arrNavn: 'Bergen Flesland', type: 'B737-800', fase, faseTekst: { no, en } },
      flytype: 'Boeing 737-800', rader: 31, oppsett: 'ABC|DEF', utenRader: [],
      gate: fase === 'BOARDING' ? 'open' : 'closed', belte, servering,
      vogn: servering === 'open' ? { rad: 1 + Math.floor((t / varighet) * 30) } : null,
      kabinpersonale: 3, doPlass: ['foran', 'bak', 'bak'],
      pax, lasterom,
      lasteromInfo: { konsert: cruise && t > 40 && t < 50 ? na + 4000 : 0, turbulens: fase === 'DESCENT' && t > 5 && t < 12 ? na + 3000 : 0, luft: false, maksKjeks: 3 },
      na,
    });
    // Posisjon langs en tenkt rute Gardermoen → Flesland, med en sving midtveis.
    const f = ((performance.now() - start) / 1000 % total) / total;
    const lat = 60.19 - f * 0.9, lon = 11.1 - f * 5.8;
    const hdg = 255 + Math.sin(f * Math.PI * 4) * 12;
    onKart({
      live: true, bakken: maalAlt === 0 && alt < 50, altFt: alt, gsKt: gs, hdg, lat, lon, etaTs: Date.now() + 25 * 60e3, igjenNm: Math.round(170 * (1 - f)),
      callsign: 'TMT0DEMO', dep: 'ENGM', arr: 'ENBR', fase,
      rute: { dep: [60.19, 11.1], arr: [60.29, 5.22], fix: [[60.1, 10.2], [60.0, 9.0], [59.95, 8.0], [60.05, 7.0], [60.2, 6.0]] },
    });
  };
  tick();
  const id = setInterval(tick, 1000);
  return () => clearInterval(id);
}
