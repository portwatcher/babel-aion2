# Player audio source

A room's audio comes from one of two sources, chosen when the room is created:

| Source            | Setup                                                    | Input                                 |
| ----------------- | -------------------------------------------------------- | ------------------------------------- |
| `PLAYER` (player) | Room name, server, host character ID, optional allowlist | An input the host chooses in the room |
| `DISCORD`         | Discord bot installation and voice-channel choice        | Speaking members of the voice channel |

A player-source room needs no Discord application, bot, guild or channel. It is
available whenever the database is configured; `GET /api/player/rooms` reports
the creatable sources in `creationSources`.

## Creation

`POST /api/player/rooms/hosted` accepts `name`, `server`, optional `allowedIds`
and `hostId`, with the same same-origin check as other player mutations. The host
ID is checked against AION2 Index on the room's server, exactly as entry checks a
character, and the index's exact character ID is stored as `room.host_character_id`.
A non-empty allowlist always includes the host. The room is created running with
`audio_source = 'PLAYER'`, a `community_room` row without guild or creator, and a
`room.create` audit event. The creation page submits the supplied host ID through
ordinary verified admission, saves the resulting per-tab listener credential,
then opens the room directly. The host does not type the ID again. An admission
retry retains the created room and the pending entry request, avoiding another
room or nickname generation after a lost response.

Migration `0018_player_audio_source` adds the `room_audio_source` enum (existing
rooms default to `DISCORD`), `room.host_character_id`, and makes
`community_room.guild_id` and `creator_id` nullable.

## Media path

The worker treats a player-source room as its own source group with ownership
key `player:<roomId>`, so player rooms never share a receiver. It claims the same
durable source receipt as a Discord source, then attaches a `PlayerSource` to
`MediaPeers` instead of connecting to Discord.

When a listener requests a media offer, the worker reads the room's running host
(`readUplinkHost`). If the listener's exact nickname matches, its peer gets one
`recvonly` audio transceiver instead of the usual `sendonly` playback track, and
the offer carries that transceiver's `uplinkMid`. Every other listener gets
`uplinkMid: null` and cannot publish.

## Choosing the input

The host picks the broadcast input in the room and can change it at any time:

- **Computer audio** uses the browser's screen-share picker
  (`getDisplayMedia`). Share a screen or tab with audio sharing on; the video
  track is stopped immediately. Echo cancellation, noise suppression and gain
  control are off so game audio is not treated as voice. Whole-screen system audio
  depends on the browser and operating system (Chrome on Windows offers it);
  otherwise share the tab or window that plays the audio. A share without audio
  shows a retry prompt, and ending the share returns to choosing an input.
- **Any audio input device** (microphone, Stereo Mix, a virtual cable) uses
  `getUserMedia` with voice processing on. Device names appear after the first
  permission grant; before that one default input is offered.

The uplink transceiver is always negotiated as `sendonly`, so switching inputs
replaces the sender track without renegotiation and stops the previous capture.
The capture belongs to the page, not to one peer: media reconnects reuse it
without asking again. A chosen device is remembered in local storage and starts
automatically on the next visit; computer audio always needs a click. Mute
disables the track. Leaving the room stops the capture.

The host reports broadcasting only after both capture and the media connection
are ready. A selected live capture alone does not establish audio delivery.
Browser candidate gathering waits up to ten seconds. If a discovery server is
still pending at that deadline, negotiation uses the candidates already in the
local description under the configured ICE policy. No candidates or cancellation
still stops that attempt. Controlled negotiation-stage diagnostics omit SDP,
credentials and raw transport errors.

The worker decodes the host's Opus RTP to 48 kHz stereo PCM and feeds the same
`GuildBroadcast` used for Discord: one Opus mix for room playback and an
independent speaker timeline for subtitles. The host does not receive its own
mix. Packets are accepted only while the peer is connected, its credential is
current, its room epoch is current and the attached source still names that
host. Closing the host peer removes the speaker; stopping or disbanding the room
retires the source and closes all of its peers.

## Limits

- The host is identified by character ID, the same trust model as entry. Anyone
  who passes AION2 Index verification with the host ID replaces the host session
  and becomes the publisher. There is no account or Discord proof of ownership.
- Creating a player-source room needs no Discord authorization; the only check is
  the AION2 Index host lookup. There is no rate limit. Unused rooms disband after
  five empty minutes. A repeated submission creates another room.
- The automated test uses real Werift peers and real Opus in both directions. A
  real browser microphone, permission prompt and production TURN path have not
  been exercised; see [validation](test-report.md).
