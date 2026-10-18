<script setup lang="ts">
import {
  providerSaveSchema,
  type ProviderSave,
  type ProviderSummary,
} from '@babel/contracts'

const props = defineProps<{ current: ProviderSummary | null; busy: boolean }>()
const emit = defineEmits<{ save: [input: ProviderSave]; cancel: [] }>()
const name = ref('')
const type = ref<'soniox' | 'deepl'>('soniox')
const model = ref('stt-rt-v5')
const endpoint = ref('https://api-free.deepl.com')
const seconds = ref('15')
const credential = ref('')
const error = ref('')
const types = [
  { label: 'Soniox · 语音识别候选', value: 'soniox' },
  { label: 'DeepL · 文本翻译候选', value: 'deepl' },
]
const models = [
  { label: '优先质量，自动兼容', value: 'prefer_quality_optimized' },
  { label: '优先质量', value: 'quality_optimized' },
  { label: '优先延迟', value: 'latency_optimized' },
]
const endpoints = [
  { label: 'DeepL API Free', value: 'https://api-free.deepl.com' },
  { label: 'DeepL API Pro', value: 'https://api.deepl.com' },
]
watch(
  type,
  (value) => {
    model.value = value === 'soniox' ? 'stt-rt-v5' : 'prefer_quality_optimized'
    credential.value = ''
  },
  { flush: 'sync' },
)
watch(
  () => props.current,
  (current) => {
    name.value = current?.name ?? ''
    type.value = current?.settings.type ?? 'soniox'
    model.value = current?.settings.model ?? 'stt-rt-v5'
    endpoint.value =
      current?.settings.type === 'deepl'
        ? current.settings.endpoint
        : 'https://api-free.deepl.com'
    seconds.value = String((current?.settings.timeoutMs ?? 15_000) / 1000)
    credential.value = ''
    error.value = ''
  },
  { immediate: true },
)
function submit() {
  const input = providerSaveSchema.safeParse({
    expectedVersion: props.current?.version ?? 0,
    name: name.value,
    settings: {
      type: type.value,
      model: model.value,
      timeoutMs: Number(seconds.value) * 1000,
      ...(type.value === 'deepl' ? { endpoint: endpoint.value } : {}),
    },
    ...(credential.value ? { credential: credential.value } : {}),
  })
  if (!input.success || (!props.current && !credential.value)) {
    error.value = '请检查名称、模型、测试超时和凭据。凭据不能包含空格。'
    return
  }
  emit('save', input.data)
  credential.value = ''
}
onBeforeUnmount(() => {
  credential.value = ''
})
</script>

<template>
  <form class="entry-form provider-editor" @submit.prevent="submit">
    <h3>{{ current ? `编辑「${current.name}」` : '新增候选配置' }}</h3>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <div class="field">
      <label for="provider-name">配置名称</label>
      <InputText
        id="provider-name"
        v-model="name"
        :disabled="busy"
        maxlength="80"
        required
      />
    </div>
    <div class="field">
      <label for="provider-type">服务与功能</label>
      <Select
        input-id="provider-type"
        v-model="type"
        :options="types"
        option-label="label"
        option-value="value"
        :disabled="busy || current !== null"
      />
    </div>
    <div v-if="type === 'deepl'" class="field">
      <label for="provider-endpoint">API 套餐</label>
      <Select
        input-id="provider-endpoint"
        v-model="endpoint"
        :options="endpoints"
        option-label="label"
        option-value="value"
        :disabled="busy"
      />
    </div>
    <p v-else class="muted">使用 Soniox 官方实时语音接口。</p>
    <div class="field">
      <label for="provider-model">模型</label>
      <InputText
        v-if="type === 'soniox'"
        id="provider-model"
        v-model="model"
        :disabled="busy"
        required
      />
      <Select
        v-else
        input-id="provider-model"
        v-model="model"
        :options="models"
        option-label="label"
        option-value="value"
        :disabled="busy"
      />
    </div>
    <div class="field">
      <label for="provider-timeout">连接测试超时（秒）</label>
      <InputText
        id="provider-timeout"
        v-model="seconds"
        type="number"
        min="1"
        max="30"
        :disabled="busy"
        required
      />
    </div>
    <div class="field">
      <label for="provider-credential">{{
        current ? '替换 API 凭据（可选）' : 'API 凭据'
      }}</label>
      <InputText
        id="provider-credential"
        v-model="credential"
        type="password"
        autocomplete="new-password"
        :spellcheck="false"
        :disabled="busy"
        :required="!current"
      />
      <small class="muted">{{
        current
          ? '留空保留已有凭据，保存后不会回显。'
          : '凭据仅在服务器加密保存，不会回显。'
      }}</small>
    </div>
    <p class="muted">更改已有连接参数或凭据时会先测试新设置。测试失败会保留原配置。</p>
    <div class="management-actions">
      <Button
        type="submit"
        :label="current ? '保存修改' : '保存候选配置'"
        :loading="busy"
      />
      <Button
        label="取消编辑"
        severity="secondary"
        :disabled="busy"
        @click="emit('cancel')"
      />
    </div>
  </form>
</template>
