import type { InterfaceMessageKey } from '~/locales'

// Existing player APIs supply these safe classifications as status messages.
// Translate known failures without displaying arbitrary upstream response text.
const messages: Record<string, InterfaceMessageKey> = {
  房间不存在: 'roomNotFound',
  'Discord 房间创建尚未配置': 'creationUnavailable',
  '请先安装 Discord Bot': 'installFirst',
  '请先完成 Discord 安装': 'installFirst',
  '此 Discord 服务器已有房间，请加入现有房间': 'guildInUse',
  '安装已过期，请重新安装': 'installationExpired',
  '房间服务暂时不可用，请稍后重试': 'roomsUnavailable',
  '请填写房间名称、区服和有效的角色 ID 列表': 'roomSettingsInvalid',
  请选择语音频道: 'channelMissing',
  'Bot 没有此语音频道的足够权限，请检查频道覆盖权限': 'botPermissionsMissing',
  凭据保护暂时不可用: 'credentialProtectionUnavailable',
  '请检查游戏角色 ID 和字幕语言': 'characterInvalid',
  '请输入有效的游戏角色 ID': 'characterInvalid',
  此角色不在房主指定的加入名单中: 'characterDenied',
  'AION2 Index 未找到本区服的此角色，请检查角色 ID': 'characterNotFound',
  'AION2 Index 暂时无法验证，请稍后重试': 'characterUnavailable',
}

export function playerErrorKey(
  failure: unknown,
  fallback: InterfaceMessageKey = 'operationFailed',
): InterfaceMessageKey {
  const data =
    failure && typeof failure === 'object' && 'data' in failure ? failure.data : null
  const message =
    typeof failure === 'string'
      ? failure
      : data && typeof data === 'object' && 'statusMessage' in data
        ? data.statusMessage
        : failure instanceof Error
          ? failure.message
          : null
  return typeof message === 'string' ? (messages[message] ?? fallback) : fallback
}
