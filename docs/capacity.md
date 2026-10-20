# Listener capacity

Target: five concurrently running rooms with 1,000 listeners in total, each with
an authenticated player WebSocket and a receive-only original-audio peer.

## What scales with listeners

| Work                                         | Grows with            | Implementation                                                             |
| -------------------------------------------- | --------------------- | -------------------------------------------------------------------------- |
| Recognition and translation provider streams | speakers × languages  | Shared per room speaker and language group; listeners add none             |
| Mixing and Opus encoding                     | rooms                 | One mix and one encoder per source group                                   |
| SRTP encryption and socket writes            | listeners × packets/s | Worker threads ("media shards"); direct transport writes with a cached key |
| Player socket verification                   | sockets               | One batched session query per web replica each second                      |
| Player list, configuration and map revision  | rooms                 | Read and serialized once per room per sweep, then sent to its sockets      |
| Media and subtitle authorization sweeps      | sockets               | One batched query per 500 ms sweep instead of one per listener             |
| Subtitle delivery fences                     | events                | Checked against the latest 500 ms authorization snapshot, valid for 1.5 s  |
| Tactical map reads                           | map changes           | Clients refetch when the pushed revision changes; 30-second repair poll    |
| Voice source ownership                       | rooms                 | All advisory locks of a worker share one dedicated PostgreSQL session      |

### Media shards

`MEDIA_WORKER_THREADS` (default 2, `0` keeps peers in-process) sets how many worker
threads own WebRTC peers. The main thread keeps authorization, PostgreSQL fencing,
lifecycle receipts, mixing and encoding; each encoded packet is posted once per
shard. A new peer goes to the least loaded shard. Closing a peer still resolves
only after the actual peer and its sockets stop. A lost shard thread is fatal for
the runtime, so the supervisor's confirmed-exit recovery applies.

Each shard encrypts with werift's SRTP session and writes to the DTLS transport
directly. Babel's offers negotiate no RTP header extensions and declare the SSRC,
so the packet matches what werift's sender would produce, without its per-packet
copy, extension and bandwidth bookkeeping. The SRTP session key is cached as a
`KeyObject`; Node otherwise derives one from a Buffer for every packet. werift
does not then send RTCP sender reports for these streams; audio playback does not
need them.

### Packet duration

`MEDIA_OPUS_FRAME_MS` (20, 40 or 60; default 60) sets the duration of each Opus
packet. Mixing stays at 20 ms; a 60 ms packet carries three mixed frames. Longer
packets cut packets per listener by three, and with them worker encryption, TURN
relaying, header bandwidth and browser decode work. The cost is up to 40 ms of
extra buffering before a packet is sent. Use 20 when the worker has spare CPU and
latency matters more than capacity.

The mixer follows the monotonic clock: a late interval callback mixes every frame
that is due. Previously each callback produced exactly one frame, so interval
drift ran playback about 5% slower than real time and the 100 ms queue bound
periodically discarded speech.

## Measured capacity — 2026-10-20

`npm run test:capacity:db` (script `scripts/capacity-smoke.mjs`) runs the built web
replicas, the built voice worker and PostgreSQL. Each room's host publishes a tone
through its WebRTC uplink; every other listener enters through HTTP, keeps an
authenticated player WebSocket and receives the room mix. Simulated listeners
renegotiate media like the browser. It fails if any listener loses audio, any
socket closes, any peer fails or renegotiates during the steady window, or the
1st-percentile packet rate is below 90% of real time.

Linux arm64 (Docker on Apple M3 Pro), worker pinned to 2 CPUs, each web replica
to 1 CPU, 2 media threads, worker pool 2, web pools 3, 60-second steady window:

| Packets | Relay                   | Listeners | Audio | Socket closes | Packets/s each | Worker CPU | Web CPU each | TURN CPU | DB tx/s |
| ------- | ----------------------- | --------- | ----- | ------------- | -------------- | ---------- | ------------ | -------- | ------- |
| 60 ms   | none                    | 1,000     | 1,000 | 0             | 16.7           | 0.58       | 0.03         | —        | 135     |
| 60 ms   | coturn 4.18, relay only | 1,000     | 1,000 | 0             | 16.7           | 0.65       | 0.03         | ~0.6     | 136     |
| 20 ms   | none                    | 1,000     | 1,000 | 0             | 49.3           | 1.52       | 0.12         | —        | 132     |

A browser listener in Chromium against the same build received 16.7 packets/s with
no loss or concealment and non-zero decoded audio energy.

Baselines from the same machine: werift's track send path costs 44 µs CPU per
packet against 15 µs for the shard path (300 peers, Linux). With the previous
source ownership, a worker pool of 2 could hold only one running room source; the
other rooms stayed connecting (`player-rooms.test.ts` reproduces this).

These are not DigitalOcean measurements. Shared AMD64 vCPUs are expected to be
slower per core than this machine; budget at least 1.5× the worker and TURN CPU.

## Production requirements

- Voice worker: 60 ms packets, 2 media threads, CPU limit 2 and a request of at
  least 1 CPU so the node cannot starve it; 1 GiB memory is sufficient.
- TURN: with relay-only policy every listener holds two relay allocations (worker
  and browser), each using one relay port. 1,000 listeners need at least 2,000
  relay ports reachable on the TURN host, plus about one CPU core.
- Public egress: about 105 kbit/s per listener at 96 kbit/s Opus and 60 ms packets
  (about 105 Mbit/s, or 47 GB per hour, for 1,000 listeners).
- Database: about 140 transactions per second; existing pool limits suffice.
