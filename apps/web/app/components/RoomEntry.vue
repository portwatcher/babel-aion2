<script setup lang="ts">
import { ENTRY_NOTICE, nicknameSchema } from '@babel/contracts'
import type { PublicRoomConfiguration } from '@babel/contracts'

const props = defineProps<{ configuration: PublicRoomConfiguration }>()
const nickname = ref('')
const outputLanguage = ref<string | null>(null)
const validationError = ref('')
const submitting = ref(false)
let pendingEntry: {
  nickname: string
  outputLanguage: string | null
  requestId: string
  credential: string
} | null = null

async function enter() {
  const result = nicknameSchema.safeParse(nickname.value)
  if (!result.success) {
    validationError.value = result.error.issues[0]?.message ?? '请检查昵称'
    return
  }
  submitting.value = true
  validationError.value = ''
  try {
    if (
      pendingEntry?.nickname !== result.data ||
      pendingEntry.outputLanguage !== outputLanguage.value
    ) {
      const bytes = crypto.getRandomValues(new Uint8Array(32))
      pendingEntry = {
        nickname: result.data,
        outputLanguage: outputLanguage.value,
        requestId: crypto.randomUUID(),
        credential: btoa(String.fromCharCode(...bytes))
          .replaceAll('+', '-')
          .replaceAll('/', '_')
          .replace(/=+$/, ''),
      }
    }
    await $fetch('/api/player/sessions', {
      method: 'POST',
      headers: { authorization: `Bearer ${pendingEntry.credential}` },
      body: {
        nickname: pendingEntry.nickname,
        outputLanguage: pendingEntry.outputLanguage,
        requestId: pendingEntry.requestId,
      },
    })
  } catch {
    validationError.value = '暂时无法进入收听，请稍后重试。'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <section class="entry-panel" aria-labelledby="entry-title">
    <h2 id="entry-title">准备进入</h2>
    <form class="entry-form" @submit.prevent="enter">
      <div class="field">
        <label for="nickname">游戏昵称</label>
        <InputText
          id="nickname"
          v-model="nickname"
          autocomplete="off"
          placeholder="输入你的角色名"
          :invalid="Boolean(validationError)"
          aria-describedby="nickname-limit nickname-notice entry-error"
        />
        <small id="nickname-limit" class="muted">最多 32 个字符，区分大小写。</small>
      </div>
      <div class="field">
        <label for="output-language">字幕语言</label>
        <Select
          v-model="outputLanguage"
          input-id="output-language"
          :options="props.configuration.outputLanguages"
          option-label="name"
          option-value="code"
          :disabled="!props.configuration.outputLanguages.length"
          placeholder="字幕尚未启用"
          aria-describedby="language-notice"
        />
        <small id="language-notice" class="muted"
          >管理员配置完成后，可在这里选择字幕语言。</small
        >
      </div>
      <p id="nickname-notice" class="entry-notice muted">{{ ENTRY_NOTICE }}</p>
      <p id="entry-error" class="form-error" role="alert">{{ validationError }}</p>
      <Button
        type="submit"
        :label="props.configuration.entryAvailable ? '进入收听' : '尚未开放收听'"
        :disabled="!props.configuration.entryAvailable"
        :loading="submitting"
        aria-describedby="availability-notice"
      />
      <small id="availability-notice" class="muted">等待语音频道接通后再进入。</small>
    </form>
  </section>
</template>
