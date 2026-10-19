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
    'API Key saved encrypted.',
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
    'Streaming recognition and translation connection test completed.',
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
      <h2 id="providers-title">OpenAI subtitle service</h2>
      <Button
        label="Reload"
        severity="secondary"
        :disabled="busy || sampleBusy"
        @click="load"
      />
    </div>
    <p class="muted">One API key covers recognition and translation.</p>
    <p v-if="loaded && !protectionReady" class="muted">
      Credential protection is unavailable. Saving and testing are disabled.
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
          current.lastTest ? providerTestLabel(current.lastTest.code) : 'Not tested'
        "
        :severity="current.lastTest?.code === 'PASS' ? 'success' : 'secondary'"
      />
      <Button
        label="Test connection"
        severity="secondary"
        :disabled="busy || sampleBusy || !protectionReady"
        @click="test"
      />
    </div>
    <p class="muted">Tests may incur OpenAI charges.</p>
    <ProviderSample
      :providers="providers"
      :disabled="busy || !protectionReady"
      :terminology-version="terminologyVersion"
      @busy="sampleBusy = $event"
    />
  </section>
</template>
