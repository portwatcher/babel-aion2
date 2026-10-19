# Interface localization

The player interface supports `en` (English), `zh-CN` (Simplified Chinese), `ja`
(Japanese), and `ko` (Korean). Country shorthand `cn`, `jp`, and `kr` is accepted
and normalized to these language codes. Chinese browser variants use the available
Simplified Chinese interface. Subtitle selection retains its own script matching.

## Detection and explicit choice

On the first server request, weighted `Accept-Language` preferences select the
first supported language with a positive quality value. Missing, unsupported or
invalid preferences fall back to English. Nuxt serializes that request-local
choice so browser hydration uses the same language as the HTML.

The compact header selector changes the interface immediately. An explicit
selection is saved under `babel-interface-locale` in localStorage and mirrored in
a same-named, path-wide, SameSite=Lax cookie with a one-year maximum age. The
cookie overrides browser detection on subsequent SSR requests. After hydration,
a valid localStorage choice takes precedence and updates the cookie, including
when the two stores disagree or the cookie was cleared. LocalStorage alone is
unavailable to the server, so a localStorage-only preference is applied after
mounting on its first request. Blocked storage does not prevent the current
choice or cookie persistence from working.

Changing the interface language preserves nickname input, the listener session,
original audio, selected subtitle language, and PiP. Existing notices and PiP
metadata update with the interface. Administrator-configured room/language names,
player nicknames, recognized speech and translated subtitles remain content in
their original language. The built-in room heading has localized equivalents.

## English-only administration

`/admin` and its descendants force English regardless of the player preference.
The locale selector is hidden there. Administrative forms, feedback, dates,
shared listener-list controls, and protected-route error pages use English.
Returning to the player area restores the saved player locale. Cloudflare Access
and management authorization remain enforced independently of localization.

## Maintenance and checks

Player catalogs live in `apps/web/app/locales/`; TypeScript checks that each
locale provides all English message keys. `useInterfaceLocale()` exposes typed
translations and the active locale. Nickname validation supplies stable message
keys instead of display text. Reuse the shared PrimeVue controls and translate
visible text, accessibility names and metadata when adding player features.

`npm run ci:local` runs strict types, source limits, formatting, unit tests, builds
and built-server HTTP tests. The HTTP suite checks translated SSR forms, weighted
and unsupported detection, cookie overrides, concurrent locale isolation,
translated 404s and English-only protected administrator errors. Browser checks
separately cover hydration, selector changes, storage recovery and narrow layouts.
