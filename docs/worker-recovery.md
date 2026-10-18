# Confirmed worker process recovery

The worker entry point supervises a separate runtime process. The runtime owns
Discord/DAVE, native Opus decoders, WebRTC peers and subtitle jobs. The supervisor
owns no delivery sockets. Every runtime incarnation receives a new UUID over a
private IPC channel after its `runtime_owner` row has been registered.

Media negotiations and voice-source claims use that same incarnation ID. Their
transactions hold a shared owner-row lock until registration commits. Confirming
exit takes the exclusive lock and atomically records the owner's exit and closes
only its still-open media and voice registrations. A delayed registration either
commits before this reconciliation and is included, or sees the exited owner and
is rejected. Registering an exited UUID again cannot reactivate it.

## Exit and restart

Only the supervisor's own child `exit` event confirms physical process shutdown.
At that point its sockets and native threads have stopped. A failed spawn also
has no transports to retire. Heartbeat expiry, advisory-lock loss, elapsed time
and a PID lookup never provide this receipt.

After an unexpected exit, the supervisor persists the receipt before starting a
replacement. Storage operations have a two-second query deadline and retry after
one second; a blocked or unavailable database leaves the service unavailable.
Repeated crashes back off from one to thirty seconds. A runtime that survives
one minute resets that backoff. The replacement uses persisted room intent,
obtains normal exclusive source control and advances the source generation.
Stopped rooms remain stopped. Listener credentials and nickname generations do
not change; their existing media retry path negotiates a new peer.

SIGTERM/SIGINT first asks the child to close normally. If it has not exited after
five seconds, the supervisor terminates that child and still waits for the OS
exit event before writing its receipt. The runtime also starts shutdown if its
private parent IPC channel disappears. No public or private HTTP endpoint can
submit an exit acknowledgement or choose a runtime owner.

## Operations and limits

Apply migration `0010_cheerful_fenris` before starting this worker version. Build
and deploy both `dist/index.mjs` and `dist/runtime.mjs`; `npm run build` and the
existing Docker `voice-worker` target do this. Continue to launch `index.mjs`.
The runtime file refuses standalone startup. Allow at least fifteen seconds for
normal container termination; a storage outage can prevent acknowledgement
within that period and must remain fail-closed.

This recovers a runtime crash while its supervising parent survives. It does not
prove exit of an old parent/container/host after both processes disappear. Old
unregistered owners and unknown owners remain untouched. An orchestrator-level
shutdown proof and durable reconciliation are still required for that case.
Never clear these rows because they appear old. Web-owned player WebSocket
registrations have a separate lifecycle; their orphan recovery is also unfinished.
The current control endpoint still targets one worker and does not route media
between multiple workers.

## Evidence

`npm run test:recovery:db` creates its own disposable loopback PostgreSQL database,
starts built worker and web processes, negotiates actual ICE/DTLS connections and
kills one runtime with SIGKILL. It verifies OS UDP socket release, blocked receipt
persistence and timeout/retry, automatic recovery with the same listener identity,
rejection of an obsolete negotiation and survival of another runtime's peer.
It never supplies a simulated transport-close receipt.

The database suite separately checks the transaction race between pending
registration and exit, refusal to reuse a terminated UUID, voice-source generation
recovery and harmless repeated old-owner confirmation. Those are storage tests;
they do not claim live Discord shutdown. See the [test report](test-report.md).
