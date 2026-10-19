<script setup lang="ts">
import type { OutputLanguage } from '@babel/contracts'
const { t } = useInterfaceLocale()
defineProps<{
  modelValue: string | null
  languages: OutputLanguage[]
  disabled?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string | null] }>()
</script>

<template>
  <div class="field">
    <label for="output-language">{{ t('outputLanguage') }}</label>
    <Select
      :model-value="modelValue"
      input-id="output-language"
      :options="languages"
      option-label="name"
      option-value="code"
      :disabled="disabled || !languages.length"
      :placeholder="
        languages.length ? t('selectOutputLanguage') : t('subtitlesDisabled')
      "
      aria-describedby="language-notice"
      @update:model-value="emit('update:modelValue', $event)"
    />
    <small v-if="!languages.length" id="language-notice" class="muted">{{
      t('outputLanguageUnavailable')
    }}</small>
    <small v-else id="language-notice" class="muted">{{
      t('outputLanguageHelp')
    }}</small>
  </div>
</template>
