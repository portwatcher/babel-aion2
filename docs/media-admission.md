# Media admission

The optional worker implements real, receive-only WebRTC admission with Werift
0.25.1. It sends an empty Opus track: no Discord capture, PCM publication or live
command audio is implemented yet. A connected peer therefore means transport
connectivity, not audible commands. The UI states this explicitly.

## Configuration and local use

Apply migrations through `0007_dear_omega_red`. Use the same database for web
(`NUXT_DATABASE_URL`) and worker (`DATABASE_URL`). Generate a separate random
secret with at least 32 characters and put it in both `MEDIA_CONTROL_SECRET` and
`NUXT_MEDIA_CONTROL_SECRET`, only in ignored local configuration or the private
deployment secret store. Never expose the control secret as public Nuxt config.

The worker defaults to `MEDIA_CONTROL_HOST=127.0.0.1` and
`MEDIA_CONTROL_PORT=3100`. Point `NUXT_MEDIA_CONTROL_URL` at that private origin.
Build with `npm run build`, then start the worker from the repository root:

```sh
node --env-file=.env apps/voice-worker/dist/index.mjs
```

Start or restart the web app with the corresponding private configuration. When
control is absent or unready, new listeners remain JOINING. When available, the
current listener may become ACTIVE after every older delivery confirms shutdown.
Private `/ready` reports `audioState: STOPPED`; it checks media registration
storage and does not claim that a commander source is ready.

The `voice-worker` Docker target packages the built worker and runtime
dependencies, runs as UID 1000 and listens on port 3100. The default final Docker
target remains the web application. Production publishing and networking belong
in the separate private infra repository; this change does not deploy a worker.

## Public and private boundaries

`POST /api/player/sessions/:id/media` requires the same-origin browser request,
that listener's credential and current ACTIVE generation. Requests are bounded
to 80 KiB and use the shared contract:

- `offer`: UUID `connectionId` and positive safe-integer `attempt`.
- `answer`: the same ID and an answer description with SDP limited to 64 KiB.
- `close`: the exact connection ID.

The web server derives session ID/generation from authenticated storage and calls
the private worker. `/media`, `/revoke` and `/ready` all require its control
credential. Calls have bounded timeouts, reject redirects and expose only safe
errors. Credentials, SDP, private endpoints and raw exceptions are not logged.
The browser receives a send-only server offer and negotiates receive-only audio;
it never requests a microphone, camera or screen permission.

## Replacement and reconnect invariants

Registration takes the same global nickname lock as replacement and rechecks
authorization after acquiring it. A request that read the old session before
revocation cannot register after the shutdown check. Connection rows retain the
owner, listener generation, negotiation attempt and close receipt.

The browser persists increasing media attempts within its saved listener.
Refreshing preserves the listener and nickname generation while superseding the
previous peer. Old attempts and connection IDs cannot replace the newest one.
Repeated copies of an open offer are idempotent. Overlapping negotiations only
wait for earlier attempts to close, avoiding mutual waits during rapid recovery.
No new peer is offered until earlier connections for that listener have closed.

The owning worker waits for initialization and answer processing to settle,
stops the track, awaits actual peer closure, then writes `closedAt`. Storage
failure retains an unconfirmed row and is retried. An acknowledgement is never
inferred from time, a request being sent, or a token expiring. The coordinator
also requires physical player-socket closure before it authorizes replacement.

Every 500 ms, the worker rechecks registrations and closes unauthorized peers.
An unconnected negotiation expires after 30 seconds. A connected peer remains
subject to session authorization; local browser disconnects retry the same
listener. Terminal 401/410 responses stop media recovery. Explicit leave,
replacement, page exit and component disposal close local playback. PiP shares
the existing session and adds no media connection or audio element. Mute affects
playback only; rejected autoplay displays the existing playback button.

## Evidence and limits

After `npm run build` and migrations, run `npm run test:media:db` against disposable
loopback PostgreSQL. It starts two built web processes and the actual worker,
negotiates real receive-only WebRTC, and independently checks OS UDP socket
ownership before and after closure. It exercises credentials/origin, replacement
with a blocked close receipt, in-flight admission, overlapping recovery, scoped
late cleanup, same-generation subscription changes and graceful restart. No
production transport callback is mocked and no synthetic source is installed in
the application. Results on Node 24.18.0/macOS arm64 and Linux arm64 are recorded
in [the test report](test-report.md).

Hard-killed owners or failed close persistence can leave open registrations.
Unknown owners remain fail-closed; confirmed orphan recovery is unfinished.
Current control targets one worker URL. Owner routing, exclusive guild control,
public ICE/TURN, Linux amd64 target testing, capacity and actual player networks
remain unvalidated. Local direct ICE uses no external STUN by default.

The next audio integration must decode each selected commander's Opus separately
and branch decoded PCM to media and recognition as specified in `design.md`.
Source-generation fencing, independent audio/provider recovery, real pauses,
bounded PCM queues, commander mixing for playback and original-audio latency
still need implementation and live evidence. Candidate synthetic decoding alone
does not satisfy those gates.
