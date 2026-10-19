# Media network configuration

The worker accepts explicit STUN/TURN configuration. With none configured it uses
IPv4 host candidates and ICE-lite; it does not use Werift's implicit public Google
STUN default. This default is suitable only when the player's browser can reach
the worker's advertised local addresses. HTTP readiness does not prove this path.

## Private runtime settings

| Setting                    | Meaning                                                                                              |
| -------------------------- | ---------------------------------------------------------------------------------------------------- |
| `MEDIA_STUN_URL`           | One `stun:` URL. STUN TLS is not supported by the selected worker.                                   |
| `MEDIA_TURN_URLS`          | JSON array of up to four browser `turn:` or `turns:` URLs. `turns:` requires TCP.                    |
| `MEDIA_TURN_SHARED_SECRET` | At least 32 printable ASCII characters, shared with Coturn `use-auth-secret`. Never sent to players. |
| `MEDIA_WORKER_TURN_URL`    | Optional separate worker endpoint. Otherwise the worker uses the first browser TURN URL.             |
| `MEDIA_ICE_POLICY`         | Worker `all` (default) or `relay`. When combining TURN with `all`, explicitly configure STUN too.    |
| `MEDIA_BROWSER_ICE_POLICY` | Browser `all` (default) or `relay`. Relay policies require TURN.                                     |
| `MEDIA_TURN_TTL_SECONDS`   | Temporary credential lifetime, 60–86,400 seconds; default 3,600.                                     |
| `MEDIA_ICE_BIND_ADDRESS`   | Optional actual local, non-loopback IPv4 interface.                                                  |
| `MEDIA_ICE_PORT_RANGE`     | Optional inclusive `min-max` range (1,024–65,535), requiring the bind address.                       |

These are worker environment settings. They are not public Nuxt configuration.
Incomplete or invalid combinations fail worker startup with a generic error.
Set credentials in ignored local configuration or the private infra secret store.
Certificate verification stays enabled for `turns:`. Deployment certificates must
be trusted by both the worker and browsers. Do not disable TLS checks.

Werift 0.25.1 uses one worker TURN destination. It retries a failed UDP allocation
over TCP at the same destination; it does not automatically try every URL or move
from TCP to TLS. Choose the worker's endpoint accordingly. The browser receives
all configured browser URLs. `MEDIA_ICE_PORT_RANGE` bounds local UDP sockets, not
Coturn's separate relay range or TCP/TLS client ports. Public NAT mappings and
firewall rules must match the advertised addresses and ports.

## Credentials, renewal and revocation

Only an authorized ACTIVE listener can obtain an offer containing temporary TURN
credentials. Worker and browser receive independently random usernames of the
form `expiry:nonce` with an HMAC-SHA1 password, following the
[Coturn REST authentication mechanism](https://github.com/coturn/coturn/blob/master/README.turnserver).
Nicknames, listener credentials and the shared relay secret are not embedded in
those usernames. Public player configuration contains no relay credentials.

The browser renews around 30 seconds before expiry by making another authenticated
media attempt in the same listener and nickname generation. It physically closes
the previous peer before negotiating the next one, so a brief audio interruption
is possible. The worker stops publication at expiry and acknowledges expiry only
after physical peer closure. Expiry is not a substitute for nickname replacement:
replacement still revokes application delivery immediately through the existing
registration and close protocol. A temporary TURN credential alone cannot join a
Babel media session, though it can allocate relay capacity until its expiry.

Offer control has a 20-second deadline; the browser allows 25 seconds for that
request and 10 seconds for local candidate gathering. Unconnected worker peers
are closed after 45 seconds. Offers without usable candidates fail rather than
advertise readiness. Repeated network failure follows the existing bounded retry
path and does not allocate a new listener identity.

## Local verification boundary

After `npm run build`, use Docker, OpenSSL and disposable loopback PostgreSQL:

```sh
npm run test:network:db
```

The fixture creates its own database, random Coturn shared secret and one-day TLS
certificate, starts pinned Coturn 4.18.0-r0, and removes those resources afterward.
Only the child test process trusts its certificate through `NODE_EXTRA_CA_CERTS`;
the operating system and browser trust stores are unchanged. Coturn control ports
bind only to host loopback. Both media endpoints relay within the Docker network,
so no public relay range or loopback-peer exception is needed.

Tests exercise the real web authorization route, private control, production media
publisher, SRTP, native Opus decoding and persisted physical-close receipts. They
do not establish public NAT behavior, production network capacity, browser TLS
trust, China mainland reachability, or Discord-to-player latency. Those remain
separate deployment and human acceptance gates.

## Production verification

The 2026-10-19 [deployment check](deployment.md#current-web-and-voice-verification--2026-10-19)
separately verified public UDP/TCP relay allocation, bidirectional data between the
actual worker and an external relay client, and normal Chrome media connection
and exit with relay required at both ends. The production source remained
UNCONFIGURED; this was not Discord speech, restricted-network/TLS compatibility,
mainland-China latency or capacity proof. Endpoint addresses, shared credentials
and firewall rules remain in private infra.

A later normal worker replacement exposed a cross-node routing failure: the
worker could connect to Discord but TCP allocation against the TURN node's public
address timed out. The same pod successfully allocated through the existing
cluster Service and exchanged ten packets each way with an external public
allocation. The private deployment now uses that Service for
`MEDIA_WORKER_TURN_URL`; browser TURN URLs retain the public endpoints. The
deployed probe and Chrome reconnection passed after the change, without adding
network permissions or public services. An initially healthy co-located worker
does not prove the route works after rescheduling.

See [production recovery evidence](test-report.md#production-sessions-and-graceful-worker-recovery--2026-10-19).
Audible playback, player-network coverage and capacity remain separate checks.
