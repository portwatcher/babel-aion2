import type { ManagedLanguage } from '@babel/contracts'
import { providerFailure, providerTestLabel } from './provider-feedback'

export function languageValidationLabel(language: ManagedLanguage) {
  return {
    NOT_TESTED: '尚未验证样本路径',
    CURRENT: '当前样本路径已验证',
    STALE: '配置已变化，需重新验证',
  }[language.validationState]
}

export function languageAttemptLabel(language: ManagedLanguage) {
  const code = language.lastAttempt?.code
  return code === 'PASS'
    ? '样本路径通过'
    : code === 'NO_SPEECH'
      ? '未识别出稳定语音'
      : code
        ? providerTestLabel(code)
        : '尚未测试'
}

export function languageFailure(error: unknown) {
  const details =
    error && typeof error === 'object' && 'data' in error ? error.data : null
  const data =
    details && typeof details === 'object' && 'data' in details ? details.data : null
  if (data && typeof data === 'object' && 'code' in data) {
    switch (data.code) {
      case 'INVALID_LANGUAGE':
        return '请检查语言代码、名称和必填配置。'
      case 'INVALID_PATH':
        return '请先保存有效的 OpenAI API Key。'
      case 'PATH_UNVALIDATED':
        return '请先使用授权样本验证当前语言路径。'
      case 'DELIVERY_UNAVAILABLE':
        return '玩家字幕投递尚未接通，暂不能启用语言。'
      case 'LANGUAGE_ENABLED':
        return '请先停用此语言，再更换路径或删除。'
      case 'VERSION_CONFLICT':
        return '语言或服务配置已被更新，请重新载入后重试。'
      case 'NOT_FOUND':
        return '此语言或配置已不存在，请重新载入。'
    }
  }
  return providerFailure(error)
}
