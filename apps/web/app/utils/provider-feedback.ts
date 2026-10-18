import { providerTestCodeSchema, type ProviderTestCode } from '@babel/contracts'
import { managementFailure } from './management-errors'

const labels: Record<ProviderTestCode, string> = {
  PASS: '连接测试通过',
  INVALID_CREDENTIAL: '凭据无效',
  MODEL_UNAVAILABLE: '模型不可用',
  QUOTA_EXHAUSTED: '额度已用尽',
  RATE_LIMITED: '服务请求受限',
  PERMISSION_DENIED: '凭据权限不足',
  INVALID_CONFIGURATION: '服务不接受这些设置',
  TIMEOUT: '连接测试超时',
  UNAVAILABLE: '服务暂时不可用',
  INVALID_RESPONSE: '服务响应不完整',
}
export const providerTestLabel = (code: ProviderTestCode) => labels[code]

export function providerFailure(error: unknown) {
  const details =
    error && typeof error === 'object' && 'data' in error ? error.data : null
  const data =
    details && typeof details === 'object' && 'data' in details ? details.data : null
  if (data && typeof data === 'object' && 'code' in data) {
    if (data.code === 'INVALID_AUDIO') {
      return '请检查语言代码，并选择 0.2–10 秒的单声道、16 位 PCM WAV（16 或 48 kHz）。'
    }
    if (data.code === 'REQUEST_TOO_LARGE') {
      return '样本文件过大，请选择不超过 1 MB 的 WAV。'
    }
    if (data.code === 'CONNECTION_TEST_FAILED' && 'testCode' in data) {
      const code = providerTestCodeSchema.safeParse(data.testCode)
      if (code.success) {
        return `${providerTestLabel(code.data)}。原配置未更改。`
      }
    }
    if (data.code === 'TEST_IN_PROGRESS') {
      return '此配置的连接测试正在进行，请稍后重试。'
    }
    if (data.code === 'TEST_COOLDOWN') {
      return '请在上次测试开始至少 10 秒后重试。'
    }
    if (data.code === 'PROVIDER_IN_USE') {
      return '语言路径仍在引用此配置，请先解除引用。'
    }
    if (data.code === 'TYPE_IMMUTABLE') {
      return '服务类型不能更换，请新增另一份配置。'
    }
  }
  return managementFailure(error)
}
