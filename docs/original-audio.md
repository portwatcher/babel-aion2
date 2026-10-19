# Discord original audio

The worker uses `discord.js` 14.27.0, `@discordjs/voice` 0.19.2 with DAVE, native
`@discordjs/opus` 0.10.0, and Werift 0.25.1. These pinned versions follow actual
single-member DAVE reception and native cleanup tests, not only a channel join.
See [validation evidence](test-report.md) for the limits of each test.

The Linux image includes a native build toolchain. Opus 0.10.0's ARM64 build
includes NEON source files but its Linux configuration omits the macro guarding
their declarations. The Docker build sets `OPUS_ARM_MAY_HAVE_NEON_INTR=1` only
for ARM64, matching the declarations in the pinned upstream
[header](https://github.com/discordjs/opus/blob/v0.10.0/deps/opus/celt/arm/pitch_arm.h)
and its [build inputs](https://github.com/discordjs/opus/blob/v0.10.0/deps/binding.gyp).
This corrects the actual fallback compilation error without suppressing it.
The root override pins `tar` 7.5.22 for the native installer; the older nested
version had security advisories. The codec and Discord versions stay pinned.

## Configuration and control

Apply migrations through `0011_tough_psylocke`, including runtime ownership and
player-connection ownership. Web and worker share
PostgreSQL and the private media-control secret described in
[media admission](media-admission.md). Give the worker `PROVIDER_ENCRYPTION_KEY`
with exactly the same protected value as web's `NUXT_PROVIDER_ENCRYPTION_KEY`.
The worker decrypts only the stored server-side credential. It does not read a
bot token from public runtime configuration, send it to a player or print it.

Save the guild, ordinary voice-channel ID, bot credential and capture mode in
the administrator page, then select **启动房间**. Selected mode requires at least
one member ID; all-channel mode discovers speaking members without that list.
Only Guilds and GuildVoiceStates gateway intents are used. View Channel and
Connect must be effective in the channel, including private-channel overrides.
The bot uses self-deafen false, self-mute true, and does not publish to Discord.
Stage channels and screen-share/Go Live audio are not supported by this path.

Starting validates configuration completeness, credential decryption and the
configuration version, then saves running intent. It does not report successful
reception immediately. The worker polls at 500 ms, resolves the authenticated bot
identity and establishes Discord voice independently of media and provider work.
The administrator polls source state and speaker counters every three seconds;
the player receives only public room state, without speaker IDs or credentials.
Connected source state is not proof that anyone has spoken or heard playback.

## Source ownership and retirement

A dedicated PostgreSQL session holds an advisory lock for bot ID plus guild ID.
An open `voice_source_run` receipt also uniquely owns both that control key and
the room. A second controller cannot connect, including after the first session
disappears without a confirmed close. Every successful claim advances the source
generation. Ownership checks have deadlines; stale configuration reads stop
publication within the 1.5-second validity window. No output continues on known
loss of the ownership session.

Stop, source reconfiguration and Discord failures immediately clear queued PCM
and retire the room's media peers. Pending negotiations are fenced, actual peer
closure completes, and Discord is destroyed before the source close receipt is
written. A delayed old negotiation receives a retryable conflict rather than
terminating the listener. A new peer keeps that listener's nickname generation.
Graceful shutdown follows the same sequence. Persisted stopped intent survives
worker restarts. A surviving supervisor confirms its child's OS exit and closes
only that incarnation's source/media registrations before restarting it. Claims
share a database owner lock with this reconciliation, fencing delayed writes.
Unknown owners after supervisor or host loss remain unavailable. See
[worker recovery](worker-recovery.md) for the exact scope and outstanding cases.

The current deployment contract is one configured worker control endpoint.
PostgreSQL ownership prevents duplicate Discord control; it does not distribute
audio among multiple workers or provide owner routing. Production orchestration,
public ICE/TURN and actual player networks remain separate integration gates.

## Audio processing

Each captured Discord user has a separate Opus decoder and receive stream.
Leaving the channel removes the stream and its queued sound; re-entry can create
a fresh stream. Member IDs identify sources even when display names match.
Audio already mixed inside one member's client remains a single source.

Decoding produces 48 kHz stereo signed-16 PCM. The playback branch copies frames
into per-member queues bounded to 100 ms. Short inputs are assembled into 20 ms
frames; a trailing partial frame is padded after a pause. Stale frames and work
accumulated across a process stall are discarded. Active member frames are
averaged for playback, and explicit silence retains pauses. Each packet contains
960 samples per channel and is encoded as Opus for receive-only WebRTC.
RTP timestamps use the 48 kHz timeline and preserve an interruption's time gap.

The recognition branch consumes each member's PCM separately, before playback
mixing. It creates shared recognition and language-specific translation work only
for configured, validated paths with listener demand. Provider failure does not
stop original audio. Source retirement closes both branches and clears their
queues. See [shared subtitle processing](streaming-subtitles.md). No speech
recording or persistent audio file is created by the receiver.

## Reproducible checks

`npm test` independently decodes the mixer's output and checks channel isolation,
short frames, real pauses, bounded backlog and output cessation. `npm run test:db`
checks persisted intent, version/key rejection, competing ownership and actual
PostgreSQL-session loss. These database tests do not claim physical Discord close.

`npm run test:media:db` first sends identified synthetic PCM through the real
mixer and actual WebRTC peers, then runs built HTTP admission/revocation tests.
It verifies room isolation, decoder output, source retirement, OS UDP socket
release, and a real database-lock race against a pending negotiation. No test-only
publication endpoint or simulated close receipt is installed in production.

Isolated single-member Discord receipt and re-entry have passed. The production
Linux AMD64 worker has decoded one real member, and the human confirmed audible
playback through Babel. Simultaneous members, integrated member re-entry and DAVE
changes, background/game use and latency/capacity still need live evidence.
Synthetic PCM and a connected browser alone do not prove those requirements.
See the [current acceptance status](test-report.md#current-acceptance-status--2026-10-19)
for the distinction between implementation, isolated checks and production use.
