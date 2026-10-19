<script setup lang="ts">
import {
  languageCodeSchema,
  languageSaveSchema,
  type LanguageSave,
  type ManagedLanguage,
  type ProviderSummary,
} from '@babel/contracts'

const props = defineProps<{
  current: ManagedLanguage | null
  providers: ProviderSummary[]
  busy: boolean
}>()
const emit = defineEmits<{ save: [code: string, input: LanguageSave]; cancel: [] }>()
const code = ref(props.current?.code ?? '')
const name = ref(props.current?.name ?? '')
const recognitionId = computed(() => props.providers[0]?.id ?? '')
const translationId = recognitionId
const includeTerms = ref(props.current?.includeTerms ?? true)
const error = ref('')
onMounted(() =>
  document.getElementById(props.current ? 'output-name' : 'output-code')?.focus(),
)

function save() {
  if (props.busy) {
    return
  }
  error.value = ''
  let canonical: string
  try {
    canonical = new Intl.Locale(code.value.trim()).baseName
  } catch {
    error.value = '请输入有效的语言代码，例如 zh-Hans、zh-Hant、ja 或 ko。'
    return
  }
  const input = languageSaveSchema.safeParse({
    expectedVersion: props.current?.version ?? 0,
    name: name.value,
    recognitionConfigurationId: recognitionId.value,
    translationConfigurationId: translationId.value,
    includeTerms: includeTerms.value,
  })
  if (!languageCodeSchema.safeParse(canonical).success || !input.success) {
    error.value = '请检查语言代码、显示名称，并先保存 OpenAI API Key。'
    return
  }
  emit('save', canonical, input.data)
}
</script>

<template>
  <form class="entry-form provider-editor" @submit.prevent="save">
    <h3>{{ current ? `编辑输出语言：${current.name}` : '新增输出语言' }}</h3>
    <div class="management-fields">
      <div class="field">
        <label for="output-code">语言代码</label>
        <InputText
          id="output-code"
          v-model="code"
          maxlength="35"
          :disabled="busy || !!current"
          placeholder="例如 zh-Hans、ja、ko"
          required
        />
        <small class="muted"
          >支持中文、日语、韩语、英语、西班牙语、葡萄牙语、法语、俄语、德语、印地语、印尼语、越南语和意大利语。简繁分别使用
          zh-Hans 与 zh-Hant，代码保存后不可更改。</small
        >
      </div>
      <div class="field">
        <label for="output-name">显示名称</label>
        <InputText
          id="output-name"
          v-model="name"
          maxlength="80"
          :disabled="busy"
          placeholder="例如 简体中文"
          required
        />
      </div>
    </div>
    <div class="check-field">
      <Checkbox
        input-id="output-terms"
        v-model="includeTerms"
        binary
        :disabled="busy || current?.enabled"
      />
      <label for="output-terms">使用已启用的游戏术语提示</label>
    </div>
    <small class="muted"
      >保存后需用授权音频验证路径。启用术语提示时，词表仅用于识别提示；实时翻译模型暂不支持自定义词表。</small
    >
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <div class="management-actions">
      <Button type="submit" label="保存输出语言" :loading="busy" :disabled="busy" />
      <Button
        label="取消编辑语言"
        severity="secondary"
        :disabled="busy"
        @click="emit('cancel')"
      />
    </div>
  </form>
</template>
