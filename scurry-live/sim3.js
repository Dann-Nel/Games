'use strict';
// Visibility rule check: hunters see a runner only at a ping (last-ping position, frozen between pings),
// or live while that runner is outside the zone. Run against a live server: node sim3.js
const WebSocket = require('ws');
const URL = process.env.URL || 'ws://localhost:3000';
const C = { lat: -33.8688, lng: 151.2093 };
const PING = 6;
const fail = [];
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fail.push(msg); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const at = (m, dir) => ({ lat: C.lat + (m * Math.cos(dir)) / 111320, lng: C.lng + (m * Math.sin(dir)) / (111320 * Math.cos(C.lat * Math.PI / 180)) });

function bot(name, pref) {
  const ws = new WebSocket(URL), b = { ws, name, pref, state: null, events: [], code: null };
  b.send = o => ws.readyState === 1 && ws.send(JSON.stringify(o));
  ws.on('message', d => {
    const m = JSON.parse(d);
    if (m.t === 'joined') b.code = m.code;
    if (m.t === 'state') { if (!m.cfg && b.state) m.cfg = b.state.cfg; b.state = m; }
    if (m.t === 'event') b.events.push(m);
  });
  b.ready = new Promise(r => ws.on('open', r));
  return b;
}

(async () => {
  const host = bot('Hunter', 'hunter'); await host.ready;
  host.send({ t: 'create', name: 'Hunter', consent: true, cfg: { hideSecs: 1, hold: 300, shrink: 10, radius: 400, stages: 2, huntSecs: 300,
    pingEvery: PING, drops: false, bounty: false, hunterRatio: 0.2, maxSpeed: 0, outsideGrace: 300, gpsStaleOut: 0 } });
  await wait(300);
  const code = host.code;
  const runners = ['R1', 'R2', 'R3', 'R4'].map(n => bot(n, 'runner'));
  await Promise.all(runners.map(r => r.ready));
  runners.forEach(r => r.send({ t: 'join', code, name: r.name, consent: true }));
  await wait(600);
  runners.forEach(r => r.send({ t: 'pref', pref: 'runner' }));
  host.send({ t: 'pref', pref: 'hunter' });
  host.send({ t: 'center', lat: C.lat, lng: C.lng });

  const R1 = runners[0], R4 = runners[3];
  let spot = { R1: at(50, 0.5), R2: at(120, 1.5), R3: at(200, 2.5), R4: at(900, 0.2) }; // R4 starts outside the 400 m zone
  const sendAll = () => runners.forEach(r => r.send({ t: 'loc', ...spot[r.name], acc: 8 }));
  sendAll(); host.send({ t: 'loc', ...C, acc: 5 }); await wait(1000);
  host.send({ t: 'start' });
  const loop = setInterval(() => { sendAll(); host.send({ t: 'loc', ...C, acc: 5 }); }, 1000);
  const seen = () => host.state.markers.filter(m => m.name.startsWith('R'));
  const dot = n => host.state.markers.find(m => m.name === n);

  await wait(3500); // hunt began ~1 s after start; first ping is due PING seconds after that
  ok(host.state.phase === 'hunt', 'hunt phase is running');
  ok(!seen().some(m => m.kind === 'ping') && !host.events.some(e => e.kind === 'ping'),
    'before the first ping, hunters see no runner pings');
  ok(!seen().some(m => m.name !== 'R4'), 'before the first ping, hunters see no runner at all except the one outside the zone');
  ok(dot('R4') && dot('R4').kind === 'exposed', 'a runner outside the zone is shown live (exposed)');

  while (!host.events.some(e => e.kind === 'ping')) await wait(200);
  await wait(1300);
  ok(['R1', 'R2', 'R3'].every(n => dot(n) && dot(n).kind === 'ping'), 'after the ping, hunters see every runner inside the zone as a ping dot');
  const first = { lat: dot('R1').lat, lng: dot('R1').lng, t: dot('R1').t };

  spot.R1 = at(250, 0.5); sendAll();                // R1 sprints 200 m
  await wait(2500);                                  // still before the next ping
  ok(dot('R1').lat === first.lat && dot('R1').lng === first.lng && dot('R1').t === first.t,
    'between pings the dot does not follow the runner (it stays at the last ping position)');

  const before = host.events.filter(e => e.kind === 'ping').length;
  while (host.events.filter(e => e.kind === 'ping').length === before) await wait(200);
  await wait(1300);
  ok(Math.abs(dot('R1').lat - first.lat) > 0.0005 && dot('R1').t > first.t, 'at the next ping the dot jumps to the runner\'s new position');

  clearInterval(loop);
  console.log(fail.length ? `\n${fail.length} FAILED` : '\nALL PASSED');
  [host, ...runners].forEach(b => b.ws.close());
  process.exit(fail.length ? 1 : 0);
})();
