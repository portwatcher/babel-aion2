<script setup lang="ts">
const roomQuery = useManagementRoomQuery()
import {
  managementRoomResponseSchema,
  managementRoomSchema,
  roomUpdateSchema,
  type ManagementRoom,
  type DiscordCaptureMode,
} from '@babel/contracts'
import { managementFailure } from '~/utils/management-errors'

const current = shallowRef<ManagementRoom | null>(null)
const name = ref('')
const guildId = ref('')
const voiceChannelId = ref('')
const captureMode = ref<DiscordCaptureMode>('SELECTED_USERS')
const captureModes = [
  { label: 'Selected members', value: 'SELECTED_USERS' },
  { label: 'All channel members', value: 'ALL_CHANNEL' },
]
const commanderText = ref('')
const busy = ref(false)
const error = ref('')
const notice = ref('')
let disposed = false

function accept(room: ManagementRoom) {
  current.value = room
  name.value = room.name
  guildId.value = room.guildId ?? ''
  voiceChannelId.value = room.voiceChannelId ?? ''
  captureMode.value = room.captureMode
  commanderText.value = room.commanderIds.join('\n')
}

async function load() {
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    const result = managementRoomResponseSchema.parse(
      await $fetch('/api/management/room', { query: roomQuery.value }),
    )
    if (!disposed) {
      accept(result.room)
    }
  } catch (failure) {
    if (!disposed) {
      error.value = managementFailure(failure)
    }
  } finally {
    busy.value = false
  }
}

async function save() {
  if (!current.value || busy.value) {
    return
  }
  notice.value = ''
  error.value = ''
  const input = roomUpdateSchema.safeParse({
    expectedVersion: current.value.version,
    name: name.value,
    guildId: guildId.value.trim() || null,
    voiceChannelId: voiceChannelId.value.trim() || null,
    captureMode: captureMode.value,
    commanderIds:
      captureMode.value === 'ALL_CHANNEL'
        ? []
        : commanderText.value.split(/[\s,，]+/).filter(Boolean),
    removeCredential: false,
  })
  if (!input.success) {
    error.value =
      'Enter a room name, provide both server and voice channel IDs, and use unique member IDs. New credentials cannot contain spaces.'
    return
  }
  busy.value = true
  try {
    const next = managementRoomSchema.parse(
      await $fetch('/api/management/room', {
        query: roomQuery.value,
        method: 'PATCH',
        body: input.data,
      }),
    )
    if (!disposed) {
      accept(next)
      notice.value = 'Settings saved. Restart after changing the source.'
    }
  } catch (failure) {
    if (!disposed) {
      error.value = managementFailure(failure)
    }
  } finally {
    busy.value = false
  }
}

async function setRunning(running: boolean) {
  if (!current.value || busy.value) {
    return
  }
  busy.value = true
  error.value = ''
  try {
    const next = managementRoomSchema.parse(
      await $fetch(
        running ? '/api/management/room/start' : '/api/management/room/stop',
        {
          query: roomQuery.value,
          method: 'POST',
          body: { expectedVersion: current.value.version },
        },
      ),
    )
    if (!disposed) {
      accept(next)
      notice.value = running
        ? 'Start requested. Connecting to the source.'
        : 'Stop requested. Closing the source.'
    }
  } catch (failure) {
    if (!disposed) {
      error.value = managementFailure(failure)
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
    aria-labelledby="room-settings-title"
    :aria-busy="busy"
  >
    <div class="section-heading">
      <h2 id="room-settings-title">Room and Discord source</h2>
      <Tag
        v-if="current"
        :value="current.stopped ? 'Stopped' : 'Start requested'"
        severity="secondary"
      />
    </div>

    <AdminVoiceSource />
    <p v-if="notice" role="status">{{ notice }}</p>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <form v-if="current" class="entry-form" @submit.prevent="save">
      <div class="field">
        <label for="room-name">Room name</label>
        <InputText
          id="room-name"
          v-model="name"
          :disabled="busy"
          maxlength="80"
          required
        />
      </div>
      <div class="management-fields">
        <div class="field">
          <label for="discord-guild">Discord server ID</label>
          <InputText
            id="discord-guild"
            v-model="guildId"
            readonly
            inputmode="numeric"
            autocomplete="off"
          />
        </div>
        <div class="field">
          <label for="discord-channel">Voice channel ID</label>
          <InputText
            id="discord-channel"
            v-model="voiceChannelId"
            readonly
            inputmode="numeric"
            autocomplete="off"
          />
        </div>
      </div>
      <div class="field">
        <label for="capture-mode">Capture scope</label>
        <Select
          input-id="capture-mode"
          v-model="captureMode"
          :options="captureModes"
          option-label="label"
          option-value="value"
          disabled
          aria-describedby="capture-mode-help"
        />
        <small id="capture-mode-help" class="muted">{{
          captureMode === 'ALL_CHANNEL'
            ? 'Capture everyone who speaks in the channel.'
            : 'Capture only the members listed below.'
        }}</small>
      </div>
      <div v-if="captureMode === 'SELECTED_USERS'" class="field">
        <label for="commanders">Member Discord user IDs</label>
        <Textarea
          id="commanders"
          v-model="commanderText"
          readonly
          rows="3"
          aria-describedby="commanders-help"
        />
        <small id="commanders-help" class="muted">One Discord user ID per line.</small>
      </div>
      <p class="muted">
        Stopping this room does not affect other rooms on the same Discord server.
      </p>
      <div class="management-actions">
        <Button type="submit" label="Save settings" :loading="busy" />
        <Button label="Reload" severity="secondary" :disabled="busy" @click="load" />
        <Button
          label="Start room"
          severity="secondary"
          :disabled="busy || !current.stopped || !current.sourceConfigured"
          @click="setRunning(true)"
        />
        <Button
          label="Stop room"
          severity="danger"
          :disabled="busy || current.stopped"
          @click="setRunning(false)"
        />
      </div>
      <small class="muted">Version {{ current.version }}</small>
    </form>
    <Button
      v-else
      label="Load room settings"
      severity="secondary"
      :loading="busy"
      @click="load"
    />
  </section>
</template>
