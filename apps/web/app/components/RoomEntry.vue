<script setup lang="ts">
import {
  NICKNAME_MAX_LENGTH,
  nicknameSchema,
  selectOutputLanguage,
  type PublicRoomConfiguration,
} from '@babel/contracts'
import { loadPendingEntry, savedLanguage, saveLanguage } from '~/utils/listener-client'

const { t } = useInterfaceLocale()
const props = defineProps<{
  configuration: PublicRoomConfiguration
  submitting: boolean
}>()
const emit = defineEmits<{ enter: [nickname: string, outputLanguage: string | null] }>()
const nickname = ref('')
const outputLanguage = ref<string | null>(null)
const validationKey = ref<
  'nicknameRequired' | 'nicknameControl' | 'nicknameTooLong' | null
>(null)
const validationError = computed(() =>
  validationKey.value ? t(validationKey.value, { count: NICKNAME_MAX_LENGTH }) : '',
)

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
  const issue = result.success ? null : result.error.issues[0]?.message
  validationKey.value = result.success
    ? null
    : issue === 'nicknameControl' || issue === 'nicknameTooLong'
      ? issue
      : 'nicknameRequired'
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
    <h2 id="entry-title">{{ t('prepareEntry') }}</h2>
    <form class="entry-form" @submit.prevent="enter">
      <div class="field">
        <label for="nickname">{{ t('nickname') }}</label>
        <InputText
          id="nickname"
          v-model="nickname"
          autocomplete="off"
          :placeholder="t('nicknamePlaceholder')"
          :invalid="Boolean(validationError)"
          :disabled="submitting"
          aria-describedby="nickname-limit nickname-notice nickname-error"
        />
        <small id="nickname-limit" class="muted">{{
          t('nicknameLimit', { count: NICKNAME_MAX_LENGTH })
        }}</small>
        <p id="nickname-error" class="form-error" role="alert">{{ validationError }}</p>
      </div>
      <OutputLanguageSelect
        :model-value="outputLanguage"
        :languages="configuration.outputLanguages"
        :disabled="submitting"
        @update:model-value="changeLanguage"
      />
      <p id="nickname-notice" class="entry-notice muted">{{ t('entryNotice') }}</p>
      <Button
        type="submit"
        :label="configuration.entryAvailable ? t('joinRoom') : t('entryUnavailable')"
        :disabled="!configuration.entryAvailable"
        :loading="submitting"
        aria-describedby="availability-notice"
      />
      <small id="availability-notice" class="muted">{{ t('entryAvailability') }}</small>
    </form>
  </section>
</template>
