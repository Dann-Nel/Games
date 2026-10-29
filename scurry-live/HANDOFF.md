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
- Simplified lobby: presets (Quick / Classic / Big) plus five essentials (round length, head start, pings, play zone + size, when tagged). Everything else, including hunters-can-talk, zone hold time, GPS/anti-cheat and bounty/drops, is under "More options" (host only). Guests see a one-line summary of the host's rules.

## Update (themes + preview)
- Three themes via CSS variables on `<html data-theme>`: Ember (black/grey, red-orange), Neon (black, lime + magenta), Outdoor (white, high contrast, for sunlight). Picker on the home screen and in the lobby; choice saved per phone (old "dark"/"light" values map to ember/outdoor). Map markers, zone and HUD read the theme variables (`T('--ok')` etc). Dark themes darken standard OSM tiles with a CSS filter (CARTO dark tiles now need an API key).
- Own-location dot is red with a white ring and slow pulse; exposed runners flash orange; selected buttons fill with the accent; HUD has a role-coloured strip (runner green, hunter red).
- Preview: open `/?preview`. Shows Home, Lobby (host/guest), Runner, Hunter, Tagged-watching and Game over with sample data, a theme switcher and a test alert. No server, GPS or hosting needed.

## Update (dialogs + bottom bar)
- No more browser alert/confirm/prompt: `ask.confirm / notice / choose / code` bottom-sheet dialogs (Escape or backdrop = cancel). Toasts now work in the lobby too (they replace the old lobby alert()).
- Bottom bar: primary row (I've been tagged / Use item / Rematch) above four icon buttons: Chat, Voice, More, SOS (red, set apart, confirm dialog). "More" sheet holds the runner's backup code, hunter's manual code entry, Host controls and the theme picker. Chat shows a dot for unread; Voice turns accent when the mic is live. Hunters see no Chat/Voice when "hunters can talk" is off.
- Preview (`/?preview`) can open the SOS dialog, report dialog and More sheet.

## Update (live zone map in the lobby)
- The lobby now has a zone-preview map beside the settings (sticky at the top on phones, right column on wide screens). Solid ring = starting size (updates as Zone size / Style presets change), dashed = final size, green = safe spots, label shows the radius. Host taps the map to move the centre; guests see it read-only. The Leaflet node is kept across lobby re-renders (no flicker); it only refits when the ring leaves the view or gets tiny. "Add safe spot" / "Clear spots" are under More options.

## Update (performance pass)
Measured with 70 bots and a 4x-throttled phone CPU (before -> after):
- In-game redraw: 271 ms median (557 worst) -> 6 ms (93 worst). Cause: every second the client destroyed and rebuilt every marker/ring, and read computed CSS per marker. Now markers update in place, canvas renderer, theme colours cached, redraws throttled.
- Server -> phones: 551 KB/s -> 285 KB/s for 70 players. Settings (cfg) only sent when changed, coordinates rounded to 6 dp, identical state messages skipped (4 s keep-alive), other players' positions refreshed every 2 s. Static files are gzipped (index.html 56 KB -> 19 KB).
- Server CPU is not the bottleneck (2-3% of a core at 70 players).
- Smooth mode (default, toggle in More): dims map tiles by opacity instead of the per-tile invert filter (which cost ~40% of pan frame rate) and disables pulse animations.
- GPS: poor-accuracy fixes now count as "signal alive" (no false "no GPS" / elimination); if no good fix for 20 s the best available fix is used; client falls back to low-accuracy positioning on GPS timeout.
- Connection: "Reconnecting..." banner, exponential backoff, instant reconnect when the app returns to the foreground or the network comes back. Service worker caches map tiles and the Leaflet/LiveKit libraries.
- Clients must treat `cfg` as optional in `state` messages and compute clock skew on arrival (`m.skew`).
- Deploy: render.yaml now sets region: frankfurt. Render free instances sleep after ~15 min idle (30-60 s cold start): ping /healthz every 5 min with a free uptime monitor before an event.

## Update (native Android app)
- `scurry-live/app/`: Capacitor 7 shell (appId live.scurry.app) that loads SCURRY_URL, with @capacitor-community/background-geolocation (Android foreground service of type location). Built and verified here (debug APK ~5 MB; manifest has FINE/COARSE location, FOREGROUND_SERVICE(+_LOCATION), POST_NOTIFICATIONS). Kept in its own folder so Render's server install stays light.
- Web client: `NATIVE`/`BG` in index.html use the plugin when `window.Capacitor` is native; browser path unchanged. Native skips the screen wake lock and the "was in background" banner. Verified with a mocked plugin (locations reach the server; removeWatcher on stop).
- CI: `.github/workflows/android-apk.yml` builds the APK in GitHub Actions (needs repo variable SCURRY_URL). README in app/ explains install steps.
- NOT verified: behaviour on a real phone with the screen locked (WebView JS + WebSocket staying alive in background is the open risk), Play Store release, iOS (needs Mac + Apple account).
- Sandbox note: repo.maven.apache.org returned 429 here; local builds used a Google mirror via ~/.gradle/init.d/mirror.gradle (not committed; CI uses normal Maven Central).
