# Player audio source

A room's audio comes from one of two sources, chosen when the room is created:

| Source          | Setup                                                    | Input                                 |
| --------------- | -------------------------------------------------------- | ------------------------------------- |
| `PLAYER` (host) | Room name, server, host character ID, optional allowlist | The host character's browser mic      |
| `DISCORD`       | Discord bot installation and voice-channel choice        | Speaking members of the voice channel |

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
`room.create` audit event. The page then opens the room; the host joins through
ordinary character verification.

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
`uplinkMid: null` and cannot publish. The browser fills the uplink transceiver
with a `getUserMedia` microphone track (echo cancellation, noise suppression and
automatic gain control on). Denied permission keeps the host joined, shows a
retry action and sends no track.

The worker decodes the host's Opus RTP to 48 kHz stereo PCM and feeds the same
`GuildBroadcast` used for Discord: one Opus mix for room playback and an
independent speaker timeline for subtitles. The host does not receive its own
mix. Packets are accepted only while the peer is connected, its credential is
current, its room epoch is current and the attached source still names that
host. Closing the host peer removes the speaker; stopping or disbanding the room
retires the source and closes all of its peers.

The host can mute the microphone (the track is disabled, not removed) and
re-acquire it with **Retry**.

## Limits

- The host is identified by character ID, the same trust model as entry. Anyone
  who passes AION2 Index verification with the host ID replaces the host session
  and becomes the publisher. There is no account or Discord proof of ownership.
- Creating a player-source room needs no Discord authorization; the only check is
  the AION2 Index host lookup. There is no rate limit. Unused rooms disband after
  five empty minutes. A repeated submission creates another room.
- Only microphone input is captured; game or system audio is not.
- The automated test uses real Werift peers and real Opus in both directions. A
  real browser microphone, permission prompt and production TURN path have not
  been exercised; see [validation](test-report.md).
