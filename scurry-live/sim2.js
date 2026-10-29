'use strict';
// Safety + fairness checks against a running server: consent, anti-cheat, GPS loss, SOS, moderation, data wipe.
const WebSocket = require('ws');
const URL = process.env.URL || 'ws://localhost:3000';
const C = { lat: -33.8688, lng: 151.2093 };
const fail = [];
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fail.push(msg); };
const wait = ms => new Promise(r => setTimeout(r, ms));

function bot(i, pref) {
  const ws = new WebSocket(URL), b = { ws, i, pref, state: null, events: [], chats: [], errors: [], sos: [], kicked: false, code: null };
  b.send = o => ws.readyState === 1 && ws.send(JSON.stringify(o));
  ws.on('message', d => {
    const m = JSON.parse(d);
    if (m.t === 'joined') b.code = m.code;
    if (m.t === 'state') b.state = m;
    if (m.t === 'event') b.events.push(m);
    if (m.t === 'chat') b.chats.push(m);
    if (m.t === 'error') b.errors.push(m.text);
    if (m.t === 'sos') b.sos.push(m);
    if (m.t === 'kicked') b.kicked = true;
  });
  b.ready = new Promise(r => ws.on('open', r));
  return b;
}
const evText = (b, re) => b.events.some(e => re.test(e.text));

(async () => {
  // ---- consent ----
  const nc = bot(90, 'random'); await nc.ready;
  nc.send({ t: 'create', name: 'NoConsent' }); await wait(300);
  ok(nc.errors.some(e => /consent/i.test(e)) && !nc.code, 'create without consent is refused: ' + nc.errors[0]);

  const host = bot(0, 'hunter'); await host.ready;
  host.send({ t: 'create', name: 'Host', consent: true, cfg: { hideSecs: 1, hold: 120, shrink: 10, radius: 500, stages: 2, huntSecs: 300,
    pingEvery: 600, drops: false, bounty: false, hunterRatio: 0.2, gpsStaleWarn: 3, gpsStaleOut: 12, maxAccuracy: 50, maxSpeed: 15, outsideGrace: 200 } });
  await wait(300);
  const code = host.code; ok(!!code, 'game created with consent: ' + code);
  nc.send({ t: 'join', code, name: 'NoConsent' }); await wait(300);
  ok(nc.errors.length > 1 && !nc.code, 'join without consent is refused');
  nc.ws.close();

  const bots = [host];
  for (let i = 1; i <= 9; i++) bots.push(bot(i, i === 1 ? 'hunter' : 'runner'));
  await Promise.all(bots.map(b => b.ready));
  bots.slice(1).forEach(b => b.send({ t: 'join', code, name: 'P' + b.i, consent: true, cid: 'dev' + b.i }));
  await wait(600);
  bots.forEach(b => b.send({ t: 'pref', pref: b.pref }));
  // a kick is a ban: the same device cannot rejoin
  const troll = bot(77, 'random'); await troll.ready;
  troll.send({ t: 'join', code, name: 'Troll', consent: true, cid: 'banme' }); await wait(1400);
  host.send({ t: 'kick', id: host.state.players.find(p => p.name === 'Troll').id }); await wait(400);
  ok(troll.kicked, 'host kicked a lobby player');
  troll.errors.length = 0; troll.send({ t: 'join', code, name: 'Troll2', consent: true, cid: 'banme' }); await wait(400);
  ok(troll.errors.some(e => /removed/i.test(e)), 'kicked device cannot rejoin: ' + troll.errors[0]);
  troll.ws.close();
  host.send({ t: 'center', lat: C.lat, lng: C.lng });
  bots.filter(b => b.i !== 8).forEach(b => b.send({ t: 'loc', ...C }));   // bot 8 (X) has no fix yet, so its first fix can be far away
  await wait(1100);
  host.send({ t: 'start' });
  const t0 = Date.now();
  await wait(1500);
  const [, hunter2, R, S, Q, T, Y, Z, X] = bots;
  ok(host.state.you.role === 'hunter' && hunter2.state.you.role === 'hunter', 'host and bot1 are the two hunters');
  ok(R.state.you.role === 'runner', 'bot 2 is a runner');
  ok(host.state.roster && host.state.roster.length === 10 && host.state.roster.every(r => !('role' in r)), 'host roster lists everyone without roles');
  ok(!R.state.roster, 'non-host gets no roster');

  // everyone except the actors under test keeps a fresh fix
  const keep = bots.filter(b => ![R, S, Q, X].includes(b));
  const loop = setInterval(() => keep.forEach(b => b.send({ t: 'loc', ...C })), 1000);
  S.send({ t: 'loc', ...C });                                           // S sends once, then goes silent
  X.send({ t: 'loc', lat: C.lat + 0.045, lng: C.lng });                 // X's first fix is 5 km away (accepted: no prior fix)
  const exposed = () => hunter2.state.markers.some(m => m.id === R.state.you.id && m.kind === 'exposed');

  // ---- anti-cheat: teleport ----
  await wait(1100);
  R.send({ t: 'loc', ...C }); await wait(1100);
  const far = { lat: C.lat + 0.02, lng: C.lng };                        // ~2.2 km
  for (let i = 0; i < 4; i++) { R.send({ t: 'loc', ...far, acc: 12 }); await wait(1100); }
  ok(!exposed() && !evText(host, /suspicious/i), 'first 4 teleport fixes are rejected (runner not shown outside zone, host not alerted)');
  R.send({ t: 'loc', ...far, acc: 12 }); await wait(1500);
  ok(exposed(), 'persistent jump is accepted on the 5th fix (runner now exposed outside the zone)');
  const dot = hunter2.state.markers.find(m => m.id === R.state.you.id);
  ok(dot && dot.acc === 12, 'the dot hunters see carries its GPS accuracy (' + (dot && dot.acc) + ' m)');
  ok(evText(host, /suspicious/i), 'host alerted to the suspicious jump: ' + (host.events.find(e => /suspicious/i.test(e.text)) || {}).text);

  ok(host.state.roster.find(r => r.id === S.state.you.id).stale > 0, 'host roster shows the stale player');

  // ---- anti-cheat: poor accuracy ----
  Q.send({ t: 'loc', ...C }); await wait(1100);
  for (let i = 0; i < 3; i++) { Q.send({ t: 'loc', ...C, acc: 500 }); await wait(1000); }
  await wait(300);
  ok(evText(Q, /accuracy/i), 'low-accuracy fixes ignored and player warned: ' + (Q.events.find(e => /accuracy/i.test(e.text)) || {}).text);

  // ---- GPS loss ----
  ok(evText(S, /No GPS/i), 'silent player got a no-GPS warning');
  ok(evText(host, /has no GPS/i), 'host was told who has no GPS: ' + (host.events.find(e => /has no GPS/i.test(e.text)) || {}).text);
  // ---- SOS ----
  T.send({ t: 'sos' }); await wait(700);
  ok(host.sos.length === 1 && host.sos[0].name === 'P5' && host.sos[0].lat != null, 'SOS reaches the host with a location');
  ok(hunter2.sos.length === 1, 'SOS reaches a nearby player');
  ok(X.sos.length === 0, 'SOS does not reach a player 5 km away');
  T.errors.length = 0; T.send({ t: 'sos' }); await wait(300);
  ok(T.errors.some(e => /already sent/i.test(e)), 'repeat SOS is rate-limited');

  // ---- moderation ----
  host.send({ t: 'mute', id: Y.state.you.id, on: true }); await wait(400);
  Y.errors.length = 0; Y.send({ t: 'chat', text: 'hello' }); await wait(500);
  ok(Y.errors.some(e => /muted/i.test(e)), 'muted player cannot chat: ' + Y.errors[0]);
  host.send({ t: 'mute', id: Y.state.you.id, on: false }); await wait(400);
  Y.errors.length = 0; Y.send({ t: 'chat', text: 'hello again' }); await wait(500);
  ok(Y.errors.length === 0, 'unmuted player can chat again');
  Z.send({ t: 'kick', id: Y.state.you.id }); await wait(500);
  ok(!Y.kicked, 'non-host cannot kick');
  host.send({ t: 'kick', id: Z.state.you.id }); await wait(700);
  ok(Z.kicked, 'host can kick a player');
  ok(host.state.roster.length === 9, 'kicked player removed from the game');

  // ---- GPS loss elimination (runner silent for gpsStaleOut seconds) ----
  await wait(Math.max(0, 15000 - (Date.now() - t0)));
  ok(S.state.you.out === true, 'runner with no GPS for 12 s is eliminated');
  clearInterval(loop);

  // ---- review fixes ----
  const HTTP = URL.replace(/^ws/, 'http');
  const bad = await fetch(HTTP + '/%').then(r => r.status).catch(() => 0);
  const bad2 = await fetch(HTTP + '/%00').then(r => r.status).catch(() => 0);
  const alive = await fetch(HTTP + '/healthz').then(r => r.status).catch(() => 0);
  ok(bad === 400 && bad2 === 400 && alive === 200, `malformed URLs get 400 and the server stays up (${bad}, ${bad2}, ${alive})`);

  const W = bots[9], wasSus = host.events.filter(e => /P9: suspicious/.test(e.text)).length;
  W.send({ t: 'loc', ...C }); await wait(1100);
  for (let i = 0; i < 8; i++) W.send({ t: 'loc', lat: C.lat + 0.03, lng: C.lng });   // 8 far fixes in one burst
  await wait(500);
  ok(host.events.filter(e => /P9: suspicious/.test(e.text)).length === wasSus, 'a burst of teleport fixes does not skip the 5-fix wait');

  hunter2.errors.length = 0;
  hunter2.send({ t: 'tag', code: '0000' }); await wait(300);
  const wrong = hunter2.errors[0] || '';
  hunter2.send({ t: 'tag', code: '0001' }); await wait(300);
  ok(/not accepted/i.test(wrong) && !/safe spot|too far|\(\d+ m\)|no runner|too old/i.test(wrong), 'a wrong tag code gets one uninformative error: ' + wrong);
  ok(hunter2.errors.some(e => /slow down/i.test(e)), 'tag attempts are throttled to one per 2 s');
  await wait(2100);
  hunter2.errors.length = 0; hunter2.send({ t: 'tag', code: T.state.you.tagCode }); await wait(1500);
  ok(hunter2.errors.length === 0 && T.state.you.out === true, 'a correct code within range still tags the runner');

  // ---- end game + data wipe ----
  T.send({ t: 'end' }); await wait(300);
  ok(host.state.phase !== 'over', 'non-host cannot end the game');
  host.send({ t: 'end' }); await wait(1600);
  ok(host.state.phase === 'over' && host.state.winner === 'none', 'host can end the game');
  ok(bots.filter(b => b !== Z).every(b => b.state.markers.length === 0), 'no player locations remain after the game ends');
  hunter2.send({ t: 'loc', ...C }); await wait(1200);
  ok(hunter2.state.markers.length === 0, 'location updates after game end are ignored');

  console.log(fail.length ? `\n${fail.length} FAILED` : '\nALL PASSED');
  bots.forEach(b => b.ws.close());
  process.exit(fail.length ? 1 : 0);
})();
