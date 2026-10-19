# GOAL: BABEL

Document version: 3.2
Date: 2026-10-19
Product: Babel · AION2 深渊战
Game: AION2, Steam Global, Asia
Website: https://babel.juryquinn.com
Administrator page: https://babel.juryquinn.com/admin
Production repository: the existing infra repo

## 1. Document use

This document replaces the earlier documents for this Goal.
Use it as the project GOAL.md.
Obey the existing repository instructions.

Use the known infra repo.
Use its existing methods for production deployment.
Do not ask the user to select another domain.
Do not add requirements from an earlier document that conflict with this document.

## 2. Technical terms

| Term | Meaning |
|---|---|
| Player | A person who receives commands through the website. |
| Administrator | A person with permission from the Cloudflare Access policy. |
| Commander | A Discord member whose audio the administrator selects. |
| Nickname | The game character name that a player enters. |
| Nickname key | The stored form of a nickname for the comparison of names. |
| Listener session | The server record that controls one player's access to commands. |
| Nickname generation | A number that changes when a new listener session takes the same nickname. |
| Room | The website area for one set of commands and its players. |
| Player API | The HTTP API for player functions. |
| Management API | The HTTP API for administrator functions. |
| Player WebSocket | The connection for player subtitles, room status, and session messages. |
| Provider | A service for speech recognition or translation. |
| Provider adapter | Server code that uses a provider API. |
| Source language | The language that a commander speaks. |
| Output language | The language that a player selects for subtitles. |
| Transcript | Text from speech in the source language. |
| Subtitle | Text that the website shows in the output language. |
| Source generation | A number that changes when the server replaces an audio source. |
| Configuration version | A number that changes when an administrator saves new settings. |
| PiP | A separate browser window from the Document Picture-in-Picture API. |
| Credential | Secret data or a signed token for access to a service. |

Use each technical term with the same meaning throughout the project.

The software instructions use these technical verbs:

| Verb | Meaning |
|---|---|
| Configure | Set software parameters. |
| Deploy | Install a software release in the production system. |
| Authenticate | Do an identity check with a credential. |
| Authorize | Give access after the necessary access checks pass. |
| Revoke | Remove access permissions from a listener session or credential. |
| Encrypt | Convert data to a protected form that needs a key for recovery. |
| Transcribe | Convert speech to text in the source language. |
| Translate | Convert speech or text to the output language. |
| Subscribe | Start the receipt of an authorized data stream. |
| Save | Write software data to persistent storage. |
| Store | Put software data in a specified storage location. |
| Restore | Return software data or a listener session to a known state. |

Product names, protocol names, field names, and interface labels retain their exact forms.

## 3. Goal and scope

Make a website that players can use during AION2 battles.
Deploy the website at https://babel.juryquinn.com.
Put the production deployment configuration in the infra repo.

Use a server bot to receive audio from a configured Discord voice channel.
Support either selected member IDs or all speaking channel members.
In all-channel mode, discover speakers automatically; do not require commander IDs.
Send the original audio to players through the website.
Make subtitles from that audio.
Let each player select an output language.

Let a player enter with a nickname.
Show each listener session in the room's player list.
When a new player enters with the same nickname, remove the previous listener session.

Make an administrator page at /admin.
Use Cloudflare Zero Trust Access to protect that page.
Use the existing infra projects as the reference.

Let the administrator configure provider credentials on that page.
Let the administrator select the output languages on that page.

Do not add these functions:

- Steam login or player accounts.
- Game account login or character ownership checks.
- Player approval lists.
- Video relay or screen capture.
- OBS or a local broadcast program.
- A desktop application or browser extension.
- Game injection or game control.
- Microphone or camera capture from a player.
- Speech synthesis or translated audio.
- A separate administrator password system.
- An administrator WebSocket.

Commanders continue to use their existing Discord clients.
They do not need an additional broadcast program.

A nickname does not prove a player's identity.
A person can enter another person's nickname.
The new listener session still replaces the previous listener session.

### Multi-room amendment · 2026-10-19

This amendment takes precedence over the original single-room entry and global
nickname requirements below for community rooms. Previously stored rooms and legacy APIs remain available for compatibility;
new rooms are created only through Discord installation.

- `/` lists community rooms; `/rooms/:roomNumber` is one independent broadcast room.
  Public room numbers start at 1 and increase on creation. Assign existing
  community rooms numbers in creation order, preserve each number for its
  lifetime, and never reuse deleted numbers. Use numbers in shared links and
  public room APIs; UUID room links are not supported.
  A shared room URL is a direct entry point. Restore an existing valid room
  listener session; otherwise redirect to `/rooms/:roomNumber/verify` to verify a
  game character. Successful verification returns to the original room without
  creating another session. Do not require a player account or administrator
  login. Ended sessions return to verification; temporary restoration failures
  offer retry without treating the player as signed out.
- A creator must choose an Asia game server. An optional list of up to 200 exact
  character IDs restricts admission. An empty list admits any indexed character
  on the selected server.
- Creation requires Discord's full bot-installation OAuth2 flow. Request View
  Channel, Connect and Speak permissions automatically. Verify the creator can
  manage that guild and the installed bot can access the chosen voice channel,
  including channel permission overwrites. One guild can have multiple community
  rooms, including repeated installations of the same bot. Each installation
  creates a distinct room; retrying that same installation remains idempotent.
  Obtain the guild identity from Discord OAuth, never from a fixed server setting.
  Receive the guild's selected voice channel once, then distribute its audio to
  the guild's active rooms. Their admission policies, sessions and maps remain
  independent. Additional rooms use the guild's existing source channel.
  Read operations and administration must not create a default room.
- Verify entry server-side with AION2 Index's character-search API. Require an
  exact region, server and case-sensitive NFC character ID match. Use that
  returned ID as the session display name. Existence is not ownership proof.
- Community-room sessions replace duplicate IDs within that room. Different
  rooms have independent nickname generations. Preserve confirmed audio/subtitle
  revocation before authorizing replacement delivery.
- Every room has the specified Abyss Lower Reshanta map, original native zoom
  levels through 7, pan, wheel, pinch, keyboard and reset controls. Save strokes
  in map coordinates so movement and zoom never change their locations.
- Current room members can draw and erase their own complete strokes. Show line
  color, number and game ID on the map and in the adjacent list. Persist and
  synchronize changes across web replicas. Replacement, removal and expiry
  immediately revoke map reads and mutations.
- Keep administration at `/admin`, remove its public navigation link, and allow
  the authenticated administrator to select the room being managed.
- An administrator can publish the existing configured room by setting its
  required server and optional IDs once. Preserve its Discord source, end old
  unverified sessions and enforce the new admission policy on legacy entry too.
  Do not skip old same-ID transport closure during the namespace transition.
- Automatically disband a community room after five continuous minutes without
  members, starting at community-room creation, publication of an existing room,
  or confirmed shutdown of the last listener.
  JOINING and ACTIVE sessions keep the room open; unconfirmed transport shutdown
  blocks disbanding. New entry cancels expiry. Persist disbanding across replicas
  and restarts, close entry and administration, and stop only that room’s audio
  destination while other rooms in the guild continue.
- The product name is “Babel · AION2 深渊战”.

### Website administration scope · 2026-10-19

This amendment takes precedence over earlier room-administration instructions.
`/admin` is the website administrator page, not a room administration page.
It contains only the OpenAI API Key and game terminology. Do not show a room
selector, Discord server/channel fields, member controls, subtitle-language
configuration, sample uploads, service dashboards or room start/stop controls.
No room administrator feature is required. Discord server and channel bindings
come from the room-creation installation flow. Administrator authentication and
key/term configuration must work without any room being present or selected.

### Player audio source · 2026-10-19

Room creation offers a choice of audio source: player capture or Discord
capture. Player capture needs no Discord server, channel or bot installation.
The creator supplies the host character ID; when that character joins the room,
its own browser client publishes microphone audio as the room's original audio,
feeding both playback and subtitles. Other listeners only receive. Discord
capture keeps the existing installation flow.

## 4. Interface and API boundaries

Keep the player functions separate from the administrator functions.

| Caller | Destination | Access control |
|---|---|---|
| Player page | Player API | Public data or listener session checks for the specified operation. |
| Player page | Player WebSocket | Listener session checks. |
| Administrator page | Management API | The existing administrator authentication method from the infra repo. |

The /admin route identifies the administrator page.
It does not define the URL of the Management API.

Use the existing API route conventions.
Do not force the Management API below /admin.
Do not create /admin/ws.

The player page never calls the Management API.
The player page never needs administrator credentials.

Give the player page a public list of available output languages.
Send only the names, language codes, and other necessary public settings.
Do not include provider credentials or private provider configuration.

Use ordinary HTTP requests for administrator operations.
Use periodic HTTP requests for administrator status displays.

Keep the Player WebSocket separate.
Do not put administrator commands on that connection.

## 5. Administrator access

Read the Access configuration of other projects in the infra repo.
Use the same established method for this project.

Protect /admin and its page routes.
Protect each Management API operation with administrator authentication.
Use the existing API authentication arrangement for the actual API path.

Do not assume that page protection also protects an API at another path.

Do a check of the Access token signature.
Do a check of its issuer.
Do a check of its application audience.
Do a check of its validity period.

Do not accept an unverified email header as proof of administrator identity.
Do not accept a fabricated Access header.

Do not let direct origin requests bypass administrator authentication.
Use the same control for alternative routes that reach a management operation.

Use the existing protection against unauthorized cross-origin management requests.

Keep player entry outside the administrator Access policy.
A player does not need an Access login.

Record administrator changes with the authenticated identity.
Do not record complete credentials in the change record.

## 6. Player entry

Show the room name and audio status on the entry page.
Show a nickname field.
Show the available output languages.
Show an entry button.

Use this interface notice:

"进入后，你的昵称会显示在在线名单中。同昵称的新入场会使旧连接退出。"

Keep the visible nickname.
Remove spaces at the start and end.
Use Unicode NFC for the nickname key.
Reject empty names and control characters.
Set a clear length limit.

Until a confirmed game rule makes another comparison necessary, keep letter case significant.
Do not use fuzzy matching for nickname replacement.
Do not depend on a character lookup to compare nicknames.

Show the nickname as text.
Do not show nickname input as HTML.

After the player selects the entry button, create a listener session.
Complete the nickname replacement procedure before you authorize command delivery.

Try to start audio after the player's action.
If the browser blocks sound, show a button to start audio.

Do not request microphone, camera, or screen permissions.

## 7. Same nickname replacement

Let only one authorized listener session use each nickname key across the website.

Treat an explicit new entry as a request to replace the previous session.
Do not treat a network recovery as a new entry.

Use one atomic server update to select the current session.
Give each new entry a greater nickname generation.
Make repeated copies of the same entry request produce the same result.

Use this procedure:

1. Accept the new entry request.
2. Create the new listener session in the JOINING state.
3. Set the new nickname generation.
4. Mark the previous session as REPLACED.
5. Revoke the previous session's subtitle access.
6. Revoke the previous session's media access.
7. Stop credential renewal for the previous session.
8. Disconnect its media participant.
9. Confirm that the previous session cannot receive commands.
10. Do a check of the current nickname generation.
11. If the new session is still current, authorize it.

Show the new session in the player list before you send commands.

If the previous media connection remains active, keep the new session in JOINING.
Do not authorize both sessions to receive commands.

For simultaneous entry requests, let only the last successful server update control the nickname.

Use the session ID and generation in delayed operations.
Do not let an old operation remove a newer session.

### Previous browser page

Send the previous page a terminal session message.
Use the reason DUPLICATE_NICKNAME_REPLACED.

Stop its audio.
Stop its subtitles.
Close its PiP window.
Show this message:

"此昵称已在其他页面进入，你已退出收听。"

Do not automatically submit another entry request from that page.
Do not restore a replaced session after a page refresh.
Only a new player action can start another entry.

### Current browser page

Restore the current session after an ordinary page refresh.
Restore only a session that still has the current nickname generation.

Use the same session for its PiP window.
Use the same session when the player changes the output language.

Do not use a nickname alone as the media identity.
Do not depend only on the media server's duplicate-identity behavior.

## 8. Player list and session removal

Show all sessions that can receive audio or subtitles.

Show these public fields:

- Nickname.
- Entry time.
- Connection state.
- Character details, if a valid lookup supplies them.

Keep muted players in the list.
Keep players who select subtitles without sound in the list.
Keep players in the list when their browser page is in the background.

The list shows connections, not proof that a person hears the audio.

If media access remains uncertain during removal, show the old connection with the state DISCONNECTING.
Remove its list entry after command delivery stops.

Let the administrator remove a listener session.
Use the same removal procedure for manual removal and nickname replacement.

Use the Player WebSocket for subtitles and session messages.
Use a complete list response to repair missed player-list updates.

Compare the server's session records with the media server's actual connections.
Do not rely only on browser exit messages or connection events.

If a player connection gives no reply, revoke its command access before you remove its list entry.

An administrator who listens to commands also needs a visible listener session.
Do not count the server bot as a player.

## 9. Output languages

Let the administrator add, remove, enable, and disable output languages.
Let the administrator set their order.
Let the administrator select a default output language.

Use BCP 47 language codes.
Keep the website code separate from the provider's language parameter.
Map between these codes in the provider adapter.

Set up Simplified Chinese (`zh-Hans`), Japanese (`ja`) and Korean (`ko`) using
the saved OpenAI key. Validate their actual paths before enabling them. Complete
this production setup without asking the administrator to repeat language setup.
Do not hard-code the player menu to these three languages.

Show only the administrator's enabled languages in the player menu.
Do the same language check on the server.

### Initial selection

Use this order:

1. Use the player's saved choice if it is still enabled.
2. Match the browser preferences in navigator.languages.
3. Use navigator.language if the preference list is absent.
4. Use the administrator's default language if no browser preference matches.
5. Use the first enabled language if no valid default exists.
6. If no language is enabled, leave subtitle output inactive.

Match an exact language code first.
Then use a defined match for its language or writing system.

Use these examples in the language tests:

| Browser preference | Enabled language | Result |
|---|---|---|
| ja-JP | ja | Japanese |
| ko-KR | ko | Korean |
| zh-CN | zh-Hans | Simplified Chinese |

Keep Simplified Chinese and Traditional Chinese distinct.
Use the site default if no suitable match exists.

Keep website interface text separate from subtitle output.
The player interface supports English (`en`), Simplified Chinese (`zh-CN`),
Japanese (`ja`), and Korean (`ko`). Country shorthand cn/jp/kr maps to the
corresponding language code. Detect the initial interface locale from browser
preferences, including Accept-Language during server-side rendering. Fall back
to English if no supported preference matches.

Show a compact interface-language selector. An explicit selection overrides
browser detection and is saved in localStorage. Mirror the selection in a cookie
so later server-rendered requests use the same choice. Hydrate the server locale
before restoring browser-only storage. Keep the choice independent of subtitle
output language and the current listener session.

The administrator interface, shared administrator controls, and administrator
error pages use English only, regardless of browser or saved player locale.

### Language changes

Change only the subtitle subscription when a player selects another language.
Do not create another listener session.
Do not interrupt the original audio.

Remove the previous language's current subtitle.
Do not use delayed results from the previous subscription.
Use the new language on the main page and PiP.
Save an explicit player choice.

Send language-list changes to current players.
If an administrator disables the selected language, use the selection procedure again.
Tell the player about that change.

If all languages are disabled, continue the original audio.
Show that subtitles are not enabled.

Do not silently change the output language when a provider fails.
Show a fault for the selected language.

## 10. Provider settings and credentials

Use only OpenAI for speech recognition and translation.
The administrator enters one OpenAI API Key, with no endpoint, region, model,
provider type or second credential to configure.
Use `gpt-live-transcribe` with minimal transcription delay for original captions.
Use `gpt-realtime-translate` for direct speech translation to each target language.
Keep model names and official destinations in server code.

Let the administrator replace the encrypted key and run a connection test that
configures both actual model sessions. Show invalid key, unavailable model,
permission, rate limit and exhausted quota as safe, specific errors.
Keep versioned encrypted history and tested restoration at the server boundary.
One saved configuration can serve both recognition and translation references.

Translation currently supports 13 target language families: es, pt, fr, ja, ru,
zh, de, ko, hi, id, vi, it and en. Keep Chinese scripts distinct using local
script normalization, and validate each chosen output path before enabling it.
The translation API does not support custom prompts or glossaries. Use catalog
terms only as supported recognition hints; evaluate target terminology manually.
Already-target-language speech can produce no translation. Keep original captions
and original audio available without silently relabeling them as translated text.

### Secret storage

Store provider credentials only on the server.
Use the infra repo's existing secret management method.
Encrypt stored dynamic credentials with a protected server key or an equivalent secret facility.

Return only masked credential information to the administrator page.
Do not return a saved API key in plain text.
Do not send credentials to player pages.

Exclude credentials from source control, logs, metrics, and configuration exports.
Keep the recovery key separate from the encrypted data.

Restrict requests from provider connection tests to permitted service destinations.
Do not let player input set provider endpoints.

### Configuration changes

Use a valid saved configuration without a source-code change.
Use the new settings without a new application deployment.

Give each change a configuration version.
Replace only the affected provider connection.
Keep the original audio active.
Do not use delayed results from old configuration versions.

If a new configuration is invalid, keep the previous configuration.
Give the administrator a clear way to restore it.

Before a language becomes available, do a check of its configured processing path.
Do not advertise a language without an implemented path.

Treat temporary provider faults separately from disabled languages.

## 11. Initial configuration state

If provider credentials are absent, start production without them.
Let the output-language list be empty.

In this state:

- Keep the website available.
- Keep the administrator page available.
- Keep configured original audio available.
- Keep the player list available.
- Show that subtitles need administrator configuration.
- Do not show fabricated subtitles.
- Do not show nonexistent language choices.

Production setup includes the three requested languages. The administrator
provides only the OpenAI API Key and game terminology; do not require manual
language creation, path configuration or activation in administration.

After the user saves valid settings, start the selected subtitle path.
Start the configured path without another software change.

Keep the test configuration separate from the production configuration.

## 12. Audio and subtitle processing

Keep the original audio path separate from subtitle processing.

Use a separate audio receiver for each selected speaker.
In all-channel mode, select every speaking channel member automatically, excluding
the receiving bot itself, and update selection as members join or leave.
Decode each speaker's Opus data independently.
Send the decoded audio to the media path.
Send the same decoded frame concurrently to original-caption recognition and
each active direct speech translation path.

Do not mix speakers before speech recognition.
Use the Discord user ID as the stable speaker identity and display the member's
current nickname. Different users with the same nickname remain distinct.
Audio already mixed by one Discord member is one source; do not claim to separate
that member's microphone, game audio and music from Discord identity alone.
Screen-share/Go Live audio is a separate compatibility check, not an assumed part
of ordinary voice reception.

Use one shared original-caption recognition stream for each commander.
Translation sessions consume incoming audio directly in parallel with recognition.
Push each translated fragment immediately and display it on the page and PiP.
Do not wait for a complete sentence, original transcript or other output language.
Send the same target stream to all players who select that language.
Open a target translation session only while it has current subtitle subscribers.
When its last subscriber leaves or changes language, immediately stop forwarding
audio, discard pending frames and close that target without a release grace.
Do not push that language's results to other listeners. A new subscriber starts
a fresh target connection. If no subtitle subscribers remain, close recognition
and translation sessions while original audio continues independently.

Do not create a recognition or translation job for each player.

If a provider needs separate speech sessions for output languages, share each session among that language's players.
Record the extra provider use from this design.

Do not invent multi-language parameters that a provider does not accept.

Start a language path when a player needs it.
Release unused provider connections immediately, without a release delay or
keeping unselected language paths warm.
Do a periodic check for unused connections that an earlier event did not remove.

### Stream control

Use bounded queues for audio and subtitle work.
Measure audio queues in milliseconds of audio.

Do not let a slow translation request delay original audio.
Discard obsolete work after a connection failure.
Return to current commands after recovery.

Keep real pauses in the audio timeline.
Do not join separate speech fragments as continuous speech.

Use the provider's documented keepalive and session limits.
Replace long sessions before their duration limit.

Keep only the current useful translation work for a subtitle revision.
Do not use an older result that arrives after a newer result.

Do not translate through Chinese as a fixed intermediate language.

## 13. Subtitle meaning and terms

Use a game term list that the administrator can edit.
Let the administrator set a different term for each output language.

Include these fields:

- Source term.
- Source language.
- Alternative expressions.
- Game category.
- Output-language expressions.
- Short context.
- Version.

Use terms for the actual AION2 Global release.
Do not substitute unconfirmed terms from another game or regional release.

Keep these parts of a command:

- Negation.
- Direction.
- Target.
- Team number.
- Quantity.
- Time and countdown.
- Attack, retreat, wait, and interrupt actions.
- Corrections from the commander.

Do not add tactical advice.
Do not infer a location from unclear words such as "here".

Keep the source text available for comparison.
Distinguish provisional subtitles from stable subtitles.

Replace an existing subtitle when its revision changes.
Do not append the same subtitle repeatedly.
Do not retain an obsolete order as the current command.

### Subtitle data

Use language-independent fields.
Do not use a fixed chineseText field.

Include these data items:

- roomId.
- sourceGeneration.
- speakerId.
- speakerDisplayName.
- utteranceId.
- sourceRevision.
- translationRevision.
- sequence.
- sourceLanguage.
- originalText.
- outputLanguage.
- translatedText.
- sourceIsFinal.
- translationIsFinal.
- configurationVersion.
- Known audio times.
- Server send time.
- Failure or discontinuity state.

Do not fabricate exact timestamps that the provider does not supply.
Use a documented mapping between source audio and subtitle segments.

Do not send earlier battle history to a new player by default.

## 14. Background audio and PiP

Make the original audio continue when the player returns to the game.

Use Document Picture-in-Picture for a text-only subtitle window.
Use a compact strip with one or two lines.
Let the player change text size.

Show the current speaker and the selected output language's subtitle.
Show a short connection message when a fault prevents updates.

Use a player action to open PiP.
Use the browser's controls for audible playback.
If another action is necessary, show a clear button.

Use one audio output for each listener session.
Do not start a second audio connection when PiP opens.

If the player closes PiP, continue audio on the main page.
If the listener session ends, stop both audio and subtitles.

Update text from network events.
Do not depend on animation frames from a hidden page.
Do not repeatedly take focus from the game.

Do a feature check before you show the PiP button.
If PiP is unavailable, keep the main audio and subtitle page usable.

Do not simulate PiP with a video stream.
Do not add a desktop program.

The browser controls the minimum window size and border.
The window can receive mouse input.
The website cannot promise mouse click-through or coverage above every exclusive fullscreen game mode.

Do a test with AION2 in the actual supported display mode.
Record the browser and game display mode.

## 15. Discord bot and media service

Use a normal Discord bot account.
Keep the bot token on the server.

Configure the guild, voice channel and capture mode.
SELECTED_USERS uses the configured commander IDs; ALL_CHANNEL discovers members
automatically and does not require that list. Preserve SELECTED_USERS for existing
configurations. A capture-mode change advances the source generation and stops
the old source before the new scope may start.
Store Discord IDs as strings.

Use only the necessary bot permissions.
Set selfDeaf to false.
Set selfMute to true when the bot does not send audio to Discord.

Use a compatible Discord voice library with DAVE.
Do a live audio test after you select dependency versions.
A bot's presence in a voice channel does not prove successful audio reception.

Do not let two workers control the same bot in the same guild.
Use the existing infra method for exclusive control.
Stop a worker's output when it loses that control.

Use separate decoder state for each speaker in either capture mode.
Use small audio frames for media publication.
Set the sample rate, channel count, and sample count correctly.

Keep all audio queues bounded.
Keep buffer ownership until an asynchronous audio operation finishes.

Use a media service that the browser can receive without capture permissions.
LiveKit is an implementation option.
Use its media SDK for audio publication if you select it.
Do not use its server-management SDK as an audio publisher.

Give players receive-only media permissions.
Do not let players publish audio, video, subtitles, or administrator commands.

### Removal and recovery

Use credentials that the server can revoke in practice.
Do a test with old credentials after session removal.

Do not assume that token expiry stops an existing media connection.
Do not assume that a disconnect operation prevents a new connection with an old token.

Select a proven revocation method for the actual media service.
Do not prescribe an extra gateway unless that method needs one.

Do a check of the listener session and nickname generation on every new connection.
Use the same checks after a network failure.

Keep the list entry until the server confirms that command delivery has stopped.

Recover Discord, media, recognition, and translation connections independently.
Release old timers and listeners.
Do not use output from old source generations.

If the administrator stops the room, keep it stopped after a restart.
Do not send commands from an unconfigured voice channel.

## 16. Optional character details

Use aion2index only through a permitted data path that operates correctly.

Try the Global and Asia data for the configured room.
Use an actual API or public page response.
Record the observed request and response structure.

Do not invent a search endpoint or a permanent character ID.
Do not bypass an access restriction.

If the source refuses access, stop that data path.
If the source is unavailable, keep nickname entry available.

Show whether a nickname has matched public character details.
Do not claim character ownership.
Do not claim a server match without source data.

Cache successful results.
Limit repeated requests.
Do not query the character site for player-list heartbeats.

Distinguish these results:

- Match.
- Multiple matches.
- No match from a successful request.
- Temporary failure.
- Access refusal.
- Disabled source.
- Changed response structure.

A source failure does not mean that a character does not exist.

Keep this optional function outside the core audio and session paths.

## 17. Production deployment

Read the existing infra projects before you create deployment files.

Use their methods for:

- Application images.
- Service resources.
- Network routes.
- DNS and TLS.
- Cloudflare Access.
- Secrets.
- Persistent storage.
- Databases.
- Logs and metrics.
- Releases and recovery.

Deploy the website to babel.juryquinn.com.
Deploy the administrator page at /admin.
Put the production resource changes in the infra repo.

Use existing services where they meet the project needs.
Do not force a new database, cache, or deployment platform without a technical reason.

Keep long-running audio workers on a suitable server runtime.
Do not use a request-only function for a continuous Discord voice connection.

Do a check of actual media transport.
An HTTP proxy does not prove that WebRTC audio works.

Configure the public media addresses and necessary ports.
If the network needs TURN, configure a suitable TURN path.
Do a test of normal media transport and its fallback.

Use a real mainland China player network for an end-to-end network test.
Do not use a server-side HTTP request as proof of player audio reception.

Do not claim coverage for networks or game modes without test evidence.

### Operation

Configure automatic service restart.
Keep administrator settings after restart.
Supply database migrations.
Write a backup procedure.
Do a restore test.
Write a release rollback procedure.

Keep complete battle recordings off by default.
Use authorized audio samples for quality tests.

Record service faults without credentials.

## 18. Required checks

Do functional tests with the actual application.
Use live services where the necessary credentials are available.

### Access boundaries

- An unauthorized request cannot open the administrator page.
- An unauthorized request cannot call a Management API operation.
- A player page calls no Management API operation.
- A player needs no Cloudflare Access login.
- A fabricated identity header gives no administrator permission.
- A direct origin request cannot bypass management authentication.
- No administrator WebSocket exists.

### Nickname replacement

- A new entry with the same nickname stops the previous player's audio.
- The replacement also stops the previous player's subtitles.
- The previous page shows the replacement message.
- The previous page does not automatically enter again.
- Concurrent requests leave only one authorized session.
- A repeated request does not replace an unrelated newer session.
- An old cleanup operation cannot remove the new session.
- Ordinary recovery preserves only the current session.
- A language change does not replace the listener session.

### Output languages

- Browser preferences select an enabled language.
- A valid saved choice takes priority.
- An unsupported preference uses the defined fallback.
- The server refuses an output language outside the enabled list.
- A language change preserves original audio.
- Old-language results cannot appear after the change.
- A disabled language triggers a clear fallback.
- An empty language list keeps audio available.
- Different players can receive different output languages.
- Players of the same language share provider work.

### Providers

- The administrator can save provider configurations.
- The administrator can replace credentials.
- Read responses do not expose saved secrets.
- A real connection test reports actual provider errors.
- Valid changes take effect without deployment.
- An invalid change does not replace the previous configuration.
- Restart preserves settings.
- Unused provider connections stop.

### Audio and subtitles

- Selected members, or all speaking members in all-channel mode, reach the player.
- Excluded members and users in other channels do not reach the player.
- Different speakers retain their correct identities, including simultaneous
  speech, identical display names and members joining or leaving.
- DAVE changes and member re-entry do not cause permanent audio loss.
- Translation faults do not stop original audio.
- Subtitle revisions do not produce duplicates.
- Old source output cannot replace current output.
- Recovery does not replay obsolete commands.

### Browser and operation

- Background audio works in the supported browser.
- PiP shows the selected language.
- PiP does not create duplicate sound.
- Session replacement also ends PiP delivery.
- The actual AION2 display mode passes the PiP test.
- Production restart preserves configuration.
- Backup restoration works.
- Release rollback works.

## 19. Performance and quality evidence

Measure the actual system.
Record the test load and network conditions.

Measure original-audio delay separately from subtitle delay.
Measure the delay to the first useful subtitle.
Measure the delay to the stable subtitle.
Record the median and the 95th percentile.

Include the source device in any claimed end-to-end audio measurement.
Do not call a bot-to-browser measurement a microphone-to-player measurement.

Use representative battle commands for quality checks.
Include negation, direction, numbers, game terms, and corrections.
Compare each output language with a reliable reference.
Record errors for each language separately.

Do not treat a successful API response as proof of correct translation.
Do not use Chinese results as proof of Japanese or Korean quality.

Use synthetic audio only as identified test data.
Keep live test results separate from simulated results.

Find the useful capacity of the deployed system.
Record the number of simultaneous players and active languages.
Do not invent a user requirement for a fixed capacity, provider count, or sample count.

Correct measured faults that prevent practical battle use.
Record remaining limits with their evidence.

## 20. Work order and missing inputs

Start with the existing infra configuration.
Make the smallest live audio path first.
Then add nickname replacement and the player list.
Then add provider settings and output languages.
Then add PiP.
Then complete recovery and production checks.

Use existing authorized credentials when available.
Do not ask the user to repeat known repository or domain information.

If an external input is absent, continue all work that does not need it.
Give the user one clear list of the missing inputs.
State which live checks need each input.

Do not stop deployment because the user will configure production languages later.
Do not fill production with test credentials or assumed language settings.

If a live provider test is impossible, record it as not performed.
Do not report fabricated translation quality.

## 21. Delivery

Give the user these items:

- The production website URL.
- The administrator page URL.
- The application source.
- The infra changes.
- The release versions.
- The provider configuration instructions.
- The language configuration instructions.
- The operating instructions.
- The backup and restore instructions.
- The rollback instructions.
- The test report.

Include these documents in the project:

- GOAL.md.
- README.md.
- docs/architecture.md.
- docs/deployment.md.
- docs/access-control.md.
- docs/providers-and-languages.md.
- docs/operations.md.
- docs/test-report.md.

Record PASS, FAIL, NOT RUN, or WAITING FOR CONFIGURATION for each applicable test.
Give evidence for each PASS result.

Delivery is complete when the required functions operate on the production domain and the core checks pass.
The administrator can then configure providers and languages without another software change.

Complete the requested Chinese, Japanese and Korean language setup before
handover when the authorized key is available. An empty language list is allowed
when no valid credential exists.
This state does not prove that live subtitle quality has passed.

Report the actual state of each subtitle provider and language.
Do not report unperformed core audio, access, or session tests as complete.

Give a final report for the website.
State the actual enabled status of Chinese, Japanese and Korean.
State which live checks passed.
State any remaining external inputs or measured limits.

## 22. References

Writing reference:
https://www.asd-ste100.org/assets/files/ASD-STE100_ISSUE9.pdf

Existing infrastructure:
The local infra repo and its existing project configurations.

Cloudflare Access:
https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/
https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/

Discord voice:
https://docs.discord.com/developers/topics/voice-connections
https://discord.js.org/docs/packages/voice/stable

Document Picture-in-Picture:
https://developer.chrome.com/docs/web-platform/document-picture-in-picture
https://wicg.github.io/document-picture-in-picture/

Browser language:
https://developer.mozilla.org/en-US/docs/Web/API/Navigator/languages

LiveKit:
https://docs.livekit.io/transport/media/publish/
https://docs.livekit.io/intro/basics/rooms-participants-tracks/participants/
https://docs.livekit.io/transport/self-hosting/ports-firewall/

OpenAI:
https://developers.openai.com/api/docs/guides/realtime-transcription
https://developers.openai.com/api/docs/guides/realtime-translation
https://developers.openai.com/cookbook/examples/voice_solutions/realtime_translation_guide

Optional character source:
https://aion2index.com/
https://aion2index.com/about
