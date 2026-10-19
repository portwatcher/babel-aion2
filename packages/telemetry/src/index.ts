import {
  context,
  metrics,
  trace,
  isSpanContextValid,
  TraceFlags,
  type Context,
  type Span,
} from '@opentelemetry/api'
import { W3CTraceContextPropagator } from '@opentelemetry/core'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import {
  detectResources,
  envDetector,
  resourceFromAttributes,
} from '@opentelemetry/resources'
import {
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics'
import { BasicTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions'

export { SpanStatusCode, type Span } from '@opentelemetry/api'
export { subtitleLatencyBuckets } from './latency.ts'

type Environment = Record<string, string | undefined>

const propagator = new W3CTraceContextPropagator()
const traceparentPattern = /^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/u
let running: { shutdown: () => Promise<void> } | null = null

function endpoint(env: Environment, signal: 'traces' | 'metrics') {
  const specific = env[`OTEL_EXPORTER_OTLP_${signal.toUpperCase()}_ENDPOINT`]?.trim()
  if (specific) {
    return specific
  }
  const base = env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim().replace(/\/+$/u, '')
  return base ? `${base}/v1/${signal}` : null
}

/** Telemetry stays a no-op unless an OTLP endpoint is configured. Spans never
 * carry subtitle text, nicknames, credentials or Discord identities. */
export function startTelemetry(
  serviceName: 'babel-web' | 'babel-voice',
  env: Environment = process.env,
) {
  if (running) {
    return running
  }
  const traces = env.OTEL_TRACES_EXPORTER === 'none' ? null : endpoint(env, 'traces')
  const metricsUrl =
    env.OTEL_METRICS_EXPORTER === 'none' ? null : endpoint(env, 'metrics')
  if (env.OTEL_SDK_DISABLED === 'true' || (!traces && !metricsUrl)) {
    return null
  }
  // OTEL_SERVICE_NAME and OTEL_RESOURCE_ATTRIBUTES override the defaults.
  const resource = resourceFromAttributes({ [ATTR_SERVICE_NAME]: serviceName }).merge(
    detectResources({ detectors: [envDetector] }),
  )
  const tracerProvider = traces
    ? new BasicTracerProvider({
        resource,
        spanProcessors: [
          new BatchSpanProcessor(
            new OTLPTraceExporter({ url: traces, timeoutMillis: 5_000 }),
          ),
        ],
      })
    : null
  const interval = Number(env.OTEL_METRIC_EXPORT_INTERVAL ?? '15000')
  const meterProvider = metricsUrl
    ? new MeterProvider({
        resource,
        readers: [
          new PeriodicExportingMetricReader({
            exporter: new OTLPMetricExporter({ url: metricsUrl, timeoutMillis: 5_000 }),
            exportIntervalMillis:
              Number.isFinite(interval) && interval >= 1_000 ? interval : 15_000,
          }),
        ],
      })
    : null
  if (tracerProvider) {
    trace.setGlobalTracerProvider(tracerProvider)
  }
  if (meterProvider) {
    metrics.setGlobalMeterProvider(meterProvider)
  }
  running = {
    async shutdown() {
      // Export failures must not delay or fail process shutdown.
      await Promise.allSettled([tracerProvider?.shutdown(), meterProvider?.shutdown()])
    },
  }
  return running
}

/** Flush within a bounded time so shutdown never waits on an unreachable collector. */
export async function stopTelemetry(timeoutMs = 2_000) {
  const current = running
  running = null
  if (!current) {
    return
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    current.shutdown(),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs)
    }),
  ])
  clearTimeout(timer)
}

export function babelTracer() {
  return trace.getTracer('babel')
}

export function babelMeter() {
  return metrics.getMeter('babel')
}

/** A W3C traceparent for a sampled span, or null when tracing is off. */
export function traceparent(span: Span) {
  const spanContextValue = span.spanContext()
  // Ended spans no longer record, so check the sampled flag instead.
  if (
    !isSpanContextValid(spanContextValue) ||
    !(spanContextValue.traceFlags & TraceFlags.SAMPLED)
  ) {
    return null
  }
  const carrier: Record<string, string> = {}
  propagator.inject(spanContext(span), carrier, {
    set: (target, key, value) => {
      target[key] = value
    },
  })
  return carrier.traceparent ?? null
}

export function spanContext(span: Span): Context {
  return trace.setSpan(context.active(), span)
}

export function parentContext(value: string | null | undefined): Context {
  if (!value || !traceparentPattern.test(value)) {
    return context.active()
  }
  return propagator.extract(
    context.active(),
    { traceparent: value },
    {
      get: (carrier, key) => carrier[key as 'traceparent'],
      keys: (carrier) => Object.keys(carrier),
    },
  )
}
