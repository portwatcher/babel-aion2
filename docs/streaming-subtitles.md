# Shared subtitle processing

`@babel/providers` now supplies `openSharedSubtitleStream`, used by the actual
administrator audio-sample operation. Recognition and translation overlap in
time. This module has no audio publisher: slow translation does not block its
PCM input, but browser original-audio delivery still requires a verified media
adapter. The Discord worker and authorized player subtitle delivery are not yet
connected to this engine. Production languages and providers remain disabled.

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
or another output language. The future configuration coordinator must advance
this path version when provider choice, credentials or other path inputs change.
These are runtime replacements, not a database-backed language enable operation.

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
sequence. A delivery owner must include room/source/speaker identity and use this
order to prevent a delayed earlier utterance from becoming the current command.
Known audio times remain provider-relative data; missing times stay null.

PCM writes reuse the existing 20 ms frame and 500 ms socket-buffer bounds.
Sample offsets must be contiguous; pauses remain actual PCM samples. A source
failure discards its translation work and reports a safe failure code. A new
source instance does not adopt its pending requests or cached text. The eventual
worker must advance source generation, reconnect independently and replace long
recognition sessions before their duration limit. This module does not yet
implement that worker lifecycle or media revocation.

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
and source failure. They do not establish speech accuracy, browser audio,
Discord/DAVE compatibility, live latency or production capacity.
