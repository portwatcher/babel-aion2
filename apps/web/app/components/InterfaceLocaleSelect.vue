<script setup lang="ts">
const { t, locale, select } = useInterfaceLocale()
const options = [
  { label: 'English', value: 'en' },
  { label: '简体中文', value: 'zh-CN' },
  { label: '日本語', value: 'ja' },
  { label: '한국어', value: 'ko' },
]
</script>

<template>
  <Select
    class="interface-locale-select"
    :model-value="locale"
    :options="options"
    option-label="label"
    option-value="value"
    size="small"
    :aria-label="t('interfaceLanguage')"
    @update:model-value="select"
  />
</template>
