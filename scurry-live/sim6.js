// Poor-GPS handling + message dedupe. Server must be running.
const WebSocket = require('ws'); const PORT = process.env.PORT || 3000; let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const wait = ms => new Promise(r => setTimeout(r, ms));
function bot() { return new Promise(res => { const ws = new WebSocket('ws://localhost:' + PORT), b = { ws, msgs: [], state: null, id: null, states: 0 };
  ws.on('message', d => { const m = JSON.parse(d); b.msgs.push(m); if (m.t === 'state') { b.states++; if (!m.cfg && b.state) m.cfg = b.state.cfg; b.state = m; } if (m.t === 'joined') { b.id = m.id; b.code = m.code; } });
  ws.on('open', () => res(b)); b.send = o => ws.send(JSON.stringify(o)); }); }
(async () => {
  const h = await bot(), a = await bot();
  h.send({ t: 'create', name: 'Host', consent: true, cfg: { hideSecs: 1, huntSecs: 600, pingEvery: 600, gpsStaleWarn: 3, gpsStaleOut: 0, maxAccuracy: 50 } }); await wait(200);
  a.send({ t: 'join', code: h.code, name: 'Al', consent: true }); await wait(1500);
  const first = h.msgs.filter(m => m.t === 'state'); ok(first.length && first[0].cfg, 'first state carries the settings');
  const before = h.states; await wait(5500);
  const sent = h.states - before; ok(sent <= 3, `idle lobby is deduped: ${sent} state messages in 5.5 s (was ~5)`);
  ok(h.msgs.filter(m => m.t === 'state').slice(1).every(m => m.cfg === undefined || m.cfg), 'later states omit unchanged settings');
  h.send({ t: 'center', lat: 51.5, lng: -0.1 }); await wait(150); h.send({ t: 'pref', pref: 'hunter' }); a.send({ t: 'pref', pref: 'runner' }); await wait(200);
  h.send({ t: 'start' }); await wait(2500);
  const runner = a.state.you.role === 'runner' ? a : h;
  // only poor fixes (120 m): while a good fix is recent they are ignored, but they still count as "signal alive"
  runner.send({ t: 'loc', lat: 51.5, lng: -0.1, acc: 10 }); await wait(1000);
  runner.send({ t: 'loc', lat: 51.5003, lng: -0.1, acc: 120 }); await wait(1200);
  ok(!runner.state.you.stale, 'poor fixes keep the player from being flagged "no GPS"');
  ok(!runner.state.you.stale, 'still not stale after only-poor fixes');
  console.log(fails ? '\nFAILED ' + fails : '\nALL PASSED'); process.exit(fails ? 1 : 0);
})();
