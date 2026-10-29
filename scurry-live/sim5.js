// Lobby features: ready, change code, hunters-talk, tagged watch mode (delayed), play zone off. Server must be running.
const WebSocket = require('ws'); const PORT = process.env.PORT || 3000; let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const wait = ms => new Promise(r => setTimeout(r, ms));
function bot() { return new Promise(res => { const ws = new WebSocket('ws://localhost:' + PORT), b = { ws, msgs: [], state: null, id: null };
  ws.on('message', d => { const m = JSON.parse(d); b.msgs.push(m); if (m.t === 'state') b.state = m; if (m.t === 'joined') { b.id = m.id; b.code = m.code; } });
  ws.on('open', () => res(b)); b.send = o => ws.send(JSON.stringify(o)); }); }
(async () => {
  const h = await bot(), a = await bot();
  h.send({ t: 'create', name: 'Host', consent: true, cfg: { hideSecs: 1, huntSecs: 600, taggedMode: 'watch', watchDelay: 3, zoneOn: false, huntersTalk: false, pingEvery: 600 } }); await wait(200);
  const old = h.code; a.send({ t: 'join', code: old, name: 'Al', consent: true }); await wait(1300);
  ok(h.state.cfg.taggedMode === 'watch' && h.state.cfg.caughtJoinHunters === false && h.state.cfg.zoneOn === false && h.state.cfg.huntersTalk === false, 'new config options are stored');
  ok(h.state.players.find(p => p.host).ready === true && a.state.players.find(p => p.id === a.id).ready === false, 'host counts as ready, joiner starts not ready');
  a.send({ t: 'ready', on: true }); await wait(1300);
  ok(h.state.players.find(p => p.id === a.id).ready === true, 'player can ready up');
  a.send({ t: 'newcode' }); h.send({ t: 'newcode' }); await wait(1300);
  ok(h.code !== old && a.code === h.code, 'only the host can change the code, and everyone moves to it');
  const late = await bot(); late.send({ t: 'join', code: old, name: 'Late', consent: true }); await wait(300);
  ok(late.msgs.some(m => m.t === 'error' && /No game/.test(m.text)), 'old code stops working');
  h.send({ t: 'center', lat: 51.5, lng: -0.1 }); await wait(100); h.send({ t: 'pref', pref: 'runner' }); a.send({ t: 'pref', pref: 'hunter' }); await wait(100);
  h.send({ t: 'start' }); await wait(2500);
  ok(h.state.phase === 'hunt', 'game reached hunt phase');
  const hunter = a.state.you.role === 'hunter' ? a : h, runner = hunter === a ? h : a;
  hunter.send({ t: 'chat', text: 'hi' }); await wait(300);
  ok(hunter.msgs.some(m => m.t === 'error' && /Hunter chat is turned off/.test(m.text)), 'hunters cannot chat when turned off');
  // far outside the old zone: with no play zone the runner must not be exposed
  runner.send({ t: 'loc', lat: 51.52, lng: -0.1, acc: 5 }); hunter.send({ t: 'loc', lat: 51.5, lng: -0.1, acc: 5 }); await wait(1500);
  ok(!runner.state.you.exposed && !runner.state.you.outsideSince, 'no play zone: nobody is exposed outside it');
  // move the runner and record positions, then tag them out
  runner.send({ t: 'loc', lat: 51.52, lng: -0.1, acc: 5 }); await wait(1000);
  runner.send({ t: 'caught' }); await wait(1300);
  ok(runner.state.you.role === 'spectator', 'tagged runner becomes a spectator in watch mode');
  runner.send({ t: 'loc', lat: 51.52, lng: -0.1, acc: 5 }); hunter.send({ t: 'loc', lat: 51.5001, lng: -0.1, acc: 5 }); await wait(1100);
  hunter.send({ t: 'loc', lat: 51.5, lng: -0.1, acc: 5 }); await wait(1300);
  const hm = runner.state.markers.find(m => m.id === hunter.id);
  ok(!hm || Math.abs(hm.lat - 51.5) < 0.0003 && hm.kind === 'watch', 'spectator sees others only as delayed "watch" markers');
  ok(runner.state.markers.every(m => m.kind === 'watch'), 'spectator markers are all delayed');
  console.log(fails ? '\nFAILED ' + fails : '\nALL PASSED'); process.exit(fails ? 1 : 0);
})();
