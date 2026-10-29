# Scurry Live: handoff

Real-life hide-and-seek for up to 70 players. Original game (not a copy of scramhideandseek.com). Node WebSocket server + single-page phone web app (PWA-style, works on iPhone via Safari "Add to Home Screen").

## Run
    npm install
    npm start            # http://localhost:3000
    node sim.js / sim2.js / sim3.js   (server must be running)
Geolocation needs HTTPS on real phones (localhost is fine for testing).
Voice (optional): set LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET. Untested without an account.

## Files
- server.js: all game logic (in-memory games, WebSocket + static files)
- public/index.html: the whole client (Leaflet map from cdnjs with integrity hashes)
- RULES.md: recommended game rules + safety/privacy
- sim.js (70 bots, gameplay), sim2.js (safety/anti-cheat/moderation), sim3.js (ping-visibility rule): all passing at last run

## Decisions (do not re-litigate)
- Tagging is PHYSICAL. A tagged runner taps "I've been tagged: I'm out". The 4-digit code is only a dispute backup (server checks GPS within 25 m, refuses in safe spot, throttled 1 per 2 s, 5 wrong = 60 s lockout, uniform vague error).
- Hunters see runners ONLY at pings (host sets "Ping every (s)", default 90) or live while a runner is outside the zone. Dots are frozen between pings.
- Bounty ping and supply drops/power-ups (decoy, ghost, radar) are OFF by default (they reveal runners outside the ping schedule). Host can enable in lobby.
- Roles: Runner / Hunter / Random preference; hunters ~15% (host-adjustable). Caught runners become hunters (host-adjustable).
- Shrinking circular zone with next-zone preview; outside zone = exposed, eliminated after grace (default 30 s).
- Match code: 4 letters; join link ?code=ABCD fills it in.
- Safety: consent required, SOS, no-GPS detection, anti-cheat (accuracy 50 m, speed 15 m/s, accept after 5 persistent fixes + flag), host mute/kick (ban per device id)/end, host roster hides roles, all locations wiped at game end.

## Review fixes already applied (11 confirmed by adversarial review)
tag-code oracle/brute force, burst teleport bypass, malformed-URL crash, name XSS in map tooltips, mute vs live voice, kick-as-ban, stale-out < warn, GPS alert spam, SOS marker carry-over.

## Known limits / not built
- Web app only tracks location while open and screen on (iOS). Native wrapper (Capacitor) would fix; needs a Mac + Apple developer account.
- No mock-location detection on the web. Games are in memory (restart wipes them).
- Not built: abuse reports, guardian mode (under 16), road/water zone restriction, roles (medic/scout/squads), custom boundary, recap/awards, quick-chat, push-to-talk, stats, spectator mode.
- Untested on real phones/GPS. Voice untested. Runner in-game screen never screenshotted.

## Next (suggested)
1. Fix faint HUD status text and overlapping dot labels on the map; show the runner's screen.
2. Hosting (HTTPS) + LiveKit setup.
3. Optional features above.

## Update (cross-platform pass)
- Installable on both iOS and Android: PNG icons, maskable icon, apple-touch-icon, service worker (sw.js), full manifest.
- Abuse reports: players tap "report" next to a chat message; host sees them in the Host panel (`report` message, sim4.js).
- Background warning: if the app was hidden >8 s the player sees a banner and a fresh GPS fix is requested.
- Deploy: root `render.yaml` (Render blueprint, free tier gives HTTPS). Free tier sleeps when idle and wipes games on restart.
- Phones: Android Chrome menu -> Install app. iPhone Safari Share -> Add to Home Screen. Both must keep the app open with the screen on.

## Update (lobby pass, modelled on the lobby screenshots the user shared)
- Lobby rebuilt: minute steppers (round length, pings, head start, zone size, shrink interval), toggles (hunters can talk, play zone), "when tagged" = join hunters or Watch (spectate N s behind, default 60), Copy/Change game code, Hosting badge, Ready status per player, Invite friends, Light/Dark appearance, summary line for the shrink schedule. Old numeric fields live under "Advanced rules".
- Server: cfg.taggedMode ('hunter'|'watch'), watchDelay, zoneOn, huntersTalk; messages `ready`, `newcode`. Spectators only receive delayed positions (per-player history kept 5.5 min, wiped at game end).
- sim5.js covers these. All of sim, sim2-sim5 pass.
