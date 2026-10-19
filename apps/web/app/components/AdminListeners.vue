<script setup lang="ts">
import {
  managementListenerSchema,
  type ManagementListener,
  type PublicListener,
} from '@babel/contracts'
import { managementFailure } from '~/utils/management-errors'

const players = shallowRef<ManagementListener[]>([])
const current = ref(false)
const selected = shallowRef<ManagementListener | null>(null)
const removing = ref(false)
const notice = ref('')
const error = ref('')
let reading = false
let disposed = false
let poll: ReturnType<typeof setInterval> | undefined

async function refresh() {
  if (reading || disposed) {
    return
  }
  reading = true
  try {
    const result = await $fetch<{ players: unknown }>('/api/management/listeners')
    const next = managementListenerSchema.array().parse(result.players)
    if (!disposed) {
      players.value = next
      current.value = true
    }
  } catch {
    if (!disposed) {
      current.value = false
    }
  } finally {
    reading = false
  }
}
function select(player: PublicListener) {
  selected.value =
    players.value.find((entry) => entry.sessionId === player.sessionId) ?? null
  error.value = ''
  notice.value = ''
}
async function remove() {
  if (!selected.value || removing.value) {
    return
  }
  const target = selected.value
  removing.value = true
  try {
    await $fetch(`/api/management/listeners/${target.sessionId}`, {
      method: 'DELETE',
      body: { nicknameGeneration: target.nicknameGeneration },
    })
    if (!disposed) {
      selected.value = null
      notice.value =
        'Disconnection requested. The listener remains Disconnecting until all delivery channels stop.'
      await refresh()
    }
  } catch (failure) {
    if (!disposed) {
      error.value = managementFailure(failure)
    }
  } finally {
    removing.value = false
  }
}
onMounted(() => {
  void refresh()
  poll = setInterval(() => void refresh(), 10_000)
})
onBeforeUnmount(() => {
  disposed = true
  clearInterval(poll)
})
</script>

<template>
  <section class="management-section">
    <PlayerList :players="players" :current="current">
      <template #actions="{ player }">
        <Button
          label="Remove"
          severity="secondary"
          size="small"
          :disabled="player.state === 'DISCONNECTING' || removing"
          :aria-label="`Remove ${player.nickname}`"
          @click="select(player)"
        />
      </template>
    </PlayerList>
    <p v-if="notice" role="status">{{ notice }}</p>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <div
      v-if="selected"
      class="management-confirmation"
      role="group"
      aria-label="Confirm listener removal"
    >
      <p>End the listening session for “{{ selected.nickname }}”?</p>
      <div class="management-actions">
        <Button
          label="Confirm removal"
          severity="danger"
          :loading="removing"
          @click="remove"
        />
        <Button
          label="Cancel"
          severity="secondary"
          :disabled="removing"
          @click="selected = null"
        />
      </div>
    </div>
  </section>
</template>
