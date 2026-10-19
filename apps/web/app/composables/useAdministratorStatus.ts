export function useAdministratorStatus() {
  const roomQuery = useManagementRoomQuery()
  const status = ref<{
    administrator: { email: string }
    services: { discord: string; media: string; subtitles: string }
    configurationEditable: boolean
  } | null>(null)
  const loading = ref(false)
  const error = ref('')
  let poll: ReturnType<typeof setInterval> | undefined
  let disposed = false

  async function refresh() {
    try {
      status.value = await $fetch<NonNullable<typeof status.value>>(
        '/api/management/status',
        { query: roomQuery.value },
      )
      error.value = ''
    } catch {
      status.value = null
      error.value =
        'Administrator session unavailable. Reconnect or sign in again through Access.'
    }
  }

  async function connect() {
    loading.value = true
    if (poll) {
      clearInterval(poll)
      poll = undefined
    }
    try {
      await $fetch('/api/auth/sign-in/cloudflare', { method: 'POST' })
      await refresh()
      if (!disposed) {
        poll = setInterval(refresh, 10_000)
      }
    } catch {
      error.value =
        'Could not establish administrator session. Check Access, database and session key settings, then retry.'
    } finally {
      loading.value = false
    }
  }

  onMounted(connect)
  onBeforeUnmount(() => {
    disposed = true
    clearInterval(poll)
  })
  return { status, loading, error, connect }
}
