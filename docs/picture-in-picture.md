# Player pop-out window (subtitles & tactical map)

The listener panel and tactical map header offer **弹出小窗** (`Pop out window`)
when the browser exposes Document Picture-in-Picture in a secure, top-level
page. Opening requires the player's click or keyboard activation. An unsupported
browser keeps the ordinary page usable and does not show these buttons. A
rejected request shows a retry message.

Because the Document Picture-in-Picture API permits only one active PiP window
at a time (requesting a second window closes the existing one), subtitles and
the room's Lower Reshanta tactical map share one unified floating window instead
of opening separate windows or simulating PiP with a video stream. Two switches
in the PiP header control visibility independently for **Subtitles** and **Map**.

When **Subtitles** is enabled, the window displays the latest member's
selected-language subtitle, original text and connection status from the same
authorized stream as the main page. The translation is prominent, with smaller
muted original text immediately beneath it and localized speaker/finality
labels. Both rows wrap without truncation; the subtitle pane scrolls when its
size cannot fit longer text. The main page shows the same bilingual layout for
up to two current speakers. No synthetic video, capture request or extra audio
element is created. Text is cleared on subscription changes, source stop,
connection loss or session retirement.

When **Map** is enabled, the window renders the same Lower Reshanta tiles and
synchronized room strokes from the room's single `useRoomMap` controller,
preserving the player's last center and zoom. Zoom buttons, wheel zoom, pointer
panning, keyboard pan/zoom/reset (`0`) and collapsible drawing/erasing tools
work inside the PiP window without creating a second polling loop. To avoid
stalling when the main tab is hidden behind a game, Leaflet in the PiP document
uses synchronous SVG rendering (`preferCanvas: false`) with animations disabled
and direct pointer/keyboard handlers rather than main-document listeners.

## Use and lifecycle

- Choose **字号** (`Text size`) on the main page: standard, large or extra-large.
  Both views receive the same reactive value. The choice lasts for this mounted
  room session and is not a persistent account setting.
- Click **弹出小窗** (`Pop out window`) from the listener panel or map header.
  Both Subtitles and Map start enabled by default (`520 × 560` CSS pixels;
  `560 × 220` when re-opened with subtitles only; `520 × 440` with map only),
  subject to browser window limits.
- Flip the **Subtitles** or **Map** switch inside the PiP window at any time to
  show either or both. Turning Map on inside a short window requests a taller
  height while keeping the user's width when permitted by the browser.
- Close it using the browser's window control or **关闭小窗** (`Close pop-out`).
  This only closes the presentation; it does not leave the room or stop the main
  session.
- Leaving, replacement, terminal session state and navigation dispose the room
  view and close its window. A request completing after disposal is immediately
  closed. Refresh restores the saved listener but never automatically opens
  another PiP.

Vue Teleport renders into the returned document while retaining the room
controller's shared state. A `MutationObserver` mirrors existing and
lazily-injected page styles (such as PrimeVue and Leaflet CSS) into the PiP
document and disconnects on close. Network events update reactive props; no
animation-frame loop from a hidden page, separate socket, duplicate map poller
or repeated focus call is used. Browser `pagehide` handles manual window
closure; the owner page also closes its window on page exit.

The implementation follows the [Chrome API guide](https://developer.chrome.com/docs/web-platform/document-picture-in-picture)
and [Document PiP specification](https://wicg.github.io/document-picture-in-picture/).
It makes no promise of click-through or visibility above exclusive fullscreen
games. Actual AION2 display-mode and background-audio checks remain required.

## Current verification boundary

### Unified subtitles and tactical map PiP check · 2026-11-28

- **PASS (`npm run ci:local`, `apps/web/test/pip-layout.test.ts`, `node scripts/community-smoke.mjs`):**
  Line limits, Prettier, TypeScript strict checks across all workspaces, unit
  tests (including PiP visibility resolution, sizing and height-expansion
  rules), full production build, HTTP smoke and multi-replica PostgreSQL
  community-room/map persistence passed.
- **PASS (Chrome/macOS rendered layout & real Document PiP):** Exercised the
  built web server with an isolated PostgreSQL room containing 31 active
  listeners and 2 persisted strokes. At 1440 × 900, the tactical map rendered
  beside live subtitles above the fold and stayed pinned at `top: 16px` while
  scrolling past the bounded listener list (`352 px` viewport over `2139 px`
  content). At 768 × 900 and 320 × 640, the map rendered above the listener list
  with zero horizontal overflow. Clicking **弹出小窗** opened a real Chrome
  Document PiP window (`Babel · 字幕与作战地图`) with styled PrimeVue
  `ToggleSwitch` controls, Lower Reshanta tiles and 2 synchronous SVG strokes;
  toggling Subtitles and Map independently (both on, map-only, subtitles-only,
  both off, re-enabling map), expanding/collapsing the PiP drawing toolbar,
  keyboard pan/zoom/reset (`ArrowRight`, `+`, `0`) and closing from the main
  page all succeeded with zero console or page errors in either window.
- **NOT RUN:** Live speech recognition/translation inside the unified window,
  background-tab occlusion behind AION2 and actual AION2 game display modes.

The shared subtitle change was exercised in Chrome/macOS against a built web
server, isolated PostgreSQL, the actual private subtitle service and explicitly
synthetic PCM/provider responses. Two named sources rendered independently;
changing Japanese to Korean cleared the previous text before new results arrived.
Quota failure kept Korean selected, and disabling all languages cleared the text
while media remained connected. PiP controls opened and closed successfully.
Database receipts showed exactly one player socket and one media negotiation
across language changes, provider failure and PiP use. No browser warning/error
entries were captured. This establishes transport/UI behavior, not translation
quality or an independently observed audible browser signal.

Native PiP pixels were not available because the Mac was locked. The successful
API response and main-page control state do not prove native window contents.
Live speech, background/game modes and native window disappearance remain NOT RUN.

### Earlier status-window check

The built application was exercised in Chrome on macOS using a real local
PostgreSQL listener: opening and closing the API request, keyboard activation,
the main page's 32 px extra-large text, unchanged listener identity/socket count,
replacement feedback and explicit exit. The controls fit a 320 px viewport.
Refresh retained the third nickname generation with one socket, left older
generations with no open sockets, and returned to the closed-window control.
No browser warnings/errors were captured.

Native PiP pixels and physical window disappearance could not be independently
observed: the native-app screenshot helper failed, and the browser's read-only
DOM scope does not expose the PiP window. These remain NOT RUN, as do live
speaker/translation quality, audible continuity, actual AION2 and player-network
checks. A successful `requestWindow` response and main-page state are not a
substitute for those checks.
