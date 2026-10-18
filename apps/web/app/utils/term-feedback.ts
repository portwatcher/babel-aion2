import { managementFailure } from './management-errors'

export function termFailure(error: unknown) {
  const response =
    error && typeof error === 'object' && 'data' in error ? error.data : null
  const details =
    response && typeof response === 'object' && 'data' in response
      ? response.data
      : null
  const code =
    details && typeof details === 'object' && 'code' in details ? details.code : null
  if (code === 'DUPLICATE_TERM') {
    return '同一来源语言已有这个原词或别称，请编辑已有词条。'
  }
  if (code === 'INVALID_TERM') {
    return '请检查词条内容和语言代码；原词与别称不能重复，每个输出语言只能填写一种表达。'
  }
  if (code === 'NOT_FOUND') {
    return '此词条已不存在，请重新载入术语表。'
  }
  return managementFailure(error)
}
