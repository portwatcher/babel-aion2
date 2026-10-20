# Player subtitle window

The listener panel offers **打开字幕小窗** when the browser exposes Document
Picture-in-Picture in a secure, top-level page. Opening requires the player's
click or keyboard activation. An unsupported browser keeps the ordinary page
usable and does not show this button. A rejected request shows a retry message.

The window displays the latest member's selected-language subtitle, original
text and connection status from the same authorized stream as the main page.
The translation is prominent, with smaller muted original text immediately
beneath it and localized speaker/finality labels. Both rows wrap without
truncation; the window can scroll when its size cannot fit longer text. The main
page shows the same bilingual layout for up to two current speakers. No synthetic
video, capture request or extra audio element is created. Text is cleared on
subscription changes, source stop, connection loss or session retirement.

## Use and lifecycle

- Choose **字幕字号** on the main page: standard, large or extra-large. Both views
  receive the same reactive value. The choice lasts for this mounted listener
  panel and is not a persistent account setting.
- Click **打开字幕小窗**. The initial size request is 560 × 200 CSS pixels, but the
  browser determines the actual size, position and window chrome.
- Close it using the browser's window control or **关闭字幕小窗**. This only closes
  the presentation; it does not leave the room or stop the main session.
- Leaving, replacement, terminal session state and navigation dispose the panel
  and close its window. A request completing after disposal is immediately closed.
  Refresh restores the saved listener but never automatically opens another PiP.

Vue Teleport renders into the returned document while retaining the existing
component's state. Both views use the same status component and page styles.
Network events update reactive props; no animation-frame loop, separate socket,
or repeated focus call is used. Browser `pagehide` handles manual window closure;
the owner page also closes its window on page exit.

The implementation follows the [Chrome API guide](https://developer.chrome.com/docs/web-platform/document-picture-in-picture)
and [Document PiP specification](https://wicg.github.io/document-picture-in-picture/).
It makes no promise of click-through or visibility above exclusive fullscreen
games. Actual AION2 display-mode and background-audio checks remain required.

## Current verification boundary

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
