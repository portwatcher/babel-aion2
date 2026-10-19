<script setup lang="ts">
import { ASIA_SERVERS, roomInstallSchema } from '@babel/contracts'
import type { InterfaceMessageKey } from '~/locales'
import { playerErrorKey } from '~/utils/player-feedback'

const { t } = useInterfaceLocale()
const route = useRoute()
const { data: directory } = await useFetch('/api/player/rooms')
const name = ref('')
const server = ref<string | null>(null)
const allowed = ref('')
const voiceChannelId = ref<string | null>(null)
const installation = shallowRef<{
  name: string
  server: string
  allowedIds: string[]
  roomNumber: number | null
  channels: { id: string; name: string }[]
} | null>(null)
const busy = ref(false)
const errorKey = ref<InterfaceMessageKey | ''>(
  route.query.installationError ? 'installationFailed' : '',
)
const error = computed(() => (errorKey.value ? t(errorKey.value) : ''))

async function install() {
  const parsed = roomInstallSchema.safeParse({
    name: name.value,
    server: server.value,
    allowedIds: allowed.value
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean),
  })
  if (!parsed.success) {
    errorKey.value = !server.value ? 'serverMissing' : 'roomSettingsInvalid'
    return
  }
  busy.value = true
  errorKey.value = ''
  try {
    const result = await $fetch('/api/player/rooms/install', {
      method: 'POST',
      body: parsed.data,
    })
    await navigateTo(result.url, { external: true })
  } catch (failure) {
    errorKey.value = playerErrorKey(failure)
  } finally {
    busy.value = false
  }
}
async function readInstallation() {
  busy.value = true
  errorKey.value = ''
  try {
    const result = await $fetch('/api/player/rooms/installation')
    if (result.roomNumber) {
      await navigateTo(`/rooms/${result.roomNumber}`)
      return
    }
    installation.value = result
  } catch (failure) {
    errorKey.value = playerErrorKey(failure)
  } finally {
    busy.value = false
  }
}
async function create() {
  if (!voiceChannelId.value) {
    errorKey.value = 'channelMissing'
    return
  }
  busy.value = true
  errorKey.value = ''
  try {
    const result = await $fetch('/api/player/rooms', {
      method: 'POST',
      body: { voiceChannelId: voiceChannelId.value },
    })
    await navigateTo(`/rooms/${result.roomNumber}`)
  } catch (failure) {
    errorKey.value = playerErrorKey(failure)
  } finally {
    busy.value = false
  }
}
onMounted(() => {
  if (route.query.installed) {
    void readInstallation()
  }
})
</script>

<template>
  <main id="main" tabindex="-1" class="main-content">
    <div class="page-heading">
      <NuxtLink to="/" class="muted">{{ t('backRooms') }}</NuxtLink>
      <p class="eyebrow">{{ t('directoryEyebrow') }}</p>
      <h1>{{ t('createBroadcastRoom') }}</h1>
      <p class="muted">{{ t('createRoomHelp') }}</p>
    </div>
    <div class="room-layout">
      <section class="entry-panel">
        <form v-if="!installation" class="entry-form" @submit.prevent="install">
          <h2>{{ t('roomSettings') }}</h2>
          <div class="field">
            <label for="room-name">{{ t('roomName') }}</label>
            <InputText
              id="room-name"
              v-model="name"
              required
              maxlength="64"
              :disabled="busy"
              :placeholder="t('roomNamePlaceholder')"
            />
          </div>
          <div class="field">
            <label for="room-server">{{ t('serverRequired') }}</label>
            <Select
              input-id="room-server"
              v-model="server"
              :options="[...ASIA_SERVERS]"
              :disabled="busy"
              :placeholder="t('chooseServer')"
            />
          </div>
          <div class="field">
            <label for="allowed-ids">{{ t('allowedCharacters') }}</label>
            <Textarea
              id="allowed-ids"
              v-model="allowed"
              :disabled="busy"
              rows="4"
              :placeholder="t('allowedCharactersPlaceholder')"
              aria-describedby="allowed-ids-help"
            />
            <small id="allowed-ids-help" class="muted">{{
              t('allowedCharactersHelp')
            }}</small>
          </div>
          <p v-if="!directory?.creationAvailable" class="muted" role="status">
            {{ t('creationUnavailable') }}
          </p>
          <Button
            type="submit"
            :label="t('installBot')"
            :loading="busy"
            :disabled="!directory?.creationAvailable"
          />
        </form>
        <form v-else class="entry-form" @submit.prevent="create">
          <h2>{{ t('selectBroadcastChannel') }}</h2>
          <p>{{ installation.name }} · Asia / {{ installation.server }}</p>
          <p class="muted">
            {{
              installation.allowedIds.length
                ? t('restrictedCount', { count: installation.allowedIds.length })
                : t('allCharacters')
            }}
          </p>
          <div class="field">
            <label for="voice-channel">{{ t('voiceChannel') }}</label>
            <Select
              input-id="voice-channel"
              v-model="voiceChannelId"
              :options="installation.channels"
              option-label="name"
              option-value="id"
              :placeholder="t('chooseVoiceChannel')"
              :disabled="busy"
            />
          </div>
          <p v-if="!installation.channels.length" class="muted">
            {{ t('noVoiceChannels') }}
          </p>
          <Button
            :label="t('refreshChannels')"
            severity="secondary"
            :disabled="busy"
            @click="readInstallation"
          />
          <Button
            type="submit"
            :label="t('createAndJoin')"
            :loading="busy"
            :disabled="!voiceChannelId"
          />
        </form>
        <p v-if="error" class="form-error admission-notice" role="alert">{{ error }}</p>
        <Button
          v-if="route.query.installed && !installation"
          :label="t('retryInstallation')"
          severity="secondary"
          :loading="busy"
          @click="readInstallation"
        />
      </section>
      <aside class="room-detail" :aria-label="t('creationInstructions')">
        <h2>{{ t('teamHeading') }}</h2>
        <p class="muted">{{ t('installationPermissions') }}</p>
        <p class="muted">{{ t('broadcastConsent') }}</p>
        <p class="muted">{{ t('roomCreationScope') }}</p>
        <p class="muted">{{ t('characterExistenceNotice') }}</p>
      </aside>
    </div>
  </main>
</template>
