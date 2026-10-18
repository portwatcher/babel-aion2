import type { PublicRoomConfiguration } from '@babel/contracts'

export const audioStatus: Record<
  PublicRoomConfiguration['room']['audioState'],
  {
    label: string
    description: string
  }
> = {
  UNCONFIGURED: {
    label: '等待配置',
    description: '管理员配置语音来源后，可以在这里收听频道原声。',
  },
  STOPPED: { label: '已停止', description: '房间原声已停止，等待管理员启动。' },
  STOPPING: { label: '正在停止', description: '正在关闭旧来源与播放连接。' },
  CONNECTING: { label: '正在连接', description: '正在连接 Discord 语音频道。' },
  LISTENING: { label: '频道已接入', description: '原声来源已连接，等待频道成员发言。' },
  UNAVAILABLE: { label: '正在恢复', description: '语音来源暂不可用，正在重试连接。' },
}
