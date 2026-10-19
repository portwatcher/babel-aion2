<script setup lang="ts">
import {
  ASIA_SERVERS,
  playerRoomCreationSchema,
  roomInstallSchema,
  type RoomAudioSource,
} from '@babel/contracts'
import type { InterfaceMessageKey } from '~/locales'
import { playerErrorKey } from '~/utils/player-feedback'

const { t } = useInterfaceLocale()
const route = useRoute()
const { data: directory } = await useFetch('/api/player/rooms')
const audioSource = ref<RoomAudioSource>('PLAYER')
const audioSources = computed(() => [
  { label: t('audioSourcePlayer'), value: 'PLAYER' },
  { label: t('audioSourceDiscord'), value: 'DISCORD' },
])
const sourceAvailable = computed(
  () => directory.value?.creationSources.includes(audioSource.value) ?? false,
)
const hostId = ref('')
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

function roomSettings() {
  return {
    name: name.value,
    server: server.value,
    allowedIds: allowed.value
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean),
  }
}
function submit() {
  return audioSource.value === 'PLAYER' ? createHosted() : install()
}
async function createHosted() {
  const parsed = playerRoomCreationSchema.safeParse({
    ...roomSettings(),
    hostId: hostId.value,
  })
  if (!parsed.success) {
    errorKey.value = !server.value ? 'serverMissing' : 'roomSettingsInvalid'
    return
  }
  busy.value = true
  errorKey.value = ''
  try {
    const result = await $fetch('/api/player/rooms/hosted', {
      method: 'POST',
      body: parsed.data,
    })
    await navigateTo(`/rooms/${result.roomNumber}`)
  } catch (failure) {
    errorKey.value = playerErrorKey(failure)
  } finally {
    busy.value = false
  }
}
async function install() {
  const parsed = roomInstallSchema.safeParse(roomSettings())
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
      <NuxtLink to="/" class="back-link"
        ><span aria-hidden="true">←</span> {{ t('backRooms') }}</NuxtLink
      >
      <h1>{{ t('createBroadcastRoom') }}</h1>
      <p class="muted">{{ t('createRoomHelp') }}</p>
    </div>
    <div class="room-layout create-layout">
      <section class="entry-panel">
        <form v-if="!installation" class="entry-form" @submit.prevent="submit">
          <div class="field">
            <span id="audio-source-label" class="field-label">{{
              t('audioSource')
            }}</span>
            <SelectButton
              v-model="audioSource"
              :options="audioSources"
              option-label="label"
              option-value="value"
              :allow-empty="false"
              :disabled="busy"
              aria-labelledby="audio-source-label"
            />
          </div>
          <div class="field">
            <label for="room-name">{{ t('roomName') }}</label>
            <InputText
              id="room-name"
              v-model="name"
              required
              maxlength="64"
              :disabled="busy"
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
          <div v-if="audioSource === 'PLAYER'" class="field">
            <label for="host-id">{{ t('hostCharacter') }}</label>
            <InputText
              id="host-id"
              v-model="hostId"
              required
              maxlength="32"
              autocomplete="off"
              :disabled="busy"
              aria-describedby="host-id-help"
            />
            <small id="host-id-help" class="muted">{{ t('hostCharacterHelp') }}</small>
          </div>
          <div class="field">
            <label for="allowed-ids">{{ t('allowedCharacters') }}</label>
            <Textarea
              id="allowed-ids"
              v-model="allowed"
              :disabled="busy"
              rows="4"
              aria-describedby="allowed-ids-help"
            />
            <small id="allowed-ids-help" class="muted">{{
              t('allowedCharactersHelp')
            }}</small>
          </div>
          <p v-if="!sourceAvailable" class="muted" role="status">
            {{ t('creationUnavailable') }}
          </p>
          <Button
            type="submit"
            :label="audioSource === 'PLAYER' ? t('createAndJoin') : t('installBot')"
            :loading="busy"
            :disabled="!sourceAvailable"
          />
        </form>
        <form v-else class="entry-form" @submit.prevent="create">
          <div class="installation-summary">
            <h2>{{ installation.name }}</h2>
            <p class="muted">
              {{ installation.server }} ·
              {{
                installation.allowedIds.length
                  ? t('restrictedCount', { count: installation.allowedIds.length })
                  : t('allCharacters')
              }}
            </p>
          </div>
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
            <small v-if="!installation.channels.length" class="muted">{{
              t('noVoiceChannels')
            }}</small>
          </div>
          <div class="form-actions">
            <Button
              type="submit"
              :label="t('createAndJoin')"
              :loading="busy"
              :disabled="!voiceChannelId"
            />
            <Button
              :label="t('refreshChannels')"
              severity="secondary"
              :disabled="busy"
              @click="readInstallation"
            />
          </div>
        </form>
        <div v-if="error" class="session-feedback form-feedback" role="alert">
          <p class="form-error">{{ error }}</p>
          <Button
            v-if="route.query.installed && !installation"
            :label="t('retryInstallation')"
            severity="secondary"
            :loading="busy"
            @click="readInstallation"
          />
        </div>
      </section>
      <aside class="room-detail creation-notes" aria-labelledby="creation-notes-title">
        <h2 id="creation-notes-title">{{ t('creationInstructions') }}</h2>
        <ul>
          <li v-if="audioSource === 'PLAYER'">{{ t('playerCaptureNote') }}</li>
          <li v-else>{{ t('installationPermissions') }}</li>
          <li>{{ t('broadcastConsent') }}</li>
        </ul>
      </aside>
    </div>
  </main>
</template>
