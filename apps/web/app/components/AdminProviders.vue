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
const protectionReady = ref(false)
const busy = ref(false)
const loaded = ref(false)
const error = ref('')
const notice = ref('')
const editing = ref(false)
const selected = shallowRef<ProviderSummary | null>(null)
const removing = shallowRef<ProviderSummary | null>(null)
const restoreVersion = ref<number | null>(null)
const candidateId = ref('')
let disposed = false

async function load() {
  busy.value = true
  error.value = ''
  try {
    const response = providerListSchema.parse(await $fetch('/api/management/providers'))
    if (!disposed) {
      providers.value = response.configurations
      emit('change', providers.value)
      protectionReady.value = response.credentialProtectionReady
      loaded.value = true
      editing.value = false
      selected.value = null
      removing.value = null
    }
  } catch (failure) {
    if (!disposed) {
      error.value = providerFailure(failure)
    }
  } finally {
    busy.value = false
  }
}
function edit(provider: ProviderSummary | null) {
  selected.value = provider
  candidateId.value = provider?.id ?? crypto.randomUUID()
  restoreVersion.value = null
  editing.value = true
  notice.value = ''
  error.value = ''
}
function accept(provider: ProviderSummary) {
  providers.value = [
    ...providers.value.filter((row) => row.id !== provider.id),
    provider,
  ]
  emit('change', providers.value)
  if (editing.value && candidateId.value === provider.id) {
    selected.value = provider
  }
}
async function operation(action: () => Promise<unknown>, success: string) {
  if (busy.value) {
    return
  }
  busy.value = true
  notice.value = ''
  error.value = ''
  try {
    const provider = providerSummarySchema.parse(await action())
    if (!disposed) {
      accept(provider)
      notice.value = success
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
  await operation(
    () =>
      $fetch<unknown, string>(`/api/management/providers/${candidateId.value}`, {
        method: 'PUT',
        body: input,
      }),
    '配置已保存。字幕通道尚未启用。',
  )
}
async function test(provider: ProviderSummary) {
  await operation(
    () =>
      $fetch<unknown, string>(`/api/management/providers/${provider.id}/test`, {
        method: 'POST',
        body: { expectedVersion: provider.version },
      }),
    '连接测试已结束，请查看该配置的结果。',
  )
}
async function restore() {
  const provider = selected.value
  if (!provider || !restoreVersion.value) {
    return
  }
  await operation(
    () =>
      $fetch<unknown, string>(`/api/management/providers/${provider.id}/restore`, {
        method: 'POST',
        body: {
          expectedVersion: provider.version,
          restoreVersion: restoreVersion.value,
        },
      }),
    '历史设置已通过连接测试，并保存为新版本。',
  )
  restoreVersion.value = null
}
async function remove() {
  if (!removing.value || busy.value) {
    return
  }
  const provider = removing.value
  busy.value = true
  error.value = ''
  try {
    await $fetch<unknown, string>(`/api/management/providers/${provider.id}`, {
      method: 'DELETE',
      body: { expectedVersion: provider.version },
    })
    if (!disposed) {
      providers.value = providers.value.filter((row) => row.id !== provider.id)
      emit('change', providers.value)
      removing.value = null
      if (selected.value?.id === provider.id) {
        editing.value = false
        selected.value = null
      }
      notice.value = '配置及其凭据历史已删除。'
    }
  } catch (failure) {
    if (!disposed) {
      error.value = providerFailure(failure)
    }
  } finally {
    busy.value = false
  }
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
      <h2 id="providers-title">字幕服务配置</h2>
      <div class="management-actions">
        <Button
          label="新增候选配置"
          :disabled="busy || !loaded || !protectionReady"
          @click="edit(null)"
        />
        <Button
          label="重新载入服务配置"
          severity="secondary"
          :disabled="busy"
          @click="load"
        />
      </div>
    </div>
    <p class="muted">
      连接测试检查凭据与模型访问。随后需要验证输出语言的样本路径，并手动启用语言。
    </p>
    <p class="muted">
      Soniox 测试发送 1 秒静音；DeepL
      测试将固定英文短句翻译成德文。测试及连接参数更新可能产生服务费用。
    </p>
    <p v-if="loaded && !protectionReady" class="muted">
      服务器尚未配置凭据保护，暂不能保存或测试服务。
    </p>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <p v-if="loaded && !providers.length" class="muted">
      尚无服务配置。生产字幕语言仍为空。
    </p>
    <ul v-else class="configuration-list">
      <li v-for="provider in providers" :key="provider.id">
        <div class="section-heading">
          <h3>{{ provider.name }}</h3>
          <Tag
            :value="
              provider.lastTest ? providerTestLabel(provider.lastTest.code) : '尚未测试'
            "
            :severity="provider.lastTest?.code === 'PASS' ? 'success' : 'secondary'"
          />
        </div>
        <p class="muted">
          {{
            provider.settings.type === 'soniox'
              ? 'Soniox · 语音识别候选'
              : 'DeepL · 文本翻译候选'
          }}
          · 版本 {{ provider.version }}
        </p>
        <small v-if="provider.lastTest" class="muted"
          >上次测试 {{ new Date(provider.lastTest.checkedAt).toLocaleString() }} ·
          {{ provider.lastTest.durationMs }} ms；不代表字幕质量已验证。</small
        >
        <div class="management-actions">
          <Button
            :aria-label="`编辑 ${provider.name}`"
            label="编辑"
            severity="secondary"
            :disabled="busy || !protectionReady"
            @click="edit(provider)"
          />
          <Button
            :aria-label="`测试 ${provider.name}`"
            label="测试已保存配置"
            severity="secondary"
            :disabled="busy || !protectionReady"
            @click="test(provider)"
          />
          <Button
            :aria-label="`删除 ${provider.name}`"
            label="删除"
            severity="danger"
            :disabled="busy"
            @click="removing = provider"
          />
        </div>
      </li>
    </ul>
    <ProviderEditor
      v-if="editing"
      :key="candidateId"
      :current="selected"
      :busy="busy"
      @save="save"
      @cancel="editing = false"
    />
    <div v-if="editing && selected?.history.length" class="management-confirmation">
      <label for="provider-history">恢复历史设置（显示最近 20 个版本）</label>
      <Select
        input-id="provider-history"
        v-model="restoreVersion"
        :options="
          selected.history.map((row) => ({
            label: `版本 ${row.version} · ${row.name}`,
            value: row.version,
          }))
        "
        option-label="label"
        option-value="value"
        :disabled="busy"
        placeholder="选择历史版本"
      />
      <Button
        label="测试并恢复该版本"
        severity="secondary"
        :disabled="busy || !restoreVersion"
        @click="restore"
      />
    </div>
    <ProviderSample
      :terminology-version="terminologyVersion"
      :providers="providers"
      :disabled="busy || !loaded || !protectionReady"
      @busy="busy = $event"
    />
    <div
      v-if="removing"
      class="management-confirmation"
      role="group"
      aria-label="确认删除服务配置"
    >
      <p>删除「{{ removing.name }}」及其全部凭据历史？</p>
      <div class="management-actions">
        <Button
          label="确认删除配置"
          severity="danger"
          :disabled="busy"
          @click="remove"
        />
        <Button
          label="取消删除"
          severity="secondary"
          :disabled="busy"
          @click="removing = null"
        />
      </div>
    </div>
  </section>
</template>
