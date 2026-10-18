<script setup lang="ts">
import type { OutputLanguage } from '@babel/contracts'
defineProps<{
  modelValue: string | null
  languages: OutputLanguage[]
  disabled?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string | null] }>()
</script>

<template>
  <div class="field">
    <label for="output-language">字幕语言</label>
    <Select
      :model-value="modelValue"
      input-id="output-language"
      :options="languages"
      option-label="name"
      option-value="code"
      :disabled="disabled || !languages.length"
      :placeholder="languages.length ? '选择字幕语言' : '字幕尚未启用'"
      aria-describedby="language-notice"
      @update:model-value="emit('update:modelValue', $event)"
    />
    <small v-if="!languages.length" id="language-notice" class="muted"
      >管理员启用字幕后，可在这里选择语言。原声不受字幕设置影响。</small
    >
    <small v-else id="language-notice" class="muted">切换字幕语言不会中断原声。</small>
  </div>
</template>
