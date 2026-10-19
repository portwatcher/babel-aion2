<script setup lang="ts">
import {
  providerListSchema,
  providerSummarySchema,
  type ProviderSave,
  type ProviderSummary,
} from '@babel/contracts'
import { providerFailure, providerTestLabel } from '~/utils/provider-feedback'
defineProps<{ terminologyVersion: number | null }>()
const emit = defineEmits<{ change: [providers: ProviderSummary[]] }>()
const providers = shallowRef<ProviderSummary[]>([])
const current = computed(() => providers.value[0] ?? null)
const protectionReady = ref(false)
const busy = ref(false)
const loaded = ref(false)
const sampleBusy = ref(false)
const error = ref('')
const notice = ref('')
let disposed = false
async function load() {
  busy.value = true
  error.value = ''
  try {
    const value = providerListSchema.parse(await $fetch('/api/management/providers'))
    if (!disposed) {
      providers.value = value.configurations
      protectionReady.value = value.credentialProtectionReady
      loaded.value = true
      emit('change', providers.value)
    }
  } catch (failure) {
    if (!disposed) {
      error.value = providerFailure(failure)
    }
  } finally {
    busy.value = false
  }
}
async function operation(action: () => Promise<unknown>, message: string) {
  if (busy.value || sampleBusy.value) {
    return
  }
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    const value = providerSummarySchema.parse(await action())
    if (!disposed) {
      providers.value = [value]
      emit('change', providers.value)
      notice.value = message
    }
  } catch (failure) {
    if (!disposed) {
      error.value = providerFailure(failure)
    }
  } finally {
    busy.value = false
  }
}
async function save(input: ProviderSave) {
  const id = current.value?.id ?? '00000000-0000-4000-8000-000000000002'
  await operation(
    () =>
      $fetch<unknown, string>('/api/management/providers/' + id, {
        method: 'PUT',
        body: input,
      }),
    'API Key 已加密保存。',
  )
}
async function test() {
  const value = current.value
  if (!value) {
    return
  }
  await operation(
    () =>
      $fetch<unknown, string>('/api/management/providers/' + value.id + '/test', {
        method: 'POST',
        body: { expectedVersion: value.version },
      }),
    '已完成流式识别与翻译连接测试。',
  )
}
onMounted(load)
onBeforeUnmount(() => {
  disposed = true
})
</script>

<template>
  <section
    class="management-section"
    aria-labelledby="providers-title"
    :aria-busy="busy"
  >
    <div class="section-heading">
      <h2 id="providers-title">OpenAI 字幕服务</h2>
      <Button
        label="重新载入"
        severity="secondary"
        :disabled="busy || sampleBusy"
        @click="load"
      />
    </div>
    <p class="muted">
      一个 API Key 用于流式语音识别和多语言实时翻译，无需填写模型或接口地址。
    </p>
    <p v-if="loaded && !protectionReady" class="muted">
      服务器尚未配置凭据保护，暂不能保存或测试服务。
    </p>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <ProviderEditor
      v-if="loaded && protectionReady"
      :current="current"
      :busy="busy || sampleBusy"
      @save="save"
    />
    <div v-if="current" class="management-actions">
      <Tag
        :value="
          current.lastTest ? providerTestLabel(current.lastTest.code) : '尚未测试'
        "
        :severity="current.lastTest?.code === 'PASS' ? 'success' : 'secondary'"
      />
      <Button
        label="测试连接"
        severity="secondary"
        :disabled="busy || sampleBusy || !protectionReady"
        @click="test"
      />
    </div>
    <p class="muted">
      连接测试检查两种模型的访问权限；授权音频样本用于核对实际字幕。测试可能产生服务费用。
    </p>
    <ProviderSample
      :providers="providers"
      :disabled="busy || !protectionReady"
      :terminology-version="terminologyVersion"
      @busy="sampleBusy = $event"
    />
  </section>
</template>
