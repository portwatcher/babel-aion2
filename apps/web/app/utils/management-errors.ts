export function managementFailure(error: unknown) {
  const status =
    error && typeof error === 'object' && 'statusCode' in error
      ? error.statusCode
      : null
  if (status === 409) {
    return '配置已在另一处更新。请重新载入，再提交修改。'
  }
  if (status === 401 || status === 403) {
    return '管理会话已失效，请通过 Access 重新登录。'
  }
  if (status === 400) {
    return '请检查填写的设置，服务器未保存这次修改。'
  }
  return '操作结果尚未确认，请重新载入核对。'
}
