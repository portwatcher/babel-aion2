# Confirmed application process recovery

Web and voice-worker entry points share the supervisor in `@babel/processes`.
Each runs its application in a separate child process. The web child owns player
WebSockets; the voice child owns Discord/DAVE, Opus, WebRTC and subtitle jobs.
Supervisors own no delivery sockets. Each child receives a fresh UUID through
private IPC after its `runtime_owner` row has been registered.
Each supervisor uses at most one database connection; runtime pools are budgeted
separately. See [database connection budgets](operations.md#database-connection-budget).

Player sockets, media negotiations and voice-source claims record their owning
incarnation. Their registration transactions hold a shared owner-row lock until
commit. Exit reconciliation takes the exclusive lock and atomically marks the
owner exited and closes only its open registrations. A delayed registration
commits before reconciliation and is included, or sees the exited owner and is
rejected. An exited UUID cannot be registered again. A connection for the same
listener on another live web process is unaffected.

## Exit and restart

Only a supervisor observing its own child `exit` event confirms physical process
shutdown. The child's sockets and native threads have stopped at that point.
A failed spawn also has no transports to retire. Heartbeat expiry, advisory-lock
loss, elapsed time and a PID lookup never supply this receipt.

The supervisor persists closure before starting a replacement. Storage queries
have a two-second deadline and retry after one second. A blocked or unavailable
database prevents restart. Repeated crashes back off from one to thirty seconds;
a runtime surviving one minute resets the backoff.

A restarted web child accepts the saved listener identity and nickname generation.
If a different browser claims that nickname during shutdown, it remains JOINING
until both subtitle and media receipts are confirmed. Old credentials then receive
only their terminal state. A restarted voice child obtains normal exclusive source
control and advances source generation. Persisted stopped rooms remain stopped.
Original audio and provider processing still have independent recovery paths.

SIGTERM/SIGINT requests normal child shutdown. Web shutdown stops admission and
starts closing player sockets immediately, before Nitro waits for connections to
drain. Its normal close code is 1012. The close hook waits for ongoing work, removes
signal handlers and closes PostgreSQL. If a child has not exited after five seconds,
its supervisor terminates it but still waits for the OS exit event before
acknowledging that incarnation. Private IPC disconnection also initiates child
shutdown. No HTTP endpoint can submit an exit receipt or choose an owner ID.

## Operations and limits

Apply migrations through `0012_parallel_toad` before starting these versions.
Migration 0010 creates runtime ownership; 0011 adds an indexed nullable owner to
player connections. Existing rows remain unknown rather than receiving an invented
owner. Never infer that these historical sockets have stopped from their age.

`npm run build` generates all entry points. Start the web app with `npm run start`
or `node --env-file=.env apps/web/.output/server/supervisor.mjs`. Its Docker image
also launches the supervisor. Start the voice worker with
`node --env-file=.env apps/voice-worker/dist/index.mjs`. Deploy both worker bundles
and the complete web `.output`. The framework's raw `server/index.mjs` is not the
supported configured production entry point. Bootstrap identity is internal and
is not a user-configured `.env` setting.

Without database configuration, the web entry point serves the public lobby with
entry and readiness unavailable. With a database, `/api/health/ready` verifies
runtime ownership and schema readiness; `/api/health/live` alone does not prove
player admission is ready. Nuxt development mode registers its own incarnation
and uses the same socket/authorization checks. It is not supervised: a hard dev
crash leaves an unknown owner. Administrator Access has no development bypass.

Allow at least fifteen seconds for normal container termination. A storage outage
can prevent acknowledgement within that period and must remain fail-closed.
Child recovery requires a surviving supervisor. The separate
[Kubernetes recovery controller](kubernetes-recovery.md) can reconcile a lost
container after verified kubelet termination. Unknown host termination and
historical owners without Pod identity remain fail-closed. Multi-worker media
routing also remains unfinished.

## Evidence

`npm run test:recovery:db` uses isolated loopback databases and built processes.
The worker case exercises real ICE/DTLS, SIGKILL, OS UDP release, blocked receipt
timeout/retry, same-listener recovery and another runtime's surviving peer.
The web case exercises actual sockets across two processes: SIGKILL and close
receipts, same-session reconnection, a surviving connection for that same listener
on another process, blocked nickname replacement, old-credential denial and normal
SIGTERM close code 1012. Neither test supplies simulated transport-close receipts.

Database tests separately protect delayed registration, terminated-ID rejection,
source generation, repeated old-owner confirmation and untouched legacy unknown
player rows. Those tests exercise storage, not live Discord shutdown. See the
[test report](test-report.md) for current platform evidence and limits.

Production subsequently passed graceful GitOps worker replacement with a live
Discord source and real Chrome listener. Settings and encrypted credentials were
preserved, old owners exited with code 0, their source/media receipts closed, and
the browser recovered within its existing listener generation. The rollout also
exposed a cross-node TURN routing failure; the deployed worker now uses the
existing internal Service and the browser connection plus actual member receipt
recovered. This proves controlled worker replacement, not abrupt loss of the
supervisor, container or host. See the
[production lifecycle report](test-report.md#production-sessions-and-graceful-worker-recovery--2026-10-19).
