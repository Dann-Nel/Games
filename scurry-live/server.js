'use strict';
// Scurry Live: authoritative game server. One process, in-memory games, WebSocket + static files.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto'), zlib = require('zlib');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 70;
const PUB = path.join(__dirname, 'public');
const games = new Map();
const fileCache = new Map();   // path -> { mtime, raw, gz }: static files are gzipped once, not per request

// ---------- static files ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent(req.url.split('?')[0]); } catch { res.writeHead(400); return res.end('bad request'); }
  if (p.includes('\0')) { res.writeHead(400); return res.end('bad request'); }
  if (p === '/healthz') { res.writeHead(200); return res.end('ok'); }
  if (p === '/') p = '/index.html';
  const f = path.normalize(path.join(PUB, p));
  if (!f.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.stat(f, (e, st) => {
    if (e || !st.isFile()) { res.writeHead(404); return res.end('not found'); }
    const hit = fileCache.get(f);
    const send = c => {
      const gz = /\bgzip\b/.test(req.headers['accept-encoding'] || '') && c.gz;
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Vary': 'Accept-Encoding',
        'Cache-Control': path.basename(f) === 'sw.js' ? 'no-cache' : 'public, max-age=300', ...(gz ? { 'Content-Encoding': 'gzip' } : {}) });
      res.end(gz ? c.gz : c.raw);
    };
    if (hit && hit.mtime === st.mtimeMs) return send(hit);
    fs.readFile(f, (e2, raw) => {
      if (e2) { res.writeHead(404); return res.end('not found'); }
      const text = /\.(html|js|svg|webmanifest|json)$/.test(f), c = { mtime: st.mtimeMs, raw, gz: text ? zlib.gzipSync(raw, { level: 9 }) : null };
      fileCache.set(f, c); send(c);
    });
  });
});
const wss = new WebSocketServer({ server, maxPayload: 8 * 1024 });

// ---------- helpers ----------
const clamp = (v, lo, hi, d) => { v = Number(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
const rnd = n => crypto.randomInt(n);
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const R = 6371000, rad = d => d * Math.PI / 180;
function dist(a, b) {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
const validLoc = (lat, lng) => typeof lat === 'number' && typeof lng === 'number' && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
function offset(c, meters, bearing) {
  const dLat = meters * Math.cos(bearing) / 111320;
  const dLng = meters * Math.sin(bearing) / (111320 * Math.cos(rad(c.lat)));
  return { lat: c.lat + dLat, lng: c.lng + dLng };
}
function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (;;) { let c = ''; for (let i = 0; i < 4; i++) c += A[rnd(A.length)]; if (!games.has(c)) return c; }
}
const send = (ws, o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };

// ---------- config ----------
function makeCfg(inp = {}) {
  return {
    hunterRatio: clamp(inp.hunterRatio, 0.02, 0.5, 0.15),   // share of players who hunt
    hideSecs: clamp(inp.hideSecs, 1, 1800, 120),            // head start for runners
    radius: clamp(inp.radius, 50, 5000, 800),               // starting zone radius, metres
    stages: clamp(inp.stages, 1, 10, 5),                    // number of shrinks
    stageFactor: clamp(inp.stageFactor, 0.3, 0.9, 0.7),     // each new radius = previous * factor
    hold: clamp(inp.hold, 1, 1800, 240),                    // seconds the zone holds before shrinking
    shrink: clamp(inp.shrink, 1, 600, 60),                  // seconds the shrink takes
    pingEvery: clamp(inp.pingEvery, 2, 1800, 90),           // runners revealed to hunters this often
    huntSecs: clamp(inp.huntSecs, 10, 7200, 1800),          // runners win if they last this long
    outsideGrace: clamp(inp.outsideGrace, 0, 600, 30),      // seconds outside the zone before elimination (0 = never)
    tagRange: clamp(inp.tagRange, 5, 200, 25),              // metres within which a tag counts
    taggedMode: inp.taggedMode === 'watch' || (inp.taggedMode === undefined && inp.caughtJoinHunters === false) ? 'watch' : 'hunter',  // what a tagged runner becomes
    zoneOn: inp.zoneOn !== false,                           // false = no play zone: no shrinking, no outside-zone exposure
    huntersTalk: inp.huntersTalk !== false,                 // hunters may use team chat and voice
    watchDelay: clamp(inp.watchDelay, 0, 300, 60),          // seconds behind live that tagged spectators see the game
    teamChat: inp.teamChat !== false,
    get caughtJoinHunters() { return this.taggedMode === 'hunter'; },
    voice: inp.voice !== false,
    pingRevealsHunters: !!inp.pingRevealsHunters,
    safeSecs: clamp(inp.safeSecs, 0, 600, 60),              // total seconds each runner may shelter in safe spots
    safeRadius: clamp(inp.safeRadius, 5, 100, 20),          // metres around a safe spot
    bounty: !!inp.bounty,                         // few runners left: live pings on them
    bountyAt: clamp(inp.bountyAt, 1, 10, 3),
    bountyEvery: clamp(inp.bountyEvery, 5, 120, 20),
    drops: !!inp.drops,                           // supply drops with power-ups
    dropEvery: clamp(inp.dropEvery, 10, 900, 120),
    radarRadius: clamp(inp.radarRadius, 50, 500, 150),
    gpsStaleWarn: clamp(inp.gpsStaleWarn, 3, 300, 30),      // seconds without a location fix before a warning
    gpsStaleOut: clamp(inp.gpsStaleOut, 0, 900, 120),       // seconds without a fix before a runner is out (0 = never)
    maxAccuracy: clamp(inp.maxAccuracy, 10, 1000, 50),      // fixes less accurate than this (metres) are ignored
    maxSpeed: clamp(inp.maxSpeed, 0, 50, 15),               // m/s; faster jumps are rejected as teleports (0 = off)
    sosRadius: clamp(inp.sosRadius, 50, 2000, 300),         // SOS reaches the host and players within this many metres
  };
}

// ---------- game model ----------
function createGame(cfgIn) {
  const g = { code: newCode(), cfg: makeCfg(cfgIn), cfgV: 1, phase: 'lobby', players: new Map(), host: null, center: null,
    zones: [], spots: [], reports: [], drops: [], nextDropAt: 0, nextBountyAt: 0, dropNo: 0, startAt: 0, huntStart: 0, nextPingAt: 0, pingNo: 0, winner: null, chat: { hunters: [], runners: [] },
    touched: Date.now(), timer: null };
  games.set(g.code, g);
  g.timer = setInterval(() => tick(g), 1000);
  return g;
}
function addPlayer(g, name, ws) {
  const p = { id: String(g.players.size + 1) + crypto.randomBytes(2).toString('hex'), token: crypto.randomBytes(16).toString('hex'),
    name: String(name || 'Player').trim().slice(0, 20) || 'Player', ws, pref: 'random', role: null, out: false,
    loc: null, locT: 0, lastPing: null, tagCode: null, outsideSince: null, exposed: false, lastChat: 0,
    item: null, safe: false, safeUsed: 0, decoyNext: false, ghostNext: false,
    muted: false, badFixes: 0, lowAcc: 0, flags: 0, staleWarned: false, lastSos: 0, acc: null,
    lastFixT: 0, vloc: null, anyT: 0, cfgSent: -1, lastKey: '', lastSentT: 0, ready: false, hist: [], lastTag: 0, tagFails: 0, tagLockUntil: 0, cid: null };
  g.players.set(p.id, p);
  return p;
}
const active = (g, role) => [...g.players.values()].filter(p => p.role === role && !p.out);
const connected = g => [...g.players.values()].filter(p => p.ws);
// Seconds since a live player's last accepted fix, or 0 while it is fresh (or the player is not in play).
const staleAge = (g, p, now) => {
  if ((g.phase !== 'hide' && g.phase !== 'hunt') || p.out || (p.role !== 'runner' && p.role !== 'hunter')) return 0;
  const a = (now - Math.max(p.locT, p.anyT, g.startAt)) / 1000;
  return a >= g.cfg.gpsStaleWarn ? Math.round(a) : 0;
};
const notifyHost = (g, text) => { const h = g.players.get(g.host); if (h) send(h.ws, { t: 'event', kind: 'warn', text }); };

function assignRoles(g) {
  const ps = shuffle([...g.players.values()]);
  const n = ps.length;
  const H = Math.min(n - 1, Math.max(1, Math.round(n * g.cfg.hunterRatio)));
  const hunters = [];
  for (const p of ps) if (p.pref === 'hunter' && hunters.length < H) hunters.push(p);
  for (const p of ps) if (p.pref === 'random' && hunters.length < H) hunters.push(p);
  for (const p of ps) if (p.pref === 'runner' && hunters.length < H) hunters.push(p); // draft only if nobody else is left
  const hs = new Set(hunters);
  const codes = new Set();
  for (const p of ps) {
    p.role = hs.has(p) ? 'hunter' : 'runner'; p.out = false; p.lastPing = null; p.exposed = false; p.outsideSince = null;
    p.item = null; p.safe = false; p.safeUsed = 0; p.decoyNext = false; p.ghostNext = false;
    p.badFixes = 0; p.lowAcc = 0; p.flags = 0; p.staleWarned = false;
    if (p.role === 'runner') { let c; do { c = String(1000 + rnd(9000)); } while (codes.has(c)); codes.add(c); p.tagCode = c; }
    else p.tagCode = null;
  }
}
function buildZones(g) {
  const z = [{ lat: g.center.lat, lng: g.center.lng, r: g.cfg.radius }];
  for (let i = 0; i < g.cfg.stages; i++) {
    const prev = z[i], r = prev.r * g.cfg.stageFactor;
    const c = offset(prev, Math.sqrt(Math.random()) * (prev.r - r), Math.random() * 2 * Math.PI);
    z.push({ lat: c.lat, lng: c.lng, r });
  }
  g.zones = z;
}
const lerp = (a, b, k) => ({ lat: a.lat + (b.lat - a.lat) * k, lng: a.lng + (b.lng - a.lng) * k, r: a.r + (b.r - a.r) * k });
function zoneAt(g, now) {
  const z = g.zones, { hold, shrink } = g.cfg;
  const ref = Math.max(now, g.huntStart);
  let t = (ref - g.huntStart) / 1000;
  for (let i = 1; i < z.length; i++) {
    if (t < hold) return { cur: z[i - 1], next: z[i], shrinking: false, until: ref + (hold - t) * 1000, stage: i };
    t -= hold;
    if (t < shrink) return { cur: lerp(z[i - 1], z[i], t / shrink), next: z[i], shrinking: true, until: ref + (shrink - t) * 1000, stage: i };
    t -= shrink;
  }
  return { cur: z[z.length - 1], next: null, shrinking: false, until: null, stage: z.length - 1 };
}

function event(g, text, kind) {
  const o = { t: 'event', kind: kind || 'info', text };
  for (const p of g.players.values()) send(p.ws, o);
}
function eliminate(g, p, why) {
  p.out = true; p.exposed = false; p.outsideSince = null;
  p.role = g.cfg.taggedMode === 'hunter' ? 'hunter' : 'spectator';
  p.tagCode = null; p.item = null; p.safe = false; p.decoyNext = false; p.ghostNext = false;
  event(g, `${p.name} is out (${why}).`, 'out');
}
function doPing(g) {
  g.pingNo++;
  const now = Date.now();
  for (const p of g.players.values()) {
    if (p.out || !p.loc || (p.role !== 'runner' && p.role !== 'hunter')) continue;
    if (p.role === 'runner' && p.ghostNext) { p.ghostNext = false; send(p.ws, { t: 'event', kind: 'item', text: 'Ghost: you skipped this ping.' }); continue; }
    if (p.role === 'runner' && p.decoyNext) {
      p.decoyNext = false;
      const f = offset(p.loc, 80 + rnd(70), Math.random() * 2 * Math.PI);
      p.lastPing = { lat: f.lat, lng: f.lng, t: now };
      send(p.ws, { t: 'event', kind: 'item', text: 'Decoy: hunters were shown a fake position.' });
      continue;
    }
    p.lastPing = { lat: p.loc.lat, lng: p.loc.lng, t: now, acc: p.acc };
  }
  event(g, 'PING! Runner positions revealed to hunters.', 'ping');
}
function finish(g, winner) {
  g.phase = 'over'; g.winner = winner;
  event(g, { hunters: 'Hunters win: every runner is out.', runners: 'Runners win: they outlasted the clock.', none: 'The host ended the game.' }[winner], 'over');
  wipeLocations(g);
}
// Privacy: location data is deleted the moment a game ends (and again on rematch).
function wipeLocations(g) {
  for (const p of g.players.values()) { p.loc = null; p.vloc = null; p.locT = 0; p.acc = null; p.hist = []; p.lastPing = null; p.exposed = false; p.outsideSince = null; }
  g.drops = [];
}

function tick(g) {
  const now = Date.now();
  if (now - (g.snapT || 0) >= 2000) { g.snapT = now; for (const q of g.players.values()) q.vloc = q.loc && { lat: q.loc.lat, lng: q.loc.lng, t: q.locT, acc: q.acc }; }   // what other players are shown: refreshed every 2 s, not every fix
  for (const p of g.players.values()) {                       // GPS-loss detection
    const age = staleAge(g, p, now);
    if (age) {
      if (!p.staleWarned) {
        p.staleWarned = true;
        send(p.ws, { t: 'event', kind: 'warn', text: 'No GPS signal! Get somewhere with open sky or you may be eliminated.' });
        notifyHost(g, `${p.name} has no GPS signal.`);
      }
      if (g.cfg.gpsStaleOut > 0 && g.phase === 'hunt' && p.role === 'runner' && age >= Math.max(g.cfg.gpsStaleOut, g.cfg.gpsStaleWarn + 5)) eliminate(g, p, 'lost GPS signal');
    } else p.staleWarned = false;
  }
  if (g.phase === 'hide' && now >= g.huntStart) {
    g.phase = 'hunt'; g.nextPingAt = now + g.cfg.pingEvery * 1000;
    event(g, 'Hide time is over. Hunters, go!', 'hunt');
  }
  if (g.phase === 'hunt') {
    const z = zoneAt(g, now);
    for (const p of active(g, 'runner')) {
      const inSpot = p.loc && g.spots.some(s => dist(p.loc, s) <= g.cfg.safeRadius);
      if (inSpot && p.safeUsed < g.cfg.safeSecs * 1000) { p.safeUsed += 1000; p.safe = true; } else p.safe = false;
      const out = g.cfg.zoneOn && p.loc && dist(p.loc, z.cur) > z.cur.r;
      if (out) {
        if (!p.outsideSince) { p.outsideSince = now; send(p.ws, { t: 'event', kind: 'warn', text: 'You are outside the zone: hunters can see you!' }); }
        p.exposed = true;
        if (g.cfg.outsideGrace > 0 && now - p.outsideSince >= g.cfg.outsideGrace * 1000) eliminate(g, p, 'stayed outside the zone');
      } else { p.outsideSince = null; p.exposed = false; }
    }
    if (!g.fixAsked && now >= g.nextPingAt - 3000) {          // ask every phone for a fresh high-accuracy fix just before the ping
      g.fixAsked = true;
      for (const p of g.players.values()) send(p.ws, { t: 'fix' });
    }
    if (now >= g.nextPingAt) { doPing(g); g.nextPingAt += g.cfg.pingEvery * 1000; g.fixAsked = false; }
    const rs = active(g, 'runner');
    if (g.cfg.bounty && rs.length > 0 && rs.length <= g.cfg.bountyAt && now >= g.nextBountyAt) {
      g.nextBountyAt = now + g.cfg.bountyEvery * 1000;
      for (const r of rs) if (r.loc) r.lastPing = { lat: r.loc.lat, lng: r.loc.lng, t: now, acc: r.acc };
      event(g, `BOUNTY PING: the last ${rs.length} runner${rs.length > 1 ? 's' : ''} revealed!`, 'ping');
    }
    if (g.cfg.drops) {
      g.drops = g.drops.filter(d => d.expires > now);
      if (now >= g.nextDropAt) {
        g.nextDropAt = now + g.cfg.dropEvery * 1000;
        if (g.drops.length < 3) {
          const c = offset(z.cur, Math.sqrt(Math.random()) * z.cur.r * 0.9, Math.random() * 2 * Math.PI);
          g.drops.push({ id: ++g.dropNo, lat: c.lat, lng: c.lng, expires: now + 180000 });
          event(g, 'A supply drop landed inside the zone!', 'info');
        }
      }
      for (const p of g.players.values()) {
        if (p.item || !p.loc || (p.role !== 'runner' && p.role !== 'hunter') || (p.role === 'runner' && p.out)) continue;
        const d = g.drops.find(x => dist(p.loc, x) <= 20);
        if (!d) continue;
        g.drops = g.drops.filter(x => x !== d);
        const pool = p.role === 'runner' ? ['decoy', 'ghost'] : ['radar'];
        p.item = pool[rnd(pool.length)];
        send(p.ws, { t: 'event', kind: 'item', text: `You picked up: ${p.item.toUpperCase()}` });
      }
    }
    if (active(g, 'runner').length === 0) finish(g, 'hunters');
    else if (now >= g.huntStart + g.cfg.huntSecs * 1000) finish(g, 'runners');
  }
  for (const p of g.players.values()) {
    if (!p.ws) continue;
    const v = view(g, p, now), had = v.cfg !== undefined;
    v.now = 0; const key = JSON.stringify(v);
    if (key === p.lastKey && now - p.lastSentT < 4000) continue;   // nothing changed: save the phone's data and battery
    p.lastKey = key; p.lastSentT = now; v.now = now; if (had) p.cfgSent = g.cfgV;
    send(p.ws, v);
  }
  if (now - g.touched > 3 * 3600 * 1000 || (connected(g).length === 0 && now - g.touched > 30 * 60 * 1000)) {
    clearInterval(g.timer); games.delete(g.code);
  }
}

const r6 = n => Math.round(n * 1e6) / 1e6;    // ~0.1 m: more digits only cost bandwidth
const rz = z => z && { lat: r6(z.lat), lng: r6(z.lng), r: Math.round(z.r * 10) / 10 };
function view(g, p, now) {
  const v = { t: 'state', now, code: g.code, phase: g.phase, host: g.host === p.id, center: g.center,
    you: { id: p.id, name: p.name, role: p.role, out: p.out, pref: p.pref, exposed: p.exposed,
      tagCode: p.tagCode || undefined, outsideSince: p.outsideSince || undefined,
      item: p.item, safe: p.safe, safeLeft: Math.max(0, g.cfg.safeSecs - p.safeUsed / 1000),
      stale: staleAge(g, p, now), muted: p.muted },
    winner: g.winner, spots: g.spots, drops: g.phase === 'lobby' ? [] : g.drops };
  // The host's roster deliberately omits roles, so hosting never reveals who is a hunter.
  if (p.cfgSent !== g.cfgV) v.cfg = g.cfg;                     // settings only travel when they change
  if (g.host === p.id) v.roster = [...g.players.values()].map(q => ({ id: q.id, name: q.name, muted: q.muted, online: !!q.ws, stale: staleAge(g, q, now), flags: q.flags, reports: g.reports.filter(r => r.about === q.id).length }));
  if (g.host === p.id) v.reports = g.reports.slice(-30);
  if (g.phase === 'lobby') {
    v.players = [...g.players.values()].map(q => ({ id: q.id, name: q.name, pref: q.pref, online: !!q.ws, ready: q.ready || q.id === g.host, host: q.id === g.host }));
    return v;
  }
  v.counts = { runners: active(g, 'runner').length, hunters: active(g, 'hunter').length, total: g.players.size };
  v.huntStart = g.huntStart; v.huntEnd = g.huntStart + g.cfg.huntSecs * 1000;
  v.nextPingAt = g.phase === 'hunt' ? g.nextPingAt : null;
  const zz = zoneAt(g, now); v.zone = { ...zz, cur: rz(zz.cur), next: rz(zz.next) };
  const m = [];
  const hunterSide = p.role === 'hunter';
  if (p.role === 'spectator') {                               // tagged "watch" mode: everyone, but only as they were watchDelay seconds ago
    const at = now - g.cfg.watchDelay * 1000;
    for (const q of g.players.values()) {
      if (q.id === p.id || (q.role !== 'runner' && q.role !== 'hunter') || q.out && q.role !== 'hunter') continue;
      let h = null; for (let i = q.hist.length - 1; i >= 0; i--) if (q.hist[i].t <= at) { h = q.hist[i]; break; }
      if (h) m.push({ id: q.id, name: q.name, kind: 'watch', role: q.role, lat: r6(h.lat), lng: r6(h.lng), t: h.t, acc: h.acc });
    }
    v.markers = m; return v;
  }
  for (const q of g.players.values()) {
    if (q.id === p.id) continue;
    const base = { id: q.id, name: q.name };
    if (hunterSide) {
      if (q.role === 'hunter' && q.vloc) m.push({ ...base, kind: 'ally', lat: r6(q.vloc.lat), lng: r6(q.vloc.lng), t: q.vloc.t, acc: q.vloc.acc });
      else if (q.role === 'runner' && !q.out) {
        if (q.exposed && q.vloc) m.push({ ...base, kind: 'exposed', lat: r6(q.vloc.lat), lng: r6(q.vloc.lng), t: q.vloc.t, acc: q.vloc.acc });
        else if (q.lastPing) m.push({ ...base, kind: 'ping', lat: r6(q.lastPing.lat), lng: r6(q.lastPing.lng), t: q.lastPing.t, acc: q.lastPing.acc });
      }
    } else {
      if (q.role === 'runner' && q.vloc) m.push({ ...base, kind: 'ally', lat: r6(q.vloc.lat), lng: r6(q.vloc.lng), t: q.vloc.t, acc: q.vloc.acc });
      else if (q.role === 'hunter' && g.cfg.pingRevealsHunters && q.lastPing) m.push({ ...base, kind: 'ping', lat: r6(q.lastPing.lat), lng: r6(q.lastPing.lng), t: q.lastPing.t, acc: q.lastPing.acc });
    }
  }
  v.markers = m;
  return v;
}

// ---------- chat / voice ----------
const chanFor = p => p.role === 'hunter' ? 'hunters' : (p.role === 'runner' || p.role === 'spectator') ? 'runners' : null;
const b64u = s => Buffer.from(s).toString('base64url');
function livekitToken(room, identity, name, muted) {
  const key = process.env.LIVEKIT_API_KEY, secret = process.env.LIVEKIT_API_SECRET;
  if (!key || !secret || !process.env.LIVEKIT_URL) return null;
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify({ iss: key, sub: identity, name, nbf: now, exp: now + 900,
    video: { room, roomJoin: true, canPublish: !muted, canSubscribe: true } }));
  const sig = crypto.createHmac('sha256', secret).update(head + '.' + body).digest('base64url');
  return head + '.' + body + '.' + sig;
}

// Change a participant's publish permission on the voice server (mute/unmute takes effect on a live call). Needs LIVEKIT_* env; failures are logged, not fatal.
async function livekitRestrict(room, identity, canPublish) {
  const key = process.env.LIVEKIT_API_KEY, secret = process.env.LIVEKIT_API_SECRET, url = process.env.LIVEKIT_URL;
  if (!key || !secret || !url) return;
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify({ iss: key, nbf: now, exp: now + 60, video: { roomAdmin: true, room } }));
  const sig = crypto.createHmac('sha256', secret).update(head + '.' + body).digest('base64url');
  try {
    await fetch(url.replace(/^ws/, 'http') + '/twirp/livekit.RoomService/UpdateParticipant', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${head}.${body}.${sig}` },
      body: JSON.stringify({ room, identity, permission: { can_subscribe: true, can_publish: canPublish, can_publish_data: canPublish } }),
    });
  } catch (e) { console.error('livekit restrict failed:', e.message); }
}

// ---------- sockets ----------
wss.on('connection', ws => {
  ws.isAlive = true; ws.on('pong', () => { ws.isAlive = true; });
  ws.gcode = null; ws.pid = null;
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    try { handle(ws, m); } catch (e) { console.error(e); send(ws, { t: 'error', text: 'Server error' }); }
  });
  ws.on('close', () => {
    const g = games.get(ws.gcode); const p = g && g.players.get(ws.pid);
    if (p && p.ws === ws) p.ws = null;
  });
});
setInterval(() => wss.clients.forEach(w => { if (!w.isAlive) return w.terminate(); w.isAlive = false; w.ping(); }), 20000);

function handle(ws, m) {
  const err = text => send(ws, { t: 'error', text });
  if (m.t === 'create') {
    if (m.consent !== true) return err('Location consent is required to play.');
    const g = createGame(m.cfg), p = addPlayer(g, m.name, ws);
    p.cid = typeof m.cid === 'string' ? m.cid.slice(0, 40) : null;
    g.host = p.id; ws.gcode = g.code; ws.pid = p.id;
    return send(ws, { t: 'joined', code: g.code, token: p.token, id: p.id });
  }
  if (m.t === 'join') {
    if (m.consent !== true) return err('Location consent is required to play.');
    const g = games.get(String(m.code || '').toUpperCase());
    if (!g) return err('No game with that code.');
    if (g.phase !== 'lobby') return err('That game has already started.');
    if (g.players.size >= MAX_PLAYERS) return err('Game is full (70 players).');
    const cid = typeof m.cid === 'string' ? m.cid.slice(0, 40) : null;
    if (cid && g.banned && g.banned.has(cid)) return err('You were removed from this game by the host.');
    const p = addPlayer(g, m.name, ws); p.cid = cid; ws.gcode = g.code; ws.pid = p.id;
    return send(ws, { t: 'joined', code: g.code, token: p.token, id: p.id });
  }
  if (m.t === 'resume') {
    const g = games.get(String(m.code || '').toUpperCase());
    const p = g && [...g.players.values()].find(q => q.token === m.token);
    if (!p) return send(ws, { t: 'gone' });
    if (p.ws && p.ws !== ws) p.ws.close();
    p.ws = ws; p.cfgSent = -1; p.lastKey = ''; ws.gcode = g.code; ws.pid = p.id;
    send(ws, { t: 'joined', code: g.code, token: p.token, id: p.id });
    const ch = chanFor(p);
    if (ch) for (const c of g.chat[ch]) send(ws, c);
    return;
  }
  const g = games.get(ws.gcode), p = g && g.players.get(ws.pid);
  if (!p) return err('Not in a game.');
  g.touched = Date.now();
  switch (m.t) {
    case 'pref':
      if (g.phase === 'lobby' && ['runner', 'hunter', 'random'].includes(m.pref)) p.pref = m.pref;
      break;
    case 'ready':
      if (g.phase === 'lobby') p.ready = !!m.on;
      break;
    case 'newcode': {      // host swaps the match code (e.g. after it leaked); everyone in the lobby is moved over
      if (g.host !== p.id || g.phase !== 'lobby') return;
      games.delete(g.code); g.code = newCode(); games.set(g.code, g);
      for (const q of g.players.values()) if (q.ws) { q.ws.gcode = g.code; send(q.ws, { t: 'joined', code: g.code, token: q.token, id: q.id }); }
      break;
    }
    case 'config':
      if (g.host === p.id && g.phase === 'lobby') { g.cfg = makeCfg(m.cfg); g.cfgV++; }
      break;
    case 'center':
      if (g.host === p.id && g.phase === 'lobby' && validLoc(m.lat, m.lng)) g.center = { lat: m.lat, lng: m.lng };
      break;
    case 'start': {
      if (g.host !== p.id || g.phase !== 'lobby') return;
      if (g.players.size < 2) return err('Need at least 2 players.');
      const c = g.center || (p.loc && { lat: p.loc.lat, lng: p.loc.lng });
      if (!c) return err('Set the zone centre: tap the map, or allow GPS.');
      g.center = c; assignRoles(g); buildZones(g);
      g.drops = []; g.nextBountyAt = 0; g.startAt = Date.now();
      g.phase = 'hide'; g.huntStart = Date.now() + g.cfg.hideSecs * 1000; g.nextDropAt = g.huntStart + g.cfg.dropEvery * 1000; g.winner = null; g.chat = { hunters: [], runners: [] };
      event(g, `Game on! Runners have ${g.cfg.hideSecs}s to hide.`, 'start');
      break;
    }
    case 'rematch':
      if (g.host === p.id && g.phase === 'over') {
        g.phase = 'lobby'; g.winner = null; wipeLocations(g);
        for (const q of g.players.values()) { q.role = null; q.out = false; q.ready = false; q.lastPing = null; q.exposed = false; q.tagCode = null; }
      }
      break;
    case 'loc': {
      if (!validLoc(m.lat, m.lng) || g.phase === 'over') return;
      const now = Date.now(); if (now - p.lastFixT < 900) return; p.lastFixT = now;   // counts rejected fixes too, so a burst can't skip the 5-fix wait
      // Anti-cheat 1: ignore fixes the phone itself says are too imprecise.
      let poor = false;
      if (typeof m.acc === 'number' && m.acc > g.cfg.maxAccuracy) {
        p.anyT = now;                                             // the phone is reporting, so this is not "no GPS"
        if (++p.lowAcc === 3) send(ws, { t: 'event', kind: 'warn', text: `GPS accuracy is poor (±${Math.round(m.acc)} m). Move to open sky.` });
        if (p.loc && now - p.locT < 20000 || m.acc > 300) return;  // a good fix is recent (or this one is useless): ignore it
        poor = true;                                              // no good fix for 20 s: use the best available so the player is not invisible
      } else p.lowAcc = 0;
      // Anti-cheat 2: reject impossible jumps. A persistent jump (5 fixes in a row) is accepted but flagged to the host.
      if (!poor && g.cfg.maxSpeed > 0 && p.loc && g.phase !== 'lobby') {
        const dt = Math.max(1, (now - p.locT) / 1000), d = dist(p.loc, { lat: m.lat, lng: m.lng });
        if (d > g.cfg.maxSpeed * dt + 30) {
          if (++p.badFixes < 5) return;
          p.flags++; notifyHost(g, `${p.name}: suspicious location jump (${Math.round(d)} m).`);
        }
      }
      p.badFixes = 0;
      p.loc = { lat: m.lat, lng: m.lng }; p.locT = now; p.acc = typeof m.acc === 'number' ? Math.round(m.acc) : null;
      p.hist.push({ lat: m.lat, lng: m.lng, t: now, acc: p.acc }); while (p.hist.length && now - p.hist[0].t > 330000) p.hist.shift();   // kept only for the delayed spectator view
      break;
    }
    case 'sos': {
      const now = Date.now();
      if (now - p.lastSos < 20000) return err('SOS already sent: help is on the way. Wait a few seconds to send another.');
      p.lastSos = now;
      const msg = { t: 'sos', id: p.id, name: p.name, lat: p.loc ? p.loc.lat : null, lng: p.loc ? p.loc.lng : null, at: now };
      for (const q of g.players.values())
        if (q.id === p.id || q.id === g.host || (p.loc && q.loc && dist(p.loc, q.loc) <= g.cfg.sosRadius)) send(q.ws, msg);
      break;
    }
    case 'kick': {
      if (g.host !== p.id) return;
      const q = g.players.get(String(m.id)); if (!q || q.id === p.id) return;
      g.players.delete(q.id);
      if (q.cid) (g.banned = g.banned || new Set()).add(q.cid);   // a kick is a ban for this game (per device id; a determined cheater can clear it)
      send(q.ws, { t: 'kicked' });
      if (q.ws) { q.ws.gcode = null; q.ws.pid = null; }
      event(g, `${q.name} was removed by the host.`, 'info');
      break;
    }
    case 'mute': {
      if (g.host !== p.id) return;
      const q = g.players.get(String(m.id)); if (!q || q.id === p.id) return;
      q.muted = !!m.on;
      const mch = chanFor(q); if (mch) livekitRestrict(`scurry-${g.code}-${mch}`, q.id, !q.muted);   // also revoke publishing on a live voice connection
      send(q.ws, { t: 'event', kind: 'warn', text: q.muted ? 'The host muted you in team chat and voice.' : 'The host unmuted you.' });
      break;
    }
    case 'report': {      // any player can flag a teammate's behaviour; the host sees it in the host panel
      const q = g.players.get(String(m.id)); if (!q || q.id === p.id || g.host === p.id) return;
      const now = Date.now();
      if (g.reports.some(r => r.by === p.id && r.about === q.id) || now - (p.lastReport || 0) < 5000) return err('You already reported this player.');
      p.lastReport = now;
      const reason = ['abuse', 'cheating', 'unsafe', 'other'].includes(m.reason) ? m.reason : 'other';
      g.reports.push({ by: p.id, byName: p.name, about: q.id, aboutName: q.name, reason, at: now });
      if (g.reports.length > 200) g.reports.shift();
      notifyHost(g, `Report: ${q.name} (${reason}), from ${p.name}.`);
      send(ws, { t: 'event', kind: 'info', text: 'Report sent to the host.' });
      break;
    }
    case 'end':
      if (g.host === p.id && (g.phase === 'hide' || g.phase === 'hunt')) finish(g, 'none');
      break;
    case 'tag': {
      if (g.phase !== 'hunt' || p.role !== 'hunter') return;
      const now = Date.now();
      // Throttled, with one uniform error: a failed attempt must not reveal whether a code exists, how far the runner is, or whether they are in a safe spot.
      if (p.tagLockUntil > now) return err(`Too many wrong codes. Wait ${Math.ceil((p.tagLockUntil - now) / 1000)} s.`);
      if (now - p.lastTag < 2000) return err('Slow down: one code every 2 seconds.');
      p.lastTag = now;
      const code = String(m.code || '').trim();
      const q = active(g, 'runner').find(r => r.tagCode === code);
      const good = q && !q.safe && p.loc && q.loc && now - p.locT <= 30000 && now - q.locT <= 30000 && dist(p.loc, q.loc) <= g.cfg.tagRange;
      if (!good) {
        if (++p.tagFails >= 5) { p.tagFails = 0; p.tagLockUntil = now + 60000; }
        return err(`Tag not accepted. Check the code and be within ${g.cfg.tagRange} m of the runner.`);
      }
      p.tagFails = 0;
      eliminate(g, q, `tagged by ${p.name}`);
      break;
    }
    case 'spot':
      if (g.host === p.id && g.phase === 'lobby' && validLoc(m.lat, m.lng) && g.spots.length < 10) g.spots.push({ lat: m.lat, lng: m.lng });
      break;
    case 'spots_clear':
      if (g.host === p.id && g.phase === 'lobby') g.spots = [];
      break;
    case 'use': {
      if (g.phase !== 'hunt' || !p.item) return;
      const it = p.item;
      if (it === 'decoy' && p.role === 'runner') { p.decoyNext = true; send(ws, { t: 'event', kind: 'item', text: 'Decoy armed: your next ping shows a fake position.' }); }
      else if (it === 'ghost' && p.role === 'runner') { p.ghostNext = true; send(ws, { t: 'event', kind: 'item', text: 'Ghost armed: you will skip the next ping.' }); }
      else if (it === 'radar' && p.role === 'hunter') {
        if (!p.loc) return err('Need a GPS fix to use radar.');
        const now = Date.now(); let n = 0;
        for (const r of active(g, 'runner')) if (r.loc && dist(p.loc, r.loc) <= g.cfg.radarRadius) { r.lastPing = { lat: r.loc.lat, lng: r.loc.lng, t: now, acc: r.acc }; n++; }
        for (const h of g.players.values()) if (h.role === 'hunter') send(h.ws, { t: 'event', kind: 'ping', text: `${p.name}'s radar found ${n} runner${n === 1 ? '' : 's'} within ${g.cfg.radarRadius} m.` });
      } else return;
      p.item = null;
      break;
    }
    case 'caught':
      if ((g.phase === 'hide' || g.phase === 'hunt') && p.role === 'runner' && !p.out) eliminate(g, p, 'reported caught');
      break;
    case 'chat': {
      if (!g.cfg.teamChat || g.phase === 'lobby') return;
      const ch = chanFor(p); const text = String(m.text || '').trim().slice(0, 200);
      if (!ch || !text) return;
      if (p.role === 'hunter' && !g.cfg.huntersTalk) return err('Hunter chat is turned off.');
      if (p.muted) return err('You are muted by the host.');
      const now = Date.now(); if (now - p.lastChat < 700) return; p.lastChat = now;
      const msg = { t: 'chat', ch, from: p.name, fid: p.id, text, at: now };
      g.chat[ch].push(msg); if (g.chat[ch].length > 50) g.chat[ch].shift();
      for (const q of g.players.values()) if (chanFor(q) === ch) send(q.ws, msg);
      break;
    }
    case 'voice': {
      const ch = chanFor(p);
      if (!g.cfg.voice || !ch || g.phase === 'lobby' || (p.role === 'hunter' && !g.cfg.huntersTalk)) return err('Voice is not available.');
      const room = `scurry-${g.code}-${ch}`;
      const token = livekitToken(room, p.id, p.name, p.muted);
      if (!token) return err('Voice server is not configured (set LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET).');
      send(ws, { t: 'voice', url: process.env.LIVEKIT_URL, token, room });
      break;
    }
  }
}

server.listen(PORT, () => console.log(`Scurry Live on http://localhost:${PORT}`));
