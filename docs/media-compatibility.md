# Media compatibility evidence

These checks use synthetic 440 Hz audio. They do not connect Discord, authorize a
Babel listener, exercise nickname replacement, measure battle latency, or establish
network capacity. The isolated fixtures live in `scripts/media-validation`.
After these checks, Werift 0.25.1 was added to the worker for actual application
[media admission](media-admission.md), tested separately on macOS and Linux arm64.
Other candidate SDKs remain outside the application's dependencies and builds.

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

Werift is the selected admission transport, with an inspectable packet-oriented
[WebRTC implementation](https://github.com/shinyoshiaki/werift-webrtc). Closing a
local peer avoids the separate self-hosted-token problem, but the probes do **not**
prove Babel credential revocation. Separate application tests now fence admission
and delayed negotiation, close actual peers and deny obsolete credentials. Source
generations and PCM publication are now covered by application tests. A closed negotiation ID is not
a listener credential; the fixture's HTTP 404 is not the application proof.
Real Coturn UDP/TCP/TLS and temporary credentials have separate
[application network checks](media-network.md); this does not validate public routing.

## Reproduce the checks

Use Node 24.22.1 and FFmpeg with `libopus`. `FFMPEG_PATH` can name an alternate
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

- The dedicated bot is installed in the authorized test guild; the selected
  private voice channel now has the approved bot-specific ViewChannel/Connect
  grant. An isolated receiver reaches Ready with DAVE protocol 1 negotiated,
  self-mute on and self-deafen off. An authorized member then supplies real speech:
  DAVE protocol 1 becomes ready; 1,129 packets decode independently to 48 kHz
  stereo signed-16 PCM, with 884 nonzero frames and no errors. A fresh receiver
  rejoins and decodes another 62 packets (53 nonzero frames), also without errors.
  Both native receiver processes close and exit 0. No raw audio is saved. Capture
  scope can select specific members or all channel members without IDs.
- The live candidate versions are `@discordjs/voice` 0.19.2, `discord.js` 14.27.0
  and `@discordjs/opus` 0.10.0 on Node 24.18.0/macOS arm64. One real member and
  bot rejoin are now validated; simultaneous sources, same-nickname users, member
  re-entry, Go Live audio and Linux live receipt are not. These pinned versions
  are now application dependencies; the source controller, independent decoders
  and bounded playback mixer are described in [original audio](original-audio.md).
- Extend the implemented admission/close proof to confirmed hard-crash recovery
  and production worker routing. Graceful restart and in-flight replacement pass;
  unknown owner registrations remain fail-closed.
- Complete live original-audio validation independently from subtitle/provider
  work: foreground/background playback, multiple commanders, source changes and
  PiP. Actual local WebRTC publication and source retirement pass with identified
  synthetic PCM; they are not a substitute for Discord-to-player speech evidence.
- Validate the deployment platform, public ICE/TURN routes, actual player networks,
  and the source-device-to-player latency before claiming production readiness.

These dependency checks guard failures that the existing database and HTTP tests
cannot observe: native cleanup, actual packet delivery, browser decoding and media
server token reuse. They add no production bypass, fake transport acknowledgement,
or test-only production export. They remain an explicit command outside
`ci:local`, because system FFmpeg, Docker and a real browser are separate inputs.
