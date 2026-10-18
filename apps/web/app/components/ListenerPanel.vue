<script setup lang="ts">
import type { ListenerSnapshot, PublicRoomConfiguration } from '@babel/contracts'
defineProps<{
  session: ListenerSnapshot
  configuration: PublicRoomConfiguration
  connectionState: string
  busy: boolean
  changingLanguage: boolean
}>()
const emit = defineEmits<{ leave: []; language: [language: string | null] }>()
</script>

<template>
  <section class="entry-panel listener-panel" aria-labelledby="listener-title">
    <div class="section-heading">
      <h2 id="listener-title">{{ session.nickname }}</h2>
      <Tag
        :value="connectionState === 'connected' ? '已进入房间' : '正在恢复连接'"
        severity="secondary"
      />
    </div>
    <p v-if="session.state === 'JOINING'" role="status">正在等待收听通道就绪。</p>
    <p v-else role="status">会话已连接。</p>
    <p class="muted">指挥原声尚未接入。当前不会播放声音。</p>
    <OutputLanguageSelect
      :model-value="session.outputLanguage"
      :languages="configuration.outputLanguages"
      :disabled="changingLanguage"
      @update:model-value="emit('language', $event)"
    />
    <div class="subtitle-empty" aria-live="polite">
      <p>字幕尚未启用</p>
      <small class="muted">管理员配置识别与翻译后，指挥字幕会显示在这里。</small>
    </div>
    <Button
      label="退出房间"
      severity="secondary"
      :loading="busy"
      @click="emit('leave')"
    />
  </section>
</template>
