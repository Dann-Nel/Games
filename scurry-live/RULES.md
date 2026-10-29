# Scurry Live: recommended game rules

## The short version
Runners hide. Hunters seek. A zone on the map shrinks like a battle royale. Every ping reveals where runners were. Last runner standing, or the clock, decides it.

## Setup
- **Players:** 6 to 70. Under 10 is a small game, 20 to 70 is the sweet spot.
- **Hunters:** about 15% of players (host can change it). 1 hunter per 6 runners to start. Players choose Runner, Hunter or Random in the lobby. Hunters are picked from the Hunter and Random pools first.
- **Play area:** a public, safe, well-lit space (park, campus, neighbourhood) with a clear boundary. Starting zone radius 500 to 1000 m for a big game, 150 to 300 m for a small one.
- **Teams:** hunters and runners each get a private chat channel and a private voice channel.

## Round flow
1. **Hide phase (default 2 min):** runners spread out and hide. Hunters stay put and can't tag.
2. **Hunt phase:** hunters go. The zone holds, then shrinks in stages.
3. **Pings (default every 90 s):** every runner's position is revealed to hunters as a marker with a "seconds ago" label. Hunters see where runners *were*, not where they are.
4. **End:** hunters win when no runner is left. Runners win if anyone is still free when the timer ends (default 30 min).

## The zone
- A red circle is the safe area. A dashed white circle shows the **next** zone, always inside the current one. Runners and hunters both see it.
- The zone holds (default 4 min), then shrinks over 1 min, 5 times by default (each ring 70% of the last).
- **Outside the zone:** a runner is **exposed**. Hunters see their live position, and they get a warning. After the limit (default 30 s) outside, they're out. Hunters are not penalised for leaving the zone.
- A shrinking zone is what stops runners hiding forever, so don't turn it off for big games.

## Catching a runner
- **It's hide and seek: a hunter catches a runner by physically tagging them** (a light touch on the arm or shoulder).
- **The tagged runner taps "I've been caught" on their phone** straight away and tells the hunter. That takes them out of the game. It's an honour system, like the real thing.
- A runner who is tagged and doesn't report it, runs off after a tag, or hides their phone has forfeited.
- **Backup for disputes:** every runner has a private 4-digit code on their screen. If a runner won't report a tag, the hunter can ask for the code and enter it with "Enter runner's code". The server then checks both players' GPS are within 25 m before accepting it, and refuses it if the runner is in a safe spot. Every failed attempt gets the same vague error (so the code entry can't be used to find runners), attempts are limited to one per 2 s, and five wrong codes lock that hunter out for a minute.
- **Caught runners** become hunters by default (keeps everyone playing). The host can switch this off so they spectate instead.

## Safe spots, bounty and supply drops
**Bounty ping and supply drops are optional extras and are OFF by default.** With them off, the only ways hunters see runners are the scheduled ping (at the interval the host sets) and a runner being outside the zone. Both extras reveal runners outside that schedule, so the host must turn them on in the lobby.
- **Safe spots (green circles):** the host places up to 10 real-world spots (a bench, a tree) in the lobby. A runner inside one can't be tagged (it's "base": hunters must let them be, and the app refuses code-based tags there). Each runner gets a limited total shelter time (default 60 s per game), then the spots stop protecting them. Pings and the zone still apply inside a safe spot.
- **Bounty ping:** when 3 or fewer runners remain (host can change it), those runners are revealed to hunters every 20 s. This keeps the finish tense.
- **Supply drops (purple markers):** every 2 minutes a drop lands inside the zone (up to 3 at once, each lasts 3 minutes). Anyone within 20 m picks it up automatically, and can hold one item at a time. Both teams see drops, so they pull runners out of hiding.
  - **Runners get:** *Decoy* (your next ping shows a fake position 80 to 150 m away) or *Ghost* (you skip your next ping).
  - **Hunters get:** *Radar* (instantly reveals every runner within 150 m of you, and tells all hunters how many it found).
- **"I've been caught":** this is the main way a tag is recorded. After a physical tag the runner taps it (honour system), and then follows the caught-runner rule.

## Information rules (who sees what)
| Player | Sees |
|---|---|
| Runner | Own position, fellow runners (live), zone and next zone |
| Hunter | Fellow hunters (live), runners at last ping, any runner outside the zone (live), zone and next zone |
| Optional | "Pings also reveal hunters to runners": a rolling hunter position map for runners on each ping |

## Fair play and safety (please enforce these)
- **No roads.** Never cross a road without looking. No running into traffic. Stay out of private property, water, construction, and anywhere unsafe.
- **No hiding in dangerous places:** no trees, roofs, vehicles, storm drains, or other people's homes.
- **Tag gently.** A light touch counts. No grabbing, pushing, tackling, holding on, or chasing someone into traffic or a hazard. If a runner says "stop", stop. Agree before the game that touching is okay for everyone playing.
- **Daylight and group play.** Play in daylight where possible. Players under 16 need adult supervision. Tell a trusted person where you are playing.
- **One phone each.** No swapping phones or sharing codes, and no turning off GPS or switching to airplane mode. (A runner with no location can't be shown as outside the zone, so this is an honour rule. The server does not enforce it yet.)
- **Keep the app open and the screen on.** The app can only share location while open.
- **Be kind:** no harassing in chat, no doxxing, no tracking someone outside the game.
- **Call it off** (host) for bad weather, injury, or anyone feeling unsafe. Safety beats the game.

## Safety and fairness tools (built into the app)
- **Consent first:** nobody can host or join until they tick "I agree to share my live location". The server refuses a join or create without it.
- **SOS button:** any player can tap SOS (with a confirmation). The host and every player within 300 m (host-adjustable) get an alert with a red marker at the sender's position. It is rate-limited to once per 20 s. SOS deliberately ignores teams, so a nearby hunter learns where a runner in trouble is. That is the safety trade-off: if you need help, tell the host, and the host can end the game.
- **No-GPS detection:** if a player's location goes stale for 30 s they get a warning and the host is told who. A **runner** with no fix for 120 s (host-adjustable, 0 = never) is eliminated during the hunt. Hunters are only reported to the host.
- **Anti-cheat:** fixes with accuracy worse than 100 m are ignored (and the player is warned). A jump faster than 15 m/s is rejected as a teleport. If the "jump" persists for 5 fixes in a row, it is accepted (a real tunnel or lift exit) but flagged to the host. The web platform can't see "mock location" settings, so fake-GPS apps are only caught when they produce impossible jumps or stale signals.
- **Host moderation:** the host can mute or kick any player, and end the game for everyone, from the Host button. Muted players can't send team chat and get a listen-only voice token next time they join voice. The host's list shows names, GPS status and flags but **not roles**, so hosting never reveals who is a hunter.
- **Data deletion:** all locations are wiped from the server the moment a game ends or a rematch starts. Phones stop sharing location when the game is over.
- Not built yet: abuse reports, guardian mode for under-16s, and restricting zones away from roads or water.

## Privacy
Location is shared only during a game, only with the server and your teammates' map, and is never stored: it lives in memory and is deleted when the game ends or after 3 hours. Players must tap Allow on the location prompt. Don't play with people who haven't agreed.

## Recommended presets
| Game | Players | Zone | Hide | Hold / shrink | Ping | Length |
|---|---|---|---|---|---|---|
| Quick park game | 6 to 12 | 200 m, 4 shrinks | 90 s | 120 s / 45 s | 60 s | 15 min |
| Standard | 15 to 30 | 600 m, 5 shrinks | 2 min | 4 min / 1 min | 90 s | 30 min |
| Big event | 40 to 70 | 1000 m, 6 shrinks | 3 min | 5 min / 1 min | 120 s | 45 min |

## Variants
- **Infection:** caught runners become hunters (default). Swap off for a classic elimination game.
- **Safe zones:** the host names real-world safe spots that don't count as tags (a bench, a tree). Honour system.
- **Double ping:** halve the ping interval for the last two zones to build tension.
- **Bounty:** the last runner left is pinged live every 20 s.
- **Reveal the hunters:** turn on "Pings also reveal hunters to runners" for a fairer, tactical game.
