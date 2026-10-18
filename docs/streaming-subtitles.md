# Shared subtitle processing

`openSharedSubtitleStream` serves administrator samples and the Discord worker.
Each independently decoded member feeds original playback and a separate subtitle
timeline. The worker sends authorized subtitles over private streaming HTTP to
the web process, which relays them through the player's existing WebSocket. The
main page and Document PiP share the same presentation state. Initial language
configuration is empty; an administrator must validate and enable each path.

## Source and output ownership

A server owner creates one stream for one commander and source generation,
supplies that commander's mono 16-bit PCM once, and subscribes consumers by
output language. One Soniox connection supplies the transcript. Subscribers of
the same language and processing-path version share one translation lane;
different languages run independently. Matching settings are compared in a
canonical form, independent of JavaScript object key order.

Each subscriber gets only source updates accepted after it subscribed. Neither
cached text nor the completion of earlier queued work is replayed to it. This
is additional to the listener-session checks required at the delivery boundary;
it does not authorize a player or replace nickname-generation validation.

`replaceOutput` requires a higher processing-path version. It cancels the old
lane, clears its pending work, sends a reset event and waits for new source
updates. It retains that language's subscribers and does not restart recognition
or another output language. The worker reconciles saved configuration every
500 ms and advances a runtime path version when provider versions or included
terminology change. Recognition is shared by member, recognition configuration
and terminology policy/revision. Different recognition configurations or term
policies need additional provider sessions per member; adding listeners to a
matching path does not add recognition or translation work.

The last unsubscribe starts a two-second release grace period. A one-second
sweep closes unused lanes, so physical release occurs after roughly two to three
seconds. When all lanes are released, recognition closes too. Re-subscribing
during the grace period retains the lane but does not replay old results.
Explicit close and source failure cancel all outstanding work immediately.

## Revision handling and bounds

Source revisions replace the same utterance instead of adding another one.
Changed text clears the previous translation immediately and aborts obsolete
work. Completion checks both cancellation and the current text/language before
publishing. An unchanged text whose only change is finality can reuse its result
or in-flight request; this avoids charging again just for an endpoint marker.
Provisional and stable translations have distinct `translationIsFinal` values.

Each language has at most one active HTTP translation and one pending revision
per retained utterance. Provisional updates are coalesced with a 250 ms scheduling
interval. Request starts are bounded to four per second per source/language,
including stable utterances. This is an implementation safeguard; provider quota
and measured production capacity can require stricter limits.

A lane retains at most 32 utterances. If a burst exceeds that bound, it discards
the oldest work, cancels an affected in-flight request and marks discontinuity on
the new update. It never accumulates an unbounded backlog. Each source allows at
most 32 simultaneously retained output lanes. These bounds are not a claimed
player capacity or a required number of languages.

`sequence` identifies utterance order within a recognition stream, rather than
translation completion order. Revisions of one utterance retain the same
sequence. Delivery includes room/source/member identity and `streamGeneration`,
which advances on recognition restart, member re-entry and timed rotation.
The browser compares source, stream, configuration, sequence and revisions,
displaying at most the latest command per member, two members on the main page
and one in PiP. Translation completion does not reorder speakers. Stopping a
source clears its text and prevents late packets from reviving it.

Known audio times are milliseconds relative to that recognition stream's PCM
sample zero, identified by room/source/member/stream generation. Each 960-sample
frame represents 20 ms at 48 kHz; pauses use zero-filled frames. Provider times
are not Discord capture times or synchronized browser playback times. Missing
times remain null. `serverSentAt` records delivery creation, not measured latency.

PCM writes reuse the existing 20 ms frame and 500 ms socket-buffer bounds.
Sample offsets must be contiguous; pauses remain actual PCM samples. A source
failure discards its translation work and reports a safe failure code. A new
source instance does not adopt pending requests or cached text. The worker copies
stereo PCM into a separate 100 ms queue and downmixes each member to mono. It
discards pre-ready audio, retries failed recognition after five seconds and starts
a fresh stream after a queue overflow or event-loop gap over 100 ms, keeping
separate speech fragments from being silently joined. Translation failures do
not restart original playback or switch the selected language.

The worker rotates recognition at 290 minutes, before the adapter's 295-minute
safety cutoff and Soniox's documented [300-minute limit](https://soniox.com/docs/stt/rt/limits-and-quotas).
The adapter sends the documented keepalive when PCM pauses; live room timelines
normally continue to send actual silence. Rotation may lose speech during the
new connection; it clears the previous text and never replays buffered history.

## Authorized delivery and failure isolation

The private `/subtitles` NDJSON endpoint requires the configured worker control
secret and an actual registered player connection. Every event rechecks the
current listener/nickname generation, subscription version and enabled language.
Subtitle values additionally check persisted source and provider/path/term
versions immediately before sending. No public route accepts a destination URL,
provider credential or synthetic PCM. Subtitles are ephemeral, without stored
history or transcript logs.

Each subscriber has at most 16 queued events and 256 KiB of HTTP output. Slow
consumers are closed; the web relay reconnects after 1–15 seconds and discards
old subscription work. The relay bounds individual frames to 128 KiB, checks
schema/room/language, requires headers within five seconds and stream activity
within 25 seconds; the worker emits a blank heartbeat every ten seconds.
These limits do not claim a production player capacity. Database failures close
subtitle streams while the independently owned media path follows its own checks.

The existing player socket remains the revocation owner. Its physical close is
required before a replacement nickname can become active, and its closure aborts
the private stream. Switching language aborts the previous subscription, clears
page/PiP text and preserves the listener and original-audio peer.

## Administrator samples and evidence

The authorized sample endpoint uses this same engine with one output language.
It keeps the latest revision of up to 32 utterances, drains bounded translation
work, and returns the comparison after processing completes. It can translate
provisional text before recognition finishes, so a sample may incur multiple
translation requests for corrected speech. The page labels stable versus
provisional translations. The existing 30-second total deadline, two provider
leases, terminology snapshot checks and content-free audit remain in force.

The protocol tests use real loopback WebSocket/HTTP connections with explicitly
synthetic source text and translation responses. They exercise shared requests,
independent languages, uninterrupted PCM input while translation is held,
corrections, retraction, version replacement, queue overflow, subscriber release
and source failure. `test:subtitles:db` additionally uses an isolated disposable
database, the built web app, actual private HTTP/player WebSockets and a real
WebRTC receiver. It covers language sharing, nonzero per-member PCM, late results,
same-name speakers, source and credential replacement, disabled languages,
physical recognition closure, nickname revocation and audio during provider
delay/failure. Provider responses and PCM are explicitly synthetic. These tests
do not establish speech accuracy, live Discord-to-provider quality, live latency
or production capacity. See [the validation report](test-report.md).
