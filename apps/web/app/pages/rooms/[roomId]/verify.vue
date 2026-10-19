<script setup lang="ts">
const { configuration, restoring, restoreFailed, submitting, active, enter } =
  useRoomSession()
</script>

<template>
  <RoomEntry
    v-if="configuration && !active"
    :configuration="configuration"
    :submitting="restoring || restoreFailed || submitting"
    @enter="enter"
  />
</template>
