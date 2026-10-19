<script setup lang="ts">
import type { PublicRoomConfiguration } from '@babel/contracts'
const { t } = useInterfaceLocale()
definePageMeta({ key: (route) => String(route.params.roomId) })
const route = useRoute()
const roomId = String(route.params.roomId)
const roomPath = `/rooms/${encodeURIComponent(roomId)}`
const verificationPath = `${roomPath}/verify`
const verifying = computed(() => route.path.replace(/\/$/, '') === verificationPath)
const {
  data,
  error: configurationError,
  refresh,
} = await useFetch<PublicRoomConfiguration>(`/api/player/rooms/${roomId}/config`)
const configuration = shallowRef<PublicRoomConfiguration | null>(data.value ?? null)
watch(data, (value) => {
  configuration.value = value ?? null
})
const {
  active,
  restoring,
  restoreFailed,
  submitting,
  error,
  notice,
  leavePending,
  restore,
  leave,
} = provideRoomSession(configuration, roomId)

watch(
  [active, restoring, restoreFailed, leavePending, configuration, () => route.path],
  () => {
    if (
      !import.meta.client ||
      !configuration.value ||
      restoring.value ||
      restoreFailed.value ||
      leavePending.value
    ) {
      return
    }
    if (active.value && verifying.value) {
      void navigateTo(roomPath, { replace: true })
    } else if (!active.value && !verifying.value) {
      void navigateTo(verificationPath, { replace: true })
    }
  },
  { immediate: true },
)

let configurationTimer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  configurationTimer = setInterval(() => void refresh(), 5_000)
})
onBeforeUnmount(() => clearInterval(configurationTimer))
</script>

<template>
  <main id="main" tabindex="-1" class="main-content">
    <div class="page-heading">
      <NuxtLink to="/" class="muted">{{ t('backRooms') }}</NuxtLink>
      <p class="eyebrow">{{ t('roomEyebrow') }}</p>
      <h1>{{ configuration?.room.name ?? t('directoryEyebrow') }}</h1>
      <p class="muted">
        {{ t(verifying ? 'characterVerificationHelp' : 'roomTagline') }}
      </p>
    </div>
    <section v-if="configurationError" class="empty-state" aria-live="polite">
      <h2>{{ t('configurationUnavailable') }}</h2>
      <p>{{ t('checkConnection') }}</p>
      <Button :label="t('reload')" severity="secondary" @click="refresh()" />
    </section>
    <template v-else-if="configuration">
      <p v-if="notice" class="session-notice" role="status">{{ notice }}</p>
      <div v-if="error" class="session-feedback" role="alert">
        <p class="form-error">{{ error }}</p>
        <Button
          v-if="restoreFailed"
          :label="t('retryRestore')"
          severity="secondary"
          @click="restore"
        />
      </div>
      <section v-if="leavePending" class="entry-panel">
        <p>{{ t('connectionStopped') }}</p>
        <Button
          :label="t('retryLeave')"
          severity="secondary"
          :loading="submitting"
          @click="leave"
        />
      </section>
      <NuxtPage v-else :page-key="route.path" />
    </template>
  </main>
</template>
