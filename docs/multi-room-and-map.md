# Community rooms and shared Abyss map

## Setup

Apply database migrations, including `0013_fresh_mesmero.sql`. Supply the
following server-only runtime configuration through the private infra secret
store:

- `NUXT_DISCORD_CLIENT_ID`, `NUXT_DISCORD_CLIENT_SECRET`,
  `NUXT_DISCORD_BOT_TOKEN`: one Discord application and its bot.
- `NUXT_PROVIDER_ENCRYPTION_KEY`: the existing protected room credential key,
  also available to the voice worker.
- Existing database, site origin and private media-control settings.

In the Discord developer portal, enable Public Bot and require the OAuth2 code
grant. Register the exact site origin plus `/api/discord/callback` as a redirect.
The install request asks for `identify guilds bot applications.commands` and the
permission bitfield `3146752` (View Channel, Connect, Speak). Administrator is not
requested. Discord users still approve installation on Discord's own page.
The callback validates browser binding and state before exchanging the code.
It uses the guild from the token response, then checks the user's management
permission. The bot token is checked independently when loading channels, including matching
its application identity to the OAuth client.

Channel-level overwrites can reduce installation permissions. The chooser lists
only ordinary voice channels with all required effective permissions; creation
checks them again. A single bot receives one channel per guild. A guild can have multiple community
rooms, created by separate Discord installations. The first installation selects
the shared voice channel; later installations offer that channel and create
separate rooms with their own server, admission rules, members and maps. Each
installation is idempotent across replicas. One receiver and Opus encoder feed
all active rooms in that guild. Stopping a room retires only its delivery; the
source continues while another room is running. New guilds use all-channel reception. The form states
that the creator should inform speakers before starting the broadcast. Actual
source readiness remains worker status, independently from the saved request.

## Room and character entry

Share `/rooms/:roomId` directly. A valid listener session opens the room; absent,
invalid or ended sessions go to `/rooms/:roomId/verify`. That page checks the
character on the room's game server and returns to the same room after admission.
No player account or Cloudflare login is required. Entry controls live only on
verification; the room's listener panel, online members and map render only after
session restoration or verified entry succeeds.

The parent room route owns one listener controller across the verification and
room pages. The transition preserves the session, nickname generation, socket
and original-audio connection. A refresh validates the per-tab saved credential
before revealing room content. Storage/network failures keep a recovery action;
they do not trigger another entry or replacement generation. Leaving, removal,
replacement and expiry stop delivery and return to explicit verification.

Creation requires one of the current 20 Asia server slugs. The optional allowlist
accepts one exact character ID per line, up to 200. Empty means all indexed
characters on that server. IDs retain case and use NFC comparison.

Room entry uses `GET https://aion2index.com/api/search/suggest?q=ID&region=as`,
the public API used by AION2 Index's own search UI. Only an exact name and
`/c/as/{selected-server}/{name}` result grants entry. Suggestions from another
server/region or with different case cannot authorize entry. A missing indexed
match returns 404; provider failure, invalid schema or timeout returns 503 and
cannot admit anyone. No client-submitted verification flag or profile URL is
trusted. Index results reflect its current indexed suggestions; this endpoint
can omit characters not yet indexed or outside its result window. An omitted
character must be indexed on AION2 Index before retrying. Character existence
checks do not prove ownership of a game account.

The returned character ID becomes the session nickname, player-list name and map
signature. Same ID in the same room replaces the previous generation through
the existing revocation coordinator. Different rooms have independent generations.
Refresh restores the saved room session. New credentials never grant audio or
subtitles before old transport shutdown has been confirmed.

Room creation requires no administrator setup or manually entered Discord IDs.
The guild comes from the verified OAuth grant and the channel comes from Discord's
permission-checked channel list. Installed source bindings cannot be reassigned
through the administrator settings API. Administration lists actual installed
rooms, without a synthetic original-room option. Reads never seed a default room.
The older publication API is retained for previously stored broadcasts; it is
not part of creation. Publication still fences old unverified listener delivery.

The default administrator room retains its legacy API for compatibility with
existing clients and validation tools. Before publication it keeps the original
entry behavior and stays out of the directory. After publication the legacy API
performs the same server/allowlist/Index verification as room-specific entry.
The entry transaction shares a room lock with publication and requires the
server's validated character context, so an in-flight old request cannot bypass
the new policy. Existing community-room admission rules are immutable. `/admin` selects installed rooms; room settings, source
status, member lists and room language defaults follow that selection. Provider
and language catalogs remain shared.

## Map behavior and limits

The original map is
[Lower Reshanta on InteractiveMap.app](https://interactivemap.app/aion2/maps/tw/abyss-reshanta-a).
The fixed tile template is
`https://interactivemap.app/aion2/maps/imapp/uploads/tiles/abyssa/{z}_{x}_{y}.jpg`.
The site fetches visible original tiles on demand through a fixed-destination
`/api/player/map-tiles/:tile` resource endpoint. Coordinates and JPEG bytes are
validated, concurrent requests are deduplicated, and the runtime caches up to
512 tiles / 32 MiB for six hours. Browser responses cache for one day. Native
levels 0–7 remain available. The client
shows attribution to InteractiveMap.app and AION2/NCSOFT. Availability depends on
the public tile host. The implementation does not bundle an offline tile archive
or copy the source site's application, account features or community markers.

Map coordinates cover `[0, 4096]` in each dimension. Leaflet's shared transform
keeps bottom-image pixels, drawn points, labels and eraser hit tests aligned through
zoom, pan and viewport resize. Controls include wheel/pinch zoom, double click,
keyboard arrows and plus/minus, explicit zoom buttons, and reset (`0`). The initial
view and reset use the source map's center at zoom 4.

Members can draw with five colors. Every committed stroke has a numbered label
and the authenticated author's game ID, plus a corresponding line sample in the
sidebar. Clicking a sidebar entry locates its stroke. The eraser removes an entire
own stroke on click or drag; undo and per-stroke delete provide precise removal.
A member cannot erase another session's strokes. After replacement, the old
session's historical lines remain visible and its access is revoked.

Limits are 500 strokes per room, 100 per session, 1,000 points per stroke and a
64 KiB mutation body. UUIDs make retries idempotent. Map polling repairs a complete
snapshot every two seconds; a failed save retains a dashed pending line with
explicit retry/discard actions. Poll failures are shown instead of reporting
stale data as current. Lines persist through refresh, runtime restart and web
replica changes. Authorization is rechecked against the room and current nickname
generation on every read and mutation, including JOINING sessions waiting for
command delivery. Map access does not grant audio or subtitle delivery.

## Validation

`npm run ci:local` covers formatting, source limits, type checks, existing unit
contracts, the complete build and built HTTP smoke. `npm run test:db` covers the
existing listener, credential, source and ownership contracts.

`npm run test:community:db` creates a disposable local database and exercises real
HTTP against two built web replicas. External Discord and Index responses come
from a loopback service routed only by the test process; production has no
alternate provider destination or admission bypass. It covers creation, required
server, optional allowlist, exact API admission, installation-state/browser
binding, effective channel permissions, independent room sessions, idempotency,
author signatures, cross-room denial, cross-replica drawing/erasure, replacement
fencing and runtime-restart persistence. It does not establish live Discord OAuth
installation, multi-guild DAVE receipt or production media capacity.
