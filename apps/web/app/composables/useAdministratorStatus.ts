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
      error.value = '管理会话不可用。请重新建立会话，或通过 Access 入口重新登录。'
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
      error.value = '无法建立管理会话。请检查 Access、数据库和会话密钥配置后重试。'
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
