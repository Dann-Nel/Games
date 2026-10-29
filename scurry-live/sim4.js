// Abuse reports + installability assets. Server must be running.
const WebSocket = require('ws'); const http = require('http');
const PORT = process.env.PORT || 3000; let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const wait = ms => new Promise(r => setTimeout(r, ms));
function bot() { return new Promise(res => { const ws = new WebSocket('ws://localhost:' + PORT), b = { ws, msgs: [], state: null, id: null };
  ws.on('message', d => { const m = JSON.parse(d); b.msgs.push(m); if (m.t === 'state') b.state = m; if (m.t === 'joined') { b.id = m.id; b.code = m.code; } });
  ws.on('open', () => res(b)); b.send = o => ws.send(JSON.stringify(o)); }); }
const get = p => new Promise(r => http.get('http://localhost:' + PORT + p, x => { let n = 0; x.on('data', c => n += c.length); x.on('end', () => r({ s: x.statusCode, type: x.headers['content-type'], n })); }));
(async () => {
  for (const [p, t] of [['/icon-192.png', 'image/png'], ['/icon-512.png', 'image/png'], ['/apple-touch-icon.png', 'image/png'], ['/sw.js', 'text/javascript'], ['/manifest.webmanifest', 'application/manifest+json']]) {
    const r = await get(p); ok(r.s === 200 && r.type === t && r.n > 50, `${p} served as ${t}`); }
  const h = await bot(), a = await bot(), c = await bot();
  h.send({ t: 'create', name: 'Host', consent: true, cfg: { hideSecs: 1, huntSecs: 600 } }); await wait(200);
  a.send({ t: 'join', code: h.code, name: 'Alice', consent: true }); c.send({ t: 'join', code: h.code, name: 'Cara', consent: true }); await wait(200);
  h.send({ t: 'center', lat: 51.5, lng: -0.1 }); await wait(100); h.send({ t: 'start' }); await wait(1500);
  a.send({ t: 'report', id: c.id, reason: 'abuse' }); await wait(1300);
  ok(h.msgs.some(m => m.t === 'event' && /Report: Cara \(abuse\)/.test(m.text)), 'host is notified of a report');
  ok(h.state.reports && h.state.reports.length === 1 && h.state.reports[0].aboutName === 'Cara', 'host state lists the report');
  ok(!a.state.reports && !c.state.reports, 'players cannot see reports');
  ok(h.state.roster.find(r => r.id === c.id).reports === 1, 'roster shows report count');
  a.send({ t: 'report', id: c.id, reason: 'abuse' }); await wait(1300);
  ok(a.msgs.some(m => m.t === 'error' && /already reported/.test(m.text)) && h.state.reports.length === 1, 'duplicate report rejected');
  a.send({ t: 'report', id: a.id, reason: 'abuse' }); h.send({ t: 'report', id: a.id, reason: 'abuse' }); await wait(1300);
  ok(h.state.reports.length === 1, 'cannot report yourself; host cannot report');
  console.log(fails ? '\nFAILED ' + fails : '\nALL PASSED'); process.exit(fails ? 1 : 0);
})();
