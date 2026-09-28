# Cricket Live Studio v36 — Animated Broadcast Overlay

A full rewrite of the v35 scoreboard front end into a modern, animated broadcast package for live streaming.
The proven live-score engine (`server.js`: feed parsing, over history, ICC player-face discovery, self-test) is unchanged.

## Quick start

1. Install Node.js 18+.
2. Double-click `START-SCOREBOARD.bat` (or run `npm start`).
3. The **Control Room** opens at `http://localhost:3000/`. Enter your match key, pick a layout, and click **Copy OBS URL**.
4. In OBS add a **Browser Source** → paste the URL → width **1920**, height **1080**, FPS **60**.

## Two layouts, one data feed

| Layout | URL | Use it for |
|---|---|---|
| Full studio | `overlay.html?key=KEY` | Break screens, analysis segments, full-frame scoreboard |
| Lower-third bar | `overlay.html?key=KEY&layout=bar` | Over live camera video (transparent background) |

Press **L** in the overlay (Interact in OBS) to flip between layouts at any time.

## What's animated

- **Rolling digits**: score, overs, batter runs, bowler figures, rates and percentages roll like a stadium board.
- **Full-frame stingers** for **FOUR**, **SIX**, **WICKET**, and automatic **FIFTY / HUNDRED / 150 / DOUBLE** milestones (studio: centre band; lower-third: flag above the bar). Events queue so nothing overlaps, and wickets and milestones are never dropped.
- **Latest-ball stage** with an event-coloured burst, rotating rays and particles.
- **Ball-by-ball chips** that drop in with a spring. Colour plus label, so nothing relies on colour alone. Empty slots show the balls left in the over.
- **Team-colour theming**: glows, washes, player backdrops and the win-predictor bar all take on the two teams' colours automatically.
- **Pre-match** countdown ring (it fills over the final 3 hours and turns red and pulses in the final 10 minutes), plus teams, venue, first-ball time and timezone.
- **Result / Final** celebration with the winner's colours, halo, confetti and a trophy badge for finals.
- Respects `prefers-reduced-motion` (or add `&motion=0`).

## URL options

| Param | Example | Effect |
|---|---|---|
| `key` | `key=11AI` | Match key for the live feed |
| `layout` | `layout=bar` | Lower-third instead of full studio |
| `bg` | `bg=none` | Transparent background for the studio layout |
| `tz` | `tz=Asia/Kathmandu` | Display timezone for start time and clock |
| `stingers` | `stingers=0` | Turn off FOUR/SIX/WICKET/milestone takeovers |
| `stinger` | `stinger=3000` | Stinger hold time in ms (default 2400) |
| `poll` | `poll=1500` | Feed polling interval in ms (default 1000) |
| `mode` | `mode=trophy` | Force the trophy presentation on a result |
| `motion` | `motion=0` | Minimal motion |

## Demo / rehearsal

`overlay.html?demo=1` runs a built-in ball-by-ball simulator, so you can rehearse every animation without a live match.

| Key | Action |
|---|---|
| `1` `2` `3` `4` | Live · Pre-match · Result · Final (trophy) |
| `→` / `Space` | Bowl the next simulated ball |
| `F` `S` `W` `M` | Fire a Four / Six / Wicket / Fifty stinger |
| `L` | Toggle layout |

Add `&autoplay=0` to step manually, or `&pace=2500` to change the autoplay speed.
The Control Room has buttons for all of these.

## Player faces

Unchanged from v35. Priority: `public/player-faces/<player-name>.jpg|png|webp` → cached/auto-discovered ICC headshot → Wikimedia → silhouette.
Local licensed images always win. See the v35 notes on ICC content terms before using online headshots commercially.

API endpoints (`/api/state`, `/api/player-photo`, `/api/icc-discover`, `/api/icc-cache`) and environment variables are the same as v35.

## Files

```
server.js              live-score engine (unchanged logic, v36 version tag, font MIME type)
public/index.html      Control Room (setup, preview, copy OBS URL, demo controls)
public/overlay.html    Overlay markup (studio + lower-third + stinger layers)
public/overlay.css     Design system and all animation
public/overlay.js      Render engine, match-state logic, stinger queue, demo simulator
public/fonts/          Big Shoulders Display + Archivo (bundled, SIL OFL; works offline in OBS)
public/team-*.js       Team presets and badge artwork (unchanged)
```

## Hosting (cPanel / Babal Host)

Upload the folder over your existing Node app, keep Node 18+ selected, and restart the app in **Setup Node.js App**. Your existing OBS URL keeps working; add `&layout=bar` for the new lower-third.
