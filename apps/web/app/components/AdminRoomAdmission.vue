<script setup lang="ts">
import { ASIA_SERVERS, roomAdmissionSchema } from '@babel/contracts'
import { managementFailure } from '~/utils/management-errors'
const emit = defineEmits<{ published: [] }>()
const roomQuery = useManagementRoomQuery()
const admission = shallowRef<{ server: string; allowedIds: string[] } | null>(null)
const server = ref<string | null>(null)
const allowed = ref('')
const busy = ref(false)
const error = ref('')
const loaded = ref(false)
async function load() {
  busy.value = true
  try {
    admission.value = (
      await $fetch('/api/management/room/admission', { query: roomQuery.value })
    ).admission
    loaded.value = true
  } catch (failure) {
    error.value = managementFailure(failure)
  } finally {
    busy.value = false
  }
}
async function publish() {
  const input = roomAdmissionSchema.safeParse({
    server: server.value,
    allowedIds: allowed.value
      .split(/\r?\n/)
      .map((id) => id.trim())
      .filter(Boolean),
  })
  if (!input.success) {
    error.value = 'Choose a server and check the character ID list.'
    return
  }
  busy.value = true
  error.value = ''
  try {
    admission.value = (
      await $fetch('/api/management/room/admission', {
        method: 'POST',
        query: roomQuery.value,
        body: input.data,
      })
    ).admission
    emit('published')
  } catch (failure) {
    error.value = managementFailure(failure)
  } finally {
    busy.value = false
  }
}
onMounted(load)
</script>

<template>
  <section class="management-section" aria-labelledby="admission-title">
    <h2 id="admission-title">Admission rules</h2>
    <template v-if="admission">
      <p>
        Asia / {{ admission.server }} ·
        {{
          admission.allowedIds.length
            ? 'Only listed characters can join'
            : 'All characters on this server can join'
        }}
      </p>
      <p v-if="admission.allowedIds.length" class="muted">
        {{ admission.allowedIds.join(', ') }}
      </p>
      <p class="muted">
        The room is publicly listed. Joining members must pass AION2 Index character
        verification.
      </p>
    </template>
    <form v-else-if="loaded" class="entry-form" @submit.prevent="publish">
      <p class="muted">
        Set a server to publish the original room while keeping its Discord source.
        Existing members must leave and verify their characters again.
      </p>
      <div class="field">
        <label for="existing-room-server">Game server (required)</label>
        <Select
          input-id="existing-room-server"
          v-model="server"
          :options="[...ASIA_SERVERS]"
          :disabled="busy"
          placeholder="Choose an Asia server"
        />
      </div>
      <div class="field">
        <label for="existing-room-ids">Allowed character IDs (optional)</label>
        <Textarea
          id="existing-room-ids"
          v-model="allowed"
          rows="4"
          :disabled="busy"
          placeholder="One ID per line; leave blank to allow all characters on this server"
        />
      </div>
      <Button
        type="submit"
        label="Set server and publish original room"
        :loading="busy"
      />
    </form>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <Button
      v-if="!loaded && !busy"
      label="Reload admission rules"
      severity="secondary"
      @click="load"
    />
  </section>
</template>
