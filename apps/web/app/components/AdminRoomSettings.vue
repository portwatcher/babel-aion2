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
const protectionReady = ref(false)
const name = ref('')
const guildId = ref('')
const voiceChannelId = ref('')
const captureMode = ref<DiscordCaptureMode>('SELECTED_USERS')
const captureModes = [
  { label: 'Selected members', value: 'SELECTED_USERS' },
  { label: 'All channel members', value: 'ALL_CHANNEL' },
]
const commanderText = ref('')
const credentialAction = ref<'keep' | 'replace' | 'remove'>('keep')
const credential = ref('')
const busy = ref(false)
const error = ref('')
const notice = ref('')
let disposed = false
const credentialActions = computed(() => [
  {
    label: current.value?.credentialConfigured
      ? 'Keep saved credential'
      : 'Leave credential unset',
    value: 'keep',
    disabled: false,
  },
  { label: 'Save new credential', value: 'replace', disabled: !protectionReady.value },
  {
    label: 'Remove saved credential',
    value: 'remove',
    disabled: !current.value?.credentialConfigured,
  },
])

function accept(room: ManagementRoom) {
  current.value = room
  name.value = room.name
  guildId.value = room.guildId ?? ''
  voiceChannelId.value = room.voiceChannelId ?? ''
  captureMode.value = room.captureMode
  commanderText.value = room.commanderIds.join('\n')
  credentialAction.value = 'keep'
  credential.value = ''
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
      protectionReady.value = result.credentialProtectionReady
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
    ...(credentialAction.value === 'replace' ? { credential: credential.value } : {}),
    removeCredential: credentialAction.value === 'remove',
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
    credential.value = ''
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

watch(credentialAction, () => {
  credential.value = ''
})
onMounted(load)
onBeforeUnmount(() => {
  disposed = true
  credential.value = ''
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
    <p class="muted">
      Save source settings, then start the room. Connection status and received member
      audio appear below.
    </p>
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
            :disabled="busy"
            inputmode="numeric"
            autocomplete="off"
          />
        </div>
        <div class="field">
          <label for="discord-channel">Voice channel ID</label>
          <InputText
            id="discord-channel"
            v-model="voiceChannelId"
            :disabled="busy"
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
          :disabled="busy"
          aria-describedby="capture-mode-help"
        />
        <small id="capture-mode-help" class="muted">{{
          captureMode === 'ALL_CHANNEL'
            ? 'Receive speaking members automatically, with separate audio per Discord user. No member IDs are required.'
            : 'Receive audio only from the members listed below.'
        }}</small>
      </div>
      <div v-if="captureMode === 'SELECTED_USERS'" class="field">
        <label for="commanders">Member Discord user IDs</label>
        <Textarea
          id="commanders"
          v-model="commanderText"
          :disabled="busy"
          rows="3"
          aria-describedby="commanders-help"
        />
        <small id="commanders-help" class="muted"
          >One ID per line. Receive audio only from these members.</small
        >
      </div>
      <div class="field">
        <label for="credential-action">Bot credential</label>
        <Select
          input-id="credential-action"
          v-model="credentialAction"
          :options="credentialActions"
          option-label="label"
          option-value="value"
          option-disabled="disabled"
          :disabled="busy"
        />
        <small class="muted">{{
          current.credentialConfigured
            ? 'Credential saved. Its value is never returned to this page.'
            : 'No credential saved.'
        }}</small>
        <p v-if="!protectionReady" class="muted">
          Credential protection is not configured. New credentials cannot be saved yet.
        </p>
      </div>
      <div v-if="credentialAction === 'replace'" class="field">
        <label for="discord-credential">New bot token</label>
        <InputText
          id="discord-credential"
          v-model="credential"
          type="password"
          autocomplete="new-password"
          :spellcheck="false"
          :disabled="busy"
          required
        />
      </div>
      <p v-if="credentialAction === 'remove'" class="form-error">
        Saving removes the bot credential and keeps the room stopped.
      </p>
      <p class="muted">
        Changing credentials, voice channel, capture scope or members stops the current
        source. Revalidate before restarting.
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
      <small class="muted"
        >Configuration version {{ current.version }} · Reloading discards unsaved
        changes on this page.</small
      >
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
