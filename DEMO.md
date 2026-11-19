# WAYRA demo script (two windows)

## One command

From the repo root in PowerShell (data already built, see README):

```powershell
npm run seed:demo   # creates or resets demo@wayra.app / Wayra@123 with contacts "Mom" and "Priya – friend"
npm run demo        # builds the PWA and serves app + API on http://localhost:8080 (one port)
```

`npm run demo` prints a startup checklist (walk graph ✓, edge risk ✓, model card ✓, heatmap ✓, database ✓, frontend build ✓) and then the URLs to open:

| What | URL |
|---|---|
| App (left window) | http://localhost:8080/app, sign in with **demo@wayra.app / Wayra@123** |
| Mom's watch page (right window) | printed as `Watch link: Mom http://localhost:8080/watch/…` |
| Priya's watch page (spare) | printed below Mom's |

The watch links stay the same every time you rerun `npm run seed:demo`, so a window opened earlier keeps working. Run the seed **before** `npm run demo` (it ends leftover trips and clears the demo user's alerts and reports). Stop with **Ctrl+C**; `npm run demo -- --skip-build` restarts without rebuilding.

A 6–8 minute live demo of the safety features, built to run from anywhere (for example India) on the Chicago pilot data. **Left window:** the user's app at `/app` in DEMO MODE. **Right window:** a trusted contact's private watch link `/watch/:token`.

## Before you present (5 min)

1. `npm run seed:demo`, then `npm run demo`. Wait for **All systems ready** and the URL box.
2. Open the app URL and sign in as **demo@wayra.app / Wayra@123** (the user is "Asha Rao"). The map opens at `/app`.
3. Open **Mom's watch link** from the terminal in a second window. Put the two windows side by side: **app on the left, watch page on the right**. (The watch page needs no login, so the same browser is fine.)
4. In the right window click **Turn on alerts** and allow notifications. This unlocks the siren sound.
5. Use **Chrome or Edge** for the left window if you want to show Voice SOS. Open the avatar menu → **Voice SOS** once to grant the microphone, then switch it off again until step 9.
6. Turn the laptop volume up (ringtone and siren are generated in the browser).
7. Check the internet: the street map tiles come from OpenStreetMap. Without internet a small "Map tiles need internet" notice appears; routes, alerts and SOS still work.

Tip: zoom both windows to 90 % on a 1080p projector so the trip panel and the alert feed fit. Use **«** on the route panel to give the map the full width, and **Fit route** to zoom back to the whole route.

Without the seed (e.g. on a fresh machine): sign up, then **Contacts → Add contact** (`Mom`, `Mother`, `+1 312 555 0100`) and **Preview their page** to open the watch link. With `npm run dev` the app is on http://localhost:5173 instead.

## The script

| # | Left: user app | Right: contact's watch page | What to say |
|---|---|---|---|
| 1 | On `/app`, tap the demo chip **Union Station → Navy Pier** (or **Wrigley Field → Lincoln Park Zoo** for the biggest difference). Point at the three route cards, the **"−xx% risk"** line on Safest, and the coloured segments. Open **Directions** and tap a street: the map zooms to it. | "No trip right now." | "WAYRA compares the fastest route with the safest one, scored by our crime-risk model for this time of day. The score is relative to the whole city at every hour, so at night every route scores lower; what matters is how much risk Safest avoids compared with Fastest." |
| 2 | Keep **Demo mode** ticked and click the big **Start trip on Safest route** button at the bottom of the panel. The trip panel appears with the purple **DEMO MODE** strip. Set speed to **20×**. | Within a second: "Asha is walking · To Navy Pier", the route, and a moving teal marker. ETA and distance left count down. A "Trip started" item appears in Updates. | "I'm presenting from India, so a simulated walker follows the route. Mom didn't install anything: she just opened a private link." |
| 3 | Watch the marker move. Optionally click **Trip link** to show the shareable one-off link. | Marker and dotted trail follow live. | "Location is only shared during a trip or an SOS, never in between." |
| 4 | Click **Simulate deviation**. The walker veers 200 m off the route and the status turns **Off route**. After ~10 s the **"Are you OK? Alerting your contact in 15 s"** prompt appears. **Don't press anything.** | The watch page shows **Checking in with Asha…** | "If Asha leaves the route for too long, WAYRA first asks her. A false alarm is one tap to cancel." (Real timers: 30 s off route, 3 min stopped. Demo uses 10 s / 20 s.) |
| 5 | Let the 15 s run out. A toast says **Alert sent to 2 contacts** (1 if you added Mom by hand). Click **Back on route**. | A chime, an amber **Off route** card on the map and in Updates: "Asha is about 200 m off the planned route … didn't answer a check-in", with a link to the location. | "Nobody answered, so Mom is alerted automatically, with the exact place." |
| 6 | Press the red **SOS** button. Show the full-screen **5-second countdown** and the big Cancel. Let it reach zero. "Help is being alerted" lists Mom ("Watch link · seeing it live") and Priya and **Authorities (911) · simulated**. Point at **Call 911**. | A siren plays and a big red **SOS from Asha** banner appears, with Call 911 / Open in maps. The marker turns red and keeps moving. | "One tap, five seconds to cancel, then everyone is alerted with live location. WAYRA never dials for you: Call 911 is a button you choose to press." |
| 7 | Click **I'm safe now**. | The banner disappears; Updates shows "Asha is safe now and closed the SOS." | |
| 8 | In the trip panel click **Fake call → In 10 s → Schedule**. A pill counts down; the incoming-call screen rings with a generated ringtone. **Accept** to show the in-call timer, then end the call. | (nothing) | "If someone is following her, a believable phone call is a reason to step into a shop." |
| 9 | In the trip panel switch **Voice** on (a "Listening" pill appears in the navbar). Say clearly: **"WAYRA help"** (or "help help"). The SOS countdown starts. Press **Cancel** (or let it send and show the banner again, then I'm safe now). | (if sent) SOS banner again | "Hands-free: if she can't reach the screen, her voice starts the SOS." |
| 10 | Let the walker reach Navy Pier (about 2½ min at 20× from the start; or skip). | "Asha arrived safely at Navy Pier." The trip ends and the location disappears. | "And the best message of all." |

## Optional extras

- **Live re-routing from reports:** during a trip click **Report**, pick "Being followed", submit. Within ~10 s a **Safer route found** card offers **Switch route**; the right window shows the new route.
- **Simulate stop:** freezes the walker. After 20 s (demo) the check-in appears with "You haven't moved for a while".
- **Offline SOS:** in the left window open DevTools → Network → **Offline**. The navbar shows **Offline**. Press SOS: after the countdown your SMS app opens (on a phone) with "SOS from WAYRA – my location: https://www.openstreetmap.org/?mlat=…". On a laptop the screen shows the same message. Switch back online afterwards.
- **History:** avatar menu → **SOS history** shows every SOS with its delivery log.
- **Install:** `npm run demo` serves the production build, so Chrome/Edge offer **Install app** in the address bar.
- **Real GPS:** untick **Demo mode** before starting. WAYRA first explains why it needs location (shared only during the trip or an SOS), then the browser asks. From outside Chicago, or if you say no, the trip switches to DEMO MODE by itself and an amber note at the top of the trip panel says why.

## Reset between runs

- **End trip** in the trip panel (or let it arrive). An open SOS: **I'm safe now**.
- Everything else can stay. The watch page keeps working across runs; its Updates feed shows the last 24 h.
- For a completely clean feed: stop the server, `npm run seed:demo`, `npm run demo` (the watch links don't change).

## If something goes wrong

| Problem | Fix |
|---|---|
| The startup checklist shows ✗ / "Still getting ready" banner | Data not loaded: run the npm command the checklist names (`npm run score` / `npm run train`), then restart `npm run demo`. |
| `Port 8080 is already in use` | Another `npm run demo` is still running. Close it (Ctrl+C) and start again. Still busy: `Stop-Process -Id (Get-NetTCPConnection -LocalPort 8080 -State Listen).OwningProcess` |
| "Map tiles need internet" | No connection to OpenStreetMap. Reconnect; tiles reload by themselves. The demo flow still works on the grey map. |
| Can't sign in as demo@wayra.app | Stop the server, run `npm run seed:demo`, start `npm run demo` again. |
| The watch page says **Reconnecting…** | The backend restarted (e.g. after a code edit). It reconnects by itself within ~10 s. |
| No siren on the right | Click **Turn on alerts** again (browsers need one click before they play sound). |
| Voice SOS shows "Microphone access was blocked" | Allow the microphone in the address bar's site settings and switch Voice on again. It needs Chrome or Edge and an internet connection. |
| The walker doesn't move | Check the trip panel says **DEMO MODE**. If not, switch **Demo mode** on in the trip panel. |
