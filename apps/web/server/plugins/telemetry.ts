import { startTelemetry, stopTelemetry } from '@babel/telemetry'

export default defineNitroPlugin((nitro) => {
  startTelemetry('babel-web')
  nitro.hooks.hook('close', () => stopTelemetry())
})
