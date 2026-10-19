import {
  REPLACEMENT_NOTICE,
  selectOutputLanguage,
  type ListenerSnapshot,
  type PlayerEvent,
  type PublicRoomConfiguration,
} from '@babel/contracts'
import {
  createPendingEntry,
  listenerRequest,
  loadListener,
  loadPendingEntry,
  PlayerApiError,
  savedLanguage,
  saveLanguage,
  saveListener,
  savePendingEntry,
  type SavedListener,
} from '~/utils/listener-client'

export function usePlayerSession(
  configuration: Ref<PublicRoomConfiguration | null>,
  roomId: string,
) {
  const credential = ref<string | null>(null)
  const session = shallowRef<ListenerSnapshot | null>(null)
  const restoring = ref(true)
  const restoreFailed = ref(false)
  const submitting = ref(false)
  const changingLanguage = ref(false)
  const error = ref('')
  const notice = ref('')
  const leavePending = ref(false)
  const active = computed(
    () =>
      !leavePending.value &&
      session.value !== null &&
      ['JOINING', 'ACTIVE'].includes(session.value.state),
  )
  let access: SavedListener | null = null
  let epoch = 0
  let disposed = false
  const connection = usePlayerConnection(receive, invalidSession)
  const playerList = usePlayerList(connection.state, roomId)
  const subtitles = usePlayerSubtitles(session, connection.state, changingLanguage)
  const audio = useListenerAudio((reference) => {
    if (
      !access ||
      access.sessionId !== reference.sessionId ||
      access.nicknameGeneration !== reference.nicknameGeneration
    ) {
      throw new Error('Listener has ended')
    }
    access = { ...access, mediaAttempt: Math.max(access.mediaAttempt, Date.now()) + 1 }
    saveListener(access, roomId)
    return access.mediaAttempt
  })

  function clearAccess() {
    subtitles.clear()
    audio.stop()
    access = null
    credential.value = null
    restoreFailed.value = false
    try {
      saveListener(null, roomId)
      savePendingEntry(null, roomId)
    } catch {
      /* Already unusable in this page. */
    }
    connection.stop()
  }

  function invalidSession() {
    epoch += 1
    clearAccess()
    session.value = null
    leavePending.value = false
    notice.value = '本页会话已失效，请手动重新进入。'
  }

  function accept(next: ListenerSnapshot) {
    if (next.roomId !== roomId) {
      invalidSession()
      return
    }
    session.value = next
    if (next.state === 'ACTIVE' && access) {
      audio.connect(access)
    }
    if (!['JOINING', 'ACTIVE'].includes(next.state)) {
      leavePending.value = false
      epoch += 1
      clearAccess()
      notice.value =
        next.terminalReason === 'DUPLICATE_NICKNAME_REPLACED'
          ? REPLACEMENT_NOTICE
          : next.terminalReason === 'ADMINISTRATOR_REMOVED'
            ? '管理员已结束你的收听连接。'
            : next.terminalReason === 'CONNECTION_EXPIRED'
              ? '连接已过期，请手动重新进入。'
              : '你已退出房间。'
    }
  }

  function chooseLanguage() {
    const config = configuration.value
    return selectOutputLanguage(
      config?.outputLanguages ?? [],
      navigator.languages?.length ? navigator.languages : [navigator.language],
      savedLanguage(),
      config?.defaultOutputLanguage ?? null,
    )
  }

  function receive(event: PlayerEvent) {
    if (event.type === 'subtitles') {
      subtitles.receive(event)
    } else if (event.type === 'session') {
      error.value = ''
      accept(event.session)
    } else if (event.type === 'players') {
      playerList.accept(event.players)
    } else if (event.type === 'configuration') {
      configuration.value = event.configuration
      const current = session.value?.outputLanguage
      if (
        active.value &&
        !changingLanguage.value &&
        ((!current && event.configuration.outputLanguages.length > 0) ||
          (current &&
            !event.configuration.outputLanguages.some(
              (language) => language.code === current,
            )))
      ) {
        const selected = chooseLanguage()
        notice.value = !selected
          ? '所有字幕语言已停用，原声继续播放。'
          : current
            ? '原字幕语言已停用，已按你的语言偏好重新选择。'
            : '字幕已启用，已按你的语言偏好选择语言。'
        void changeLanguage(selected, false)
      }
    } else if (event.type === 'error' && event.code === 'UNAVAILABLE') {
      error.value = '连接暂时不可用，正在恢复本页会话。'
    }
  }

  async function enter(nickname: string, outputLanguage: string | null) {
    const currentEpoch = ++epoch
    submitting.value = true
    error.value = ''
    notice.value = ''
    try {
      let pending = loadPendingEntry(roomId)
      if (
        pending?.request.nickname !== nickname ||
        pending.request.outputLanguage !== outputLanguage
      ) {
        pending = createPendingEntry(nickname, outputLanguage)
        savePendingEntry(pending, roomId)
      }
      const next = await listenerRequest(
        roomId ? `/api/player/rooms/${roomId}/sessions` : '/api/player/sessions',
        pending.credential,
        'POST',
        pending.request,
      )
      if (disposed || currentEpoch !== epoch) {
        return
      }
      access = {
        sessionId: next.sessionId,
        nicknameGeneration: next.nicknameGeneration,
        credential: pending.credential,
        leaving: false,
        mediaAttempt: 0,
      }
      credential.value = access.credential
      saveListener(access, roomId)
      savePendingEntry(null, roomId)
      accept(next)
      if (access && active.value) {
        connection.connect(access)
      }
    } catch (failure) {
      if (!disposed && currentEpoch === epoch) {
        error.value =
          failure instanceof PlayerApiError && [400, 403, 404].includes(failure.status)
            ? failure.message
            : '入场结果尚未确认，请重试。重试会继续同一次入场。'
      }
    } finally {
      submitting.value = false
    }
  }

  async function restore() {
    restoring.value = true
    restoreFailed.value = false
    error.value = ''
    access = loadListener(roomId)
    credential.value = access?.credential ?? null
    const currentEpoch = ++epoch
    try {
      if (!access) {
        if (loadPendingEntry(roomId)) {
          notice.value = '上次入场结果尚未确认，请手动重试。'
        }
        return
      }
      if (access.leaving) {
        await leave()
        return
      }
      const next = await listenerRequest(
        `/api/player/sessions/${access.sessionId}`,
        access.credential,
      )
      if (disposed || currentEpoch !== epoch) {
        return
      }
      accept(next)
      if (access && active.value) {
        connection.connect(access)
      }
    } catch (failure) {
      if (disposed || currentEpoch !== epoch) {
        return
      }
      if (
        failure instanceof PlayerApiError &&
        [401, 404, 410].includes(failure.status)
      ) {
        invalidSession()
      } else {
        restoreFailed.value = true
        error.value = '暂时无法恢复本页会话，请重试。'
      }
    } finally {
      restoring.value = false
    }
  }

  async function leave() {
    if (!access) {
      return
    }
    const leaving = access
    const currentEpoch = ++epoch
    connection.stop()
    leavePending.value = true
    audio.stop()
    submitting.value = true
    try {
      saveListener({ ...leaving, leaving: true }, roomId)
      const next = await listenerRequest(
        `/api/player/sessions/${leaving.sessionId}`,
        leaving.credential,
        'DELETE',
      )
      if (disposed || currentEpoch !== epoch) {
        return
      }
      accept(next)
      error.value = ''
    } catch (failure) {
      if (disposed || currentEpoch !== epoch) {
        return
      }
      if (
        failure instanceof PlayerApiError &&
        [401, 404, 410].includes(failure.status)
      ) {
        invalidSession()
      } else {
        error.value = '本页连接已停止，服务器尚未确认退出。请重试退出。'
      }
    } finally {
      submitting.value = false
    }
  }

  async function changeLanguage(language: string | null, explicit = true) {
    if (!access || !active.value || changingLanguage.value) {
      return
    }
    const currentEpoch = epoch
    changingLanguage.value = true
    try {
      const next = await listenerRequest(
        `/api/player/sessions/${access.sessionId}/language`,
        access.credential,
        'PATCH',
        { outputLanguage: language },
      )
      if (disposed || currentEpoch !== epoch) {
        return
      }
      if (explicit) {
        saveLanguage(language)
      }
      accept(next)
      error.value = ''
    } catch {
      if (!disposed && currentEpoch === epoch) {
        error.value = '字幕语言未能切换，请重试。'
      }
    } finally {
      changingLanguage.value = false
    }
  }

  onMounted(restore)
  onBeforeUnmount(() => {
    disposed = true
    epoch += 1
    connection.stop()
    audio.stop()
  })
  return {
    session,
    credential,
    players: playerList.players,
    playersCurrent: playerList.current,
    restoring,
    restoreFailed,
    submitting,
    changingLanguage,
    error,
    notice,
    active,
    leavePending,
    connectionState: connection.state,
    subtitles: subtitles.presentation,
    audioState: audio.state,
    audioBlocked: audio.blocked,
    muted: audio.muted,
    playAudio: audio.play,
    toggleMute: audio.toggleMute,
    enter,
    restore,
    leave,
    changeLanguage,
  }
}
