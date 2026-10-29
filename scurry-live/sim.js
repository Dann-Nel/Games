'use strict';
// Smoke test: 70 bots play a fast game against a running server (npm start, then npm run sim).
const WebSocket = require('ws');
const URL = process.env.URL || 'ws://localhost:3000';
const C = { lat: -33.8688, lng: 151.2093 };
const N = 70, fail = [];
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fail.push(msg); };
const wait = ms => new Promise(r => setTimeout(r, ms));

function bot(i, pref) {
  const ws = new WebSocket(URL), b = { ws, i, pref, state: null, events: [], chats: [], errors: [], code: null };
  b.send = o => ws.readyState === 1 && ws.send(JSON.stringify(o));
  ws.on('message', d => {
    const m = JSON.parse(d);
    if (m.t === 'joined') b.code = m.code;
    if (m.t === 'state') { if (!m.cfg && b.state) m.cfg = b.state.cfg; b.state = m; }
    if (m.t === 'event') b.events.push(m);
    if (m.t === 'chat') b.chats.push(m);
    if (m.t === 'fix') b.fixes = (b.fixes || 0) + 1;
    if (m.t === 'error') b.errors.push(m.text);
  });
  b.ready = new Promise(r => ws.on('open', r));
  return b;
}
const jitter = r => ({ lat: C.lat + (Math.random() - .5) * r / 55000, lng: C.lng + (Math.random() - .5) * r / 90000 });

(async () => {
  const host = bot(0, 'hunter'); await host.ready;
  host.send({ t: 'create', name: 'Host', consent: true, cfg: { bounty: true, drops: true, maxSpeed: 0, gpsStaleOut: 0, hideSecs: 2, hold: 4, shrink: 3, pingEvery: 3, huntSecs: 120, dropEvery: 10, bountyAt: 3, bountyEvery: 5, safeSecs: 60, stages: 2, radius: 300, outsideGrace: 4, hunterRatio: 0.1, tagRange: 25 } });
  await wait(300);
  const code = host.code; ok(!!code, `game created: ${code}`);
  const bots = [host];
  for (let i = 1; i < N; i++) bots.push(bot(i, ['runner', 'hunter', 'random'][i % 3]));
  await Promise.all(bots.map(b => b.ready));
  bots.slice(1).forEach(b => b.send({ t: 'join', code, consent: true, name: 'P' + b.i }));
  await wait(800);
  host.send({ t: 'pref', pref: 'hunter' });
  bots.slice(1).forEach(b => b.send({ t: 'pref', pref: b.pref }));
  await wait(1500);
  ok(host.state && host.state.players.length === 70, `lobby shows ${host.state && host.state.players.length} players`);
  const over = bot(100, 'random'); await over.ready; over.send({ t: 'join', code, consent: true, name: 'over' }); await wait(300);
  ok(over.errors.some(e => /full/i.test(e)), 'player #71 rejected: ' + over.errors[0]);
  over.ws.close();

  host.send({ t: 'center', lat: C.lat, lng: C.lng });
  host.send({ t: 'spot', lat: C.lat + 0.0004, lng: C.lng });
  bots.forEach(b => b.send({ t: 'loc', ...jitter(200) }));
  await wait(1200);
  host.send({ t: 'start' });
  await wait(1500);
  const roles = bots.map(b => b.state && b.state.you.role);
  const H = roles.filter(r => r === 'hunter').length, Rr = roles.filter(r => r === 'runner').length;
  ok(H + Rr === N && H >= 1, `roles assigned: ${H} hunters, ${Rr} runners`);
  ok(bots.filter(b => b.state.you.role === 'hunter').every(b => b.pref === 'hunter'), 'all hunters came from the hunter-preference pool (cap respected)');
  ok(bots.filter(b => b.pref === 'runner' && b.state.you.role === 'hunter').length === 0, 'nobody who chose runner was drafted as hunter');

  const runners = bots.filter(b => b.state.you.role === 'runner'), hunters = bots.filter(b => b.state.you.role === 'hunter');
  const outside = runners.slice(0, 5);
  const loop = setInterval(() => bots.forEach(b => b.send({ t: 'loc', ...(outside.includes(b) ? { lat: C.lat + 0.02, lng: C.lng } : jitter(150)) })), 1000);
  await wait(6000);
  const h = hunters[0].state;
  ok(h.phase === 'hunt', 'phase moved hide -> hunt');
  ok(hunters.every(x => x.events.some(e => e.kind === 'ping')), 'hunters received PING events');
  ok(bots.every(x => x.fixes > 0), 'every phone was asked for a fresh GPS fix before a ping');
  const seen = h.markers.filter(m => m.kind === 'exposed' || m.kind === 'ping');
  ok(seen.length > 0, `hunter sees ${seen.length} runner markers (ping/exposed)`);
  const rs = runners[10].state;
  ok(rs.markers.every(m => m.kind === 'ally' && runners.some(r => r.state.you.id === m.id)), 'runner map holds only runner allies (no hunters)');
  ok(h.zone.next && h.zone.cur.r <= 300, `zone present, r=${Math.round(h.zone.cur.r)}m, next=${h.zone.next && Math.round(h.zone.next.r)}m`);
  await wait(4000);
  ok(outside.every(b => b.state.you.out), 'runners outside zone were eliminated after grace');

  const prey = runners.find(b => !b.state.you.out && b.state.you.tagCode);
  if (prey) {
    const hx = hunters[1] || hunters[0];
    clearInterval(loop); await wait(1100);
    prey.send({ t: 'loc', lat: C.lat, lng: C.lng }); hx.send({ t: 'loc', lat: C.lat + 0.00005, lng: C.lng });
    await wait(1200);
    hx.errors.length = 0; hx.send({ t: 'tag', code: prey.state.you.tagCode }); await wait(1200);
    ok(hx.errors.length === 0, 'tag within range accepted' + (hx.errors[0] ? ': ' + hx.errors[0] : ''));
    ok(prey.state.you.out, 'tagged runner is out');
    hx.send({ t: 'loc', lat: C.lat + 0.01, lng: C.lng }); await wait(1100);
    const prey2 = runners.find(b => !b.state.you.out && b.state.you.tagCode);
    if (prey2) { hx.errors.length = 0; hx.send({ t: 'tag', code: prey2.state.you.tagCode }); await wait(500); ok(hx.errors.length > 0, 'tag out of range rejected: ' + hx.errors[0]); }
  }
  // ---- gameplay: safe spot, supply drops, power-ups ----
  const alive = () => runners.filter(b => b.state.you.role === 'runner' && !b.state.you.out);
  const H2 = hunters[2], spotLoc = { lat: C.lat + 0.0004, lng: C.lng };
  bots.forEach(b => b.send({ t: 'loc', lat: C.lat, lng: C.lng })); await wait(1200);  // park everyone at the centre so random bots don't snap up drops
  const sr = alive().find(b => b.state.you.tagCode);
  sr.send({ t: 'loc', ...spotLoc }); H2.send({ t: 'loc', lat: spotLoc.lat + 0.00005, lng: spotLoc.lng });
  await wait(2500);
  ok(sr.state.you.safe === true, 'runner standing in safe spot is marked safe');
  H2.errors.length = 0; H2.send({ t: 'tag', code: sr.state.you.tagCode }); await wait(500);
  ok(H2.errors.some(e => /not accepted/i.test(e)) && !/safe spot|too far|\(\d+ m\)/i.test(H2.errors[0] || ''), 'tag blocked in safe spot with an uninformative error: ' + H2.errors[0]);
  const waitDrop = async () => { for (let i = 0; i < 30 && !H2.state.drops.length; i++) await wait(500); return H2.state.drops[0]; };
  const d1 = await waitDrop();
  ok(!!d1, 'supply drop spawned inside the zone');
  const rr = alive().find(b => b !== sr);
  if (d1) { rr.send({ t: 'loc', lat: d1.lat, lng: d1.lng }); await wait(2500); ok(['decoy', 'ghost'].includes(rr.state.you.item), 'runner picked up item: ' + rr.state.you.item);
    rr.events.length = 0; rr.send({ t: 'use' }); await wait(1400);
    ok(rr.state.you.item === null && rr.events.some(e => /armed/i.test(e.text)), 'runner used power-up: ' + (rr.events[0] && rr.events[0].text)); }
  const d2 = await waitDrop();
  ok(!!d2, 'second supply drop spawned');
  if (d2) { H2.send({ t: 'loc', lat: d2.lat, lng: d2.lng }); await wait(2500); ok(H2.state.you.item === 'radar', 'hunter picked up radar');
    const near = alive().find(b => b !== sr && b !== rr); near.send({ t: 'loc', lat: d2.lat + 0.0002, lng: d2.lng }); await wait(1200);
    H2.events.length = 0; H2.send({ t: 'use' }); await wait(600);
    ok(H2.events.some(e => /radar found [1-9]/i.test(e.text)), 'radar revealed nearby runners: ' + (H2.events[0] && H2.events[0].text)); }

  hunters[0].send({ t: 'chat', text: 'hunter secret' }); await wait(500);
  ok(hunters[1].chats.some(c => c.text === 'hunter secret'), 'hunter chat reaches hunters');
  ok(!runners.filter(r => r.state.you.role === 'runner').some(r => r.chats.some(c => c.text === 'hunter secret')), 'hunter chat hidden from live runners');
  const self = runners.find(b => !b.state.you.out && b.state.you.role === 'runner');
  if (self) { self.send({ t: 'caught' }); await wait(1300); ok(self.state.you.out, 'runner self-report "I\'ve been caught" eliminates them'); }
  hunters[0].send({ t: 'caught' }); await wait(300);
  ok(hunters[0].state.you.role === 'hunter' && !hunters[0].state.you.out, 'hunter cannot use the caught button');
  hunters[0].send({ t: 'voice' }); await wait(300);
  console.log('voice (unconfigured) ->', hunters[0].errors.slice(-1)[0]);

  // ---- bounty: leave only 3 runners ----
  const left = alive(); left.slice(3).forEach(b => b.send({ t: 'caught' })); await wait(2500);
  hunters[0].events.length = 0; await wait(6500);
  ok(hunters[0].events.some(e => /BOUNTY/.test(e.text)), 'bounty ping fired with 3 runners left: ' + (hunters[0].events.find(e => /BOUNTY/.test(e.text)) || {}).text);

  clearInterval(loop);
  console.log(fail.length ? `\n${fail.length} FAILED` : '\nALL PASSED');
  bots.forEach(b => b.ws.close());
  process.exit(fail.length ? 1 : 0);
})();
