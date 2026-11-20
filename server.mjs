// Produksjonsserver: serverer dist/ og videresender /api/live?d=kabin|kart til TrasmaBot.
// Bare Node sine egne moduler. Kjøres som systemd-brukertjenesten trasma-cabin-xr.
//
//   PORT=7000 TLS_CERT=… TLS_KEY=… node server.mjs
//
// Uten TLS_CERT/TLS_KEY går den over vanlig HTTP.

import http from 'node:http';
import https from 'node:https';
import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { join, extname, normalize, sep } from 'node:path';
import { gzipSync } from 'node:zlib';

const PORT = Number(process.env.PORT || 7000);
const ROT = join(import.meta.dirname, 'dist');
const KILDE = 'https://trasmabot.trasma.tech/live.php';
const RUTER_IP = process.env.RUTER_IP || ''; // ruteren sett fra serveren (se lokal())
const CACHE_MS = 2000; // live.php mellomlagrer selv i ~3 s; alle seere deler ett kall
const TYPER = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webp': 'image/webp',
};

/* ---------- Statiske filer (lest og gzippet ved første bruk) ---------- */
const filer = new Map();
function fil(sti) {
  if (filer.has(sti)) return filer.get(sti);
  if (!existsSync(sti) || !statSync(sti).isFile()) return null;
  const data = readFileSync(sti);
  const type = TYPER[extname(sti)] || 'application/octet-stream';
  const f = { data, gz: /text|javascript|json|svg/.test(type) ? gzipSync(data) : null, type };
  filer.set(sti, f);
  return f;
}

/* ---------- Nye bygg ----------
   `vite build --watch` (tjenesten trasma-cabin-xr-bygg) skriver dist/ på nytt ved hver lagring.
   Når index.html endres, tømmes filcachen og åpne faner får beskjed om å laste siden på nytt. */
const INDEX = join(ROT, 'index.html');
let versjon = existsSync(INDEX) ? String(statSync(INDEX).mtimeMs) : '0';
const lyttere = new Set();
let ventende = null;
setInterval(() => {
  const ny = existsSync(INDEX) ? String(statSync(INDEX).mtimeMs) : versjon;
  if (ny === versjon || ventende) return;
  // Vent litt, så hele bygget er skrevet før fanene laster på nytt.
  ventende = setTimeout(() => {
    ventende = null;
    versjon = existsSync(INDEX) ? String(statSync(INDEX).mtimeMs) : versjon;
    filer.clear();
    console.log(`nytt bygg, ${lyttere.size} åpne faner laster på nytt`);
    for (const res of lyttere) res.write(`data: ${versjon}\n\n`);
  }, 1200);
}, 1000);

/* ---------- Proxy til TrasmaBot ---------- */
const cache = new Map(); // d → { t, status, body, venter }
async function live(d) {
  const c = cache.get(d);
  if (c && Date.now() - c.t < CACHE_MS) return c;
  if (c?.venter) return c.venter;
  const venter = (async () => {
    try {
      const r = await fetch(`${KILDE}?d=${d}`, { headers: { 'user-agent': 'trasma-cabin-xr' }, signal: AbortSignal.timeout(8000) });
      const ny = { t: Date.now(), status: r.status, body: Buffer.from(await r.arrayBuffer()) };
      cache.set(d, ny);
      return ny;
    } catch {
      const feil = { t: Date.now(), status: 502, body: Buffer.from('{"ok":false}') };
      cache.set(d, feil);
      return feil;
    }
  })();
  cache.set(d, { ...(c || {}), t: 0, venter });
  return venter;
}

/* ---------- Lydfilene til kabinlyden ----------
   Samme filer som live-kabinen på nettsiden (kabinlyd/lyder.json + mp3). Ingen CORS der, så de går via oss.
   Bare gyldige filnavn slipper gjennom; filene holdes i minnet (rundt 13 MB) og hentes på nytt ved ny versjon (?v=). */
const LYD_KILDE = 'https://trasmabot.trasma.tech/kabinlyd/';
const lydCache = new Map(); // navn?v → { status, type, body }
async function lydfil(navn, v) {
  const nokkel = `${navn}?${v}`;
  if (lydCache.has(nokkel)) return lydCache.get(nokkel);
  try {
    const r = await fetch(LYD_KILDE + navn + (v ? `?v=${encodeURIComponent(v)}` : ''), { headers: { 'user-agent': 'trasma-cabin-xr' }, signal: AbortSignal.timeout(15000) });
    const svar = { status: r.status, type: r.headers.get('content-type') || 'application/octet-stream', body: Buffer.from(await r.arrayBuffer()) };
    if (r.ok && navn !== 'lyder.json') lydCache.set(nokkel, svar);
    if (r.ok && navn === 'lyder.json') { lydCache.set(nokkel, svar); setTimeout(() => lydCache.delete(nokkel), 60000); }
    return svar;
  } catch {
    return { status: 502, type: 'text/plain', body: Buffer.from('') };
  }
}

/* ---------- Bruksstatistikk ----------
   Ingen IP-adresser lagres: seere skilles med en hash av IP + nettleser med et salt som byttes hver dag.
   Aktive nå = ulike seere som har hentet kabindata siste 30 s (appen henter hvert 4. s). */
const STAT_FIL = join(homedir(), '.local/state/trasma-cabin-xr/stats.json');
const dag = () => new Date().toISOString().slice(0, 10);
let salt = { dag: dag(), verdi: randomBytes(16) };
const aktive = new Map(); // hash → sist sett (ms)
let stat = { dager: {} };
try { stat = JSON.parse(readFileSync(STAT_FIL, 'utf8')); } catch { /* første gang */ }
const iDag = () => (stat.dager[dag()] ??= { unike: 0, sidevisninger: 0, maksSamtidige: 0, sett: [] });
let lagreTimer = null;
function lagre() {
  clearTimeout(lagreTimer);
  lagreTimer = setTimeout(() => {
    mkdirSync(join(STAT_FIL, '..'), { recursive: true });
    // Behold 90 dager.
    for (const d of Object.keys(stat.dager).sort().slice(0, -90)) delete stat.dager[d];
    writeFileSync(STAT_FIL + '.tmp', JSON.stringify(stat));
    renameSync(STAT_FIL + '.tmp', STAT_FIL);
  }, 2000);
}
function klient(req) {
  const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  return { ip, ua: req.headers['user-agent'] || '' };
}
function seer(req) {
  if (salt.dag !== dag()) salt = { dag: dag(), verdi: randomBytes(16) };
  const { ip, ua } = klient(req);
  return createHash('sha256').update(salt.verdi).update(ip).update('|').update(ua).digest('hex').slice(0, 16);
}
function registrer(req, slag) {
  const h = seer(req);
  const d = iDag();
  if (slag === 'side') d.sidevisninger++;
  if (!d.sett.includes(h)) {
    d.sett.push(h);
    d.unike++;
    console.log(`ny seer i dag (${d.unike} unike): ${/Quest|OculusBrowser/.test(req.headers['user-agent'] || '') ? 'Quest' : /Mobile/.test(req.headers['user-agent'] || '') ? 'mobil' : 'desktop'}`);
  }
  if (slag === 'data') aktive.set(h, Date.now());
  const naa = antallAktive();
  if (naa > d.maksSamtidige) d.maksSamtidige = naa;
  lagre();
}
function antallAktive() {
  const grense = Date.now() - 30000;
  for (const [h, t] of aktive) if (t < grense) aktive.delete(h);
  return aktive.size;
}
/** Bare fra maskinen selv, hjemmenettet og Tailscale. */
function lokal(req) {
  const { ip } = klient(req);
  // RUTER_IP: trafikk via port-videresendingen kan komme fra ruteren, så den regnes ikke som lokal.
  return ip === '127.0.0.1' || ip === '::1' || (/^192\.168\./.test(ip) && ip !== RUTER_IP) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip);
}

/* ---------- Ruting ---------- */
async function svar(req, res) {
  const url = new URL(req.url, 'http://x');
  res.setHeader('x-content-type-options', 'nosniff');
  if (url.pathname === '/api/live') {
    const d = url.searchParams.get('d');
    if (d !== 'kabin' && d !== 'kart') { res.writeHead(400); return res.end(); }
    if (d === 'kabin') registrer(req, 'data');
    const r = await live(d);
    res.writeHead(r.status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(r.body);
  }
  if (url.pathname.startsWith('/kabinlyd/')) {
    const navn = url.pathname.slice('/kabinlyd/'.length);
    const v = url.searchParams.get('v') || '';
    if (!(navn === 'lyder.json' || /^[a-z0-9]+(-[a-z0-9]+)*\.(mp3|ogg|wav)$/.test(navn)) || !/^[0-9a-f]{0,16}$/.test(v)) { res.writeHead(404); return res.end(); }
    const r = await lydfil(navn, v);
    res.writeHead(r.status, { 'content-type': r.type, 'cache-control': navn === 'lyder.json' ? 'no-cache' : 'public, max-age=86400' });
    return res.end(r.body);
  }
  if (url.pathname === '/api/versjon') {
    // Server-sent events: sender versjonen nå, og igjen ved hvert nye bygg.
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write(`retry: 3000\ndata: ${versjon}\n\n`);
    lyttere.add(res);
    const puls = setInterval(() => res.write(': puls\n\n'), 25000);
    req.on('close', () => { clearInterval(puls); lyttere.delete(res); });
    return;
  }
  if (url.pathname === '/api/stats') {
    if (!lokal(req)) { res.writeHead(404); return res.end(); }
    const dager = Object.fromEntries(Object.entries(stat.dager).sort().reverse().slice(0, 14)
      .map(([k, v]) => [k, { unike: v.unike, sidevisninger: v.sidevisninger, maksSamtidige: v.maksSamtidige }]));
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(JSON.stringify({ aktiveNaa: antallAktive(), dager }, null, 2));
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  // Ingen punktumfiler og ingen vei ut av dist/.
  let sti = normalize(join(ROT, decodeURIComponent(url.pathname)));
  if (!sti.startsWith(ROT) || sti.split(sep).some((d) => d.startsWith('.'))) { res.writeHead(404); return res.end(); }
  if (url.pathname.endsWith('/')) sti = join(sti, 'index.html');
  const f = fil(sti) || (extname(sti) ? null : fil(join(ROT, 'index.html')));
  if (f && f.type.startsWith('text/html')) registrer(req, 'side');
  if (!f) { res.writeHead(404); return res.end('Ikke funnet'); }
  const gz = f.gz && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  res.writeHead(200, {
    'content-type': f.type,
    'cache-control': url.pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    ...(gz ? { 'content-encoding': 'gzip', vary: 'accept-encoding' } : {}),
  });
  res.end(req.method === 'HEAD' ? undefined : gz ? f.gz : f.data);
}

// BARE_LOKALT=1: bare hjemmenettet og Tailscale slipper inn; alt utenfra (via port-videresending) avvises.
const BARE_LOKALT = process.env.BARE_LOKALT === '1';
const handler = (req, res) => {
  if (BARE_LOKALT && !lokal(req)) { res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('Ikke tilgjengelig utenfra.'); }
  return svar(req, res).catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); });
};
const { TLS_CERT, TLS_KEY } = process.env;
const server = TLS_CERT && TLS_KEY
  ? https.createServer({ cert: readFileSync(TLS_CERT), key: readFileSync(TLS_KEY) }, handler)
  : http.createServer(handler);
server.listen(PORT, () => console.log(`trasma-cabin-xr på ${TLS_CERT ? 'https' : 'http'}://0.0.0.0:${PORT}`));
