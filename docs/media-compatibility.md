# Media compatibility evidence

These checks use synthetic 440 Hz audio. They do not connect Discord, authorize a
Babel listener, exercise nickname replacement, measure battle latency, or establish
network capacity. The application still has no active media adapter and keeps
listeners in JOINING. Candidate dependencies are isolated from the npm workspaces
in `scripts/media-validation`; they are not installed by the application's `npm ci`
or included in its builds.

## Observations — 2026-10-18

| Candidate                                                            | Environment                          | Result                                        | Evidence and consequence                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------- | ------------------------------------ | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@roamhq/wrtc` 0.10.0                                                | Node 24.18.0, macOS arm64            | FAIL                                          | A native audio source can create and stop a track, then the process terminates with SIGSEGV. The minimal isolated check reproduces this. Do not select it for this runtime.                                                                                     |
| LiveKit server 1.13.10, `@livekit/rtc-node` 1.1.0, server SDK 2.19.1 | Node 24.18.0, Linux arm64 containers | PASS for synthetic media; FAIL for revocation | The real media SDK publishes PCM; another participant decodes nonzero samples. Removal emits disconnection and the server list confirms absence. The same unexpired token then successfully rejoins. Removal alone cannot support Babel's replacement contract. |
| `werift` 0.25.1                                                      | Node 24.18.0, macOS arm64            | PASS for local transport and cleanup          | FFmpeg encodes 48 kHz stereo Opus. Actual peers exchange SRTP; the receiver gets at least 50 packets. Closing only the sender stops reception while the source and receiver remain running. The child exits naturally with status 0.                            |
| `werift` 0.25.1 to Chrome                                            | macOS, local direct ICE              | PASS for synthetic decoding and stop          | The browser negotiates receive-only audio and measures nonzero decoded PCM through Web Audio with silent output. After server close, packets stop and decoded RMS returns to zero. Replaying the closed negotiation receives HTTP 404.                          |

The native LiveKit SDK initially timed out establishing ICE from macOS to a
loopback-advertised Docker server. The same SDK works inside the isolated Linux
network. That initial failure does not identify a LiveKit SDK defect. Browser
LiveKit playback, host-to-container ICE, TURN, Linux amd64 deployment and actual
player networks remain NOT RUN.

LiveKit's [token documentation](https://docs.livekit.io/frontends/reference/tokens-grants/)
also explains that removing a participant does not invalidate an existing token on
a self-hosted server. If selected, it needs a proven admission method that checks
the listener generation on every connection and handles in-flight joins before
acknowledging removal. A short expiry or successful RemoveParticipant response is
not sufficient.

Werift is the next integration candidate, with an inspectable packet-oriented
[WebRTC implementation](https://github.com/shinyoshiaki/werift-webrtc). Closing a
local peer avoids the separate self-hosted-token problem, but the probes do **not**
prove Babel credential revocation. The application must still fence admission,
delayed negotiation and source generations, close every actual connection, and
deny old credentials. A closed negotiation ID is not a listener credential.

## Reproduce the checks

Use Node 24.18.0 and FFmpeg with `libopus`. `FFMPEG_PATH` can name an alternate
FFmpeg executable. These commands do not load `.env` or use a real credential:

```sh
npm ci --prefix scripts/media-validation
npm --prefix scripts/media-validation test
npm --prefix scripts/media-validation run check:wrtc
```

The first command after installation checks actual Opus transport and sender
shutdown. The wrtc command currently exits 1 and reports SIGSEGV on the tested
macOS runtime. A child reporting that `track.stop()` returned is not a pass: the
parent also requires natural, successful process termination. The runner bounds
each check to 45 seconds and terminates its own process group if it hangs. Native
SDK stdout/stderr is suppressed because it can contain SDP and credentials; the
parent prints only the controlled result and exit status.

For browser decoding and closed-negotiation replay:

```sh
npm --prefix scripts/media-validation run browser
```

Open the printed loopback URL in Chrome and choose “开始接收（静音）”. Wait until
packets and decoded RMS increase, then choose “关闭服务端连接”. PASS requires at
least 50 received packets, nonzero decoded audio before close, silence and stable
packet count for two seconds after close, a closed server peer, and HTTP 404 for
the old answer. The page requests no capture permission. It uses one muted audio
element and a zero-gain analysis output. End the command with Ctrl-C; an automatic
15-minute limit also closes peers and the synthetic encoder. The page and server
are test fixtures, not a public application endpoint.

For LiveKit, use the isolated Compose project. It publishes no host ports and uses
clearly named fixture credentials. Container dependencies are kept in a separate
volume so native binaries are installed for Linux:

```sh
docker compose -p babel-media-compatibility -f scripts/media-validation/compose.yaml up --abort-on-container-exit --exit-code-from probe
docker compose -p babel-media-compatibility -f scripts/media-validation/compose.yaml down --volumes
```

The command currently exits 1 with `media: PASS`, `oldTokenRejoined: true`, and
`revocation: FAIL`. This is an intentionally unresolved acceptance gate, not a
passing test of an unsafe expectation. A future rejection counts only if it is an
authentication denial and a freshly issued token still connects; a timeout or
network error is not revocation proof. The probe closes participants, deletes its
room, releases native media objects, and lets the parent observe process exit.

## Remaining integration gates

- Install the dedicated Discord bot and supply the target voice channel and
  commander selection. REST authentication succeeds, but its guild list is empty.
- Validate live Discord/DAVE receipt and separate selected commanders. No Discord
  library has been selected based on these media-only fixtures.
- Connect media admission to real listener transactions and actual shutdown
  acknowledgements. Prove old-credential denial and replacement while negotiation
  is in flight, including across process/network failures.
- Integrate original audio independently from subtitle/provider work, then test
  foreground/background playback, multiple commanders, source changes, and PiP.
- Validate the deployment platform, public ICE/TURN routes, actual player networks,
  and the source-device-to-player latency before claiming production readiness.

These dependency checks guard failures that the existing database and HTTP tests
cannot observe: native cleanup, actual packet delivery, browser decoding and media
server token reuse. They add no production bypass, fake transport acknowledgement,
or test-only production export. They remain an explicit command outside
`ci:local`, because system FFmpeg, Docker and a real browser are separate inputs.
