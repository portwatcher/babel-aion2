# Room configuration

The administrator page can save room and Discord source settings and remove a
specific listener connection. The separate start action requests Discord
reception; source status reports actual worker state and decoded member counters.
Saved IDs and credentials alone are not proof of permissions or sound delivery.
Subtitle languages remain disabled until the complete delivery path is validated.

## HTTP operations

All operations require a verified Cloudflare Access assertion and its matching
Better Auth session. Mutations additionally require the configured same origin.
Responses are private and not cached.

| Operation                                     | Behavior                                                                                                                           |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/management/room`                    | Returns room settings, configuration/source versions, credential presence, and whether server credential protection is configured  |
| `PATCH /api/management/room`                  | Saves the full editable configuration with `expectedVersion`; an outdated version returns 409                                      |
| `POST /api/management/room/stop`              | Persists stopped state with `expectedVersion`; already-stopped state is idempotent                                                 |
| `POST /api/management/room/start`             | Validates version, configuration, credential decryption and reachable worker; persists running intent, not a receipt of live sound |
| `GET /api/management/room/source`             | Returns source state, safe failure category and independent member receive counters; unavailable worker returns 503                |
| `GET /api/management/listeners`               | Reads current listener sessions with their exact nickname generations                                                              |
| `DELETE /api/management/listeners/:sessionId` | Removes only the supplied `nicknameGeneration`; it cannot remove a replacement generation                                          |

The page polls the listener list every ten seconds and source state every three
seconds. Configuration is loaded on
entry or explicit reload, so background polling does not overwrite an unfinished
form. A conflict requires reloading before editing again. Reload discards local
unsaved fields. Removing a listener shows a confirmation for that exact connection.

## Fields and versions

The current implementation accepts a trimmed room name of 1–80 characters without
control/format characters, Discord IDs as 17–20 digit strings, and at most 100
distinct commander IDs. These are implementation limits, not live Discord
validation. Guild and voice channel must be supplied together; commanders require
a guild. The form accepts commander IDs on separate lines or separated by spaces
or commas. Unknown JSON fields are refused.

`captureMode` is required on full updates. `SELECTED_USERS` uses the commander ID
list; `ALL_CHANNEL` selects speaking members automatically and requires no IDs.
The form hides and clears the ID list when saving all-channel mode. Migration
0008 preserves `SELECTED_USERS` on existing rooms, so upgrading never expands an
existing source's scope. Guild, voice channel and credential are still required
for `sourceConfigured`; selected mode additionally needs a nonempty ID list.
This flag describes configuration completeness, not working audio reception.

Audio sources are Discord user IDs, with member nicknames for display. Independent
receivers/decoders keep speakers separate; only the playback branch is mixed.
One member's locally mixed microphone/game/music remains one Discord source.
Screen-share/Go Live audio needs its own compatibility proof.

Every successful save increments `configurationVersion` under the room row lock.
Changes to guild, channel, capture mode, commander membership, or saved credential also increment
`sourceGeneration` and persist `stopped: true`. Reordering the same commander set
does not change the source generation. Changing only the room name preserves the
source state. Starting or stopping advances both versions; a successful worker
claim advances the source generation again without changing the editable version.
The worker closes old Discord and media connections before writing a source close
receipt. The form distinguishes requested running state from the independently
polled source state. See [original audio](original-audio.md) for ownership and
recovery limits.

## Credentials

`NUXT_PROVIDER_ENCRYPTION_KEY` must be canonical base64 encoding of exactly 32
random bytes. The worker's `PROVIDER_ENCRYPTION_KEY` must use the same value.
The private Nuxt runtime setting never goes to the browser. With
no valid server key, the UI disables saving a new credential and the API returns
503 for a credential write. Unrelated settings can still be saved when no saved
credential needs decryption.

The bot credential accepts 20–4096 printable ASCII characters without spaces.
Saving a new value encrypts it with AES-256-GCM, a fresh 12-byte nonce and a 16-byte
authentication tag. The envelope is `v1.nonce.ciphertext.tag`, with canonical
base64url components. Authenticated context includes the format version, room ID
and `discord` purpose, so moving ciphertext to another room or altering it fails.
This format is internal server storage, not part of a browser response.

Omitting `credential` retains the existing value. `removeCredential: true` removes
it; combining removal and replacement is invalid. A normal save verifies that a
retained ciphertext can be decrypted, so a wrong key or damaged value cannot be
silently carried forward. Explicit replacement or removal can recover that state.
The page clears new credential input after a submitted operation, action change
or unmount, and never restores it from browser storage.

Read responses contain only `credentialConfigured`; `sourceConfigured` means the
required fields exist, not that the source has passed live validation. Neither
plaintext nor ciphertext is returned. Configuration audit records contain the
administrator identity, room ID, versions and whether the credential changed.
Request bodies, tokens and cryptographic failure details are not logged or exported.
Preserve the protected key separately from backups as described in
[operations](operations.md). Re-keying all stored credentials is not implemented.

## Verification

`npm run test:management:db` requires the built app and a migrated, disposable
loopback PostgreSQL database with no preconfigured bot credential. It uses generated
signing/encryption keys and a test-process JWKS response; the production server
still verifies the signature and the persisted administrator session. It covers
version conflicts, ciphertext integrity/context/key failures, safe read/audit
fields, process restart, stopped state and a real player WebSocket removed by an
authenticated administrator. No live Discord token is used.

An unconfirmed media shutdown remains DISCONNECTING in the list. Optional private
media admission confirms actual peer closure and a running source publishes
original audio. See [listener lifecycle](listener-sessions.md) and
[validation evidence](test-report.md) for these limits.
