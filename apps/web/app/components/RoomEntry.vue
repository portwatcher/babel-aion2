<script setup lang="ts">
import {
  ENTRY_NOTICE,
  nicknameSchema,
  selectOutputLanguage,
  type PublicRoomConfiguration,
} from '@babel/contracts'
import { loadPendingEntry, savedLanguage, saveLanguage } from '~/utils/listener-client'

const props = defineProps<{
  configuration: PublicRoomConfiguration
  submitting: boolean
}>()
const emit = defineEmits<{ enter: [nickname: string, outputLanguage: string | null] }>()
const nickname = ref('')
const outputLanguage = ref<string | null>(null)
const validationError = ref('')

function selectLanguage() {
  outputLanguage.value = selectOutputLanguage(
    props.configuration.outputLanguages,
    navigator.languages?.length ? navigator.languages : [navigator.language],
    savedLanguage(),
    props.configuration.defaultOutputLanguage,
  )
}
onMounted(() => {
  nickname.value = loadPendingEntry()?.request.nickname ?? ''
  selectLanguage()
})
watch(
  () => props.configuration.outputLanguages,
  () => {
    if (import.meta.client) {
      selectLanguage()
    }
  },
)

function enter() {
  const result = nicknameSchema.safeParse(nickname.value)
  validationError.value = result.success
    ? ''
    : (result.error.issues[0]?.message ?? '请检查昵称')
  if (result.success) {
    emit('enter', result.data, outputLanguage.value)
  }
}
function changeLanguage(value: string | null) {
  outputLanguage.value = value
  saveLanguage(value)
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
          :disabled="submitting"
          aria-describedby="nickname-limit nickname-notice nickname-error"
        />
        <small id="nickname-limit" class="muted">最多 32 个字符，区分大小写。</small>
        <p id="nickname-error" class="form-error" role="alert">{{ validationError }}</p>
      </div>
      <OutputLanguageSelect
        :model-value="outputLanguage"
        :languages="configuration.outputLanguages"
        :disabled="submitting"
        @update:model-value="changeLanguage"
      />
      <p id="nickname-notice" class="entry-notice muted">{{ ENTRY_NOTICE }}</p>
      <Button
        type="submit"
        :label="configuration.entryAvailable ? '进入房间' : '暂时无法进入'"
        :disabled="!configuration.entryAvailable"
        :loading="submitting"
        aria-describedby="availability-notice"
      />
      <small id="availability-notice" class="muted"
        >语音尚未接通。进入后可查看在线名单，并等待收听通道就绪。</small
      >
    </form>
  </section>
</template>
