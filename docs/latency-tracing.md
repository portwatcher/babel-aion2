# Subtitle latency tracing

OpenTelemetry measures how long it takes from someone starting to speak to a
listener seeing the translated subtitle. Telemetry stays off unless an OTLP
endpoint is set. In production, the web and voice runtimes export OTLP/HTTP to
the in-cluster collector, which forwards to the homelab Tempo and Prometheus
behind Grafana.

## One trace per speech turn

| Span                             | Service       | Measures                                                           |
| -------------------------------- | ------------- | ------------------------------------------------------------------ |
| `babel.speech.turn` (root)       | `babel-voice` | First voiced Discord frame to last voiced frame of the turn        |
| `babel.subtitle.translation`     | `babel-voice` | Speech onset to the first new translated revision per language     |
| `babel.subtitle.worker_delivery` | `babel-voice` | Delivery queue wait plus per-event database authorization          |
| `babel.subtitle.web_relay`       | `babel-web`   | Private NDJSON chunk receipt to the player WebSocket write         |
| `babel.subtitle.player_transit`  | `babel-web`   | Socket write to estimated browser receipt (half the heartbeat RTT) |
| `babel.subtitle.browser_render`  | `babel-web`   | Browser receipt to the animation frame that paints the subtitle    |

A turn starts at the first frame with an int16 peak of at least 600 after at
least 800 ms without one. Its first new translated revision for each subscribed
language is the measured sample. Original-text updates do not count. The trace's
total duration is speech onset to display.

Histograms (milliseconds, buckets 100 ms to 30 s):

- `babel.subtitle.translation_latency` (worker): onset to first translated
  fragment.
- `babel.subtitle.visible_latency` (web): onset to the rendered subtitle.

Both carry `babel.output_language` and `babel.subtitle.attribution`; the
visible histogram also carries `babel.player.visible`. Prometheus receives them
through remote write as
`babel_subtitle_visible_latency_milliseconds_bucket` and similar series.
Spans carry the room UUID and language. They never carry subtitle text,
nicknames, Discord member IDs, credentials or listener session identifiers.

## Browser and clocks

The worker sends the W3C `traceparent` in a private `latency` field. The web
relay removes it and gives the browser only a random, single-use probe UUID. The
browser waits for Vue's DOM update and the next animation frame. It reports
`subtitle-displayed` with the probe and elapsed render delay on the existing
player WebSocket. It sends no timestamps, so browser clock offset cannot skew
the result. The server estimates display time as its send time plus half the
heartbeat round trip plus the reported render delay, capped at report receipt.
Before the first heartbeat, half of the unexplained report delay is used.
Unknown, repeated or reports older than 30 seconds are ignored. Each socket holds
at most 32 probes.

Hidden pages do not paint. They report after the DOM update with
`babel.player.visible=false`. Document Picture-in-Picture viewing with the main
tab hidden is counted as not visible.

## Limits

- The clock starts when the worker receives the first voiced packet, not when
  the speaker's microphone captured it. Discord capture, encoding and network
  time before the worker are not included.
- The OpenAI realtime translator has no utterance alignment. After a short
  pause, a fragment from the previous turn can arrive first and look fast. A
  first fragment within 1.5 s of the previous fragment for that language is
  `overlapped`. Dashboards should use `attribution="clean"`; it excludes some
  real samples rather than include doubtful ones.
- A dropped or replaced queued revision passes its probe to the replacement,
  which is what the listener sees first.
- Turns without listeners create no spans; speakers have streams only while a
  subtitle listener exists.

## Configuration

| Variable                              | Meaning                                                         |
| ------------------------------------- | --------------------------------------------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT`         | Base OTLP/HTTP URL; `/v1/traces` and `/v1/metrics` are added    |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`  | Full traces URL override                                        |
| `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` | Full metrics URL override                                       |
| `OTEL_TRACES_EXPORTER=none`           | Keep metrics, disable traces (same for `OTEL_METRICS_EXPORTER`) |
| `OTEL_TRACES_SAMPLER` / `_ARG`        | Standard sampler; default is always-on parent-based             |
| `OTEL_METRIC_EXPORT_INTERVAL`         | Metric export interval in ms, default 15,000                    |
| `OTEL_SERVICE_NAME`                   | Overrides `babel-web` / `babel-voice`                           |
| `OTEL_RESOURCE_ATTRIBUTES`            | Extra resource attributes such as `deployment.environment.name` |
| `OTEL_SDK_DISABLED=true`              | Disable all telemetry                                           |

Export timeouts are 5 s and shutdown flushing is bounded to 2 s, so an
unreachable collector cannot delay runtime shutdown or subtitle delivery.
Production endpoints, network policy and dashboards belong in the private infra
repository.
