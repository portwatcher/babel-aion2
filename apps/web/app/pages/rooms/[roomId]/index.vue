<script setup lang="ts">
import {
  DEFAULT_MAP_VIEW,
  DEFAULT_PIP_VISIBILITY,
  getPipResizeTarget,
  getPipWindowDimensions,
  resolvePipOpenVisibility,
  type MapViewState,
  type PipVisibility,
} from '~/utils/pip-layout'

const { t } = useInterfaceLocale()
const {
  roomNumber,
  configuration,
  session,
  credential,
  active,
  restoring,
  players,
  playersCurrent,
  submitting,
  changingLanguage,
  connectionState,
  mapRevision,
  subtitles,
  subtitleHistory,
  refreshSubtitleHistory,
  audioState,
  audioBlocked,
  muted,
  playAudio,
  toggleMute,
  capture,
  leave,
  closeRoom,
  changeLanguage,
} = useRoomSession()

const roomMap = useRoomMap(roomNumber, session, credential, mapRevision)
const pip = useRoomPictureInPicture(() =>
  session.value ? `${session.value.sessionId}:${session.value.nicknameGeneration}` : '',
)
const textSize = ref(1.25)
const mapView = ref<MapViewState>({ ...DEFAULT_MAP_VIEW })
const pipVisibility = reactive<PipVisibility>({ ...DEFAULT_PIP_VISIBILITY })

const languageName = computed(
  () =>
    configuration.value?.outputLanguages.find(
      (language) => language.code === session.value?.outputLanguage,
    )?.name ?? null,
)

function maybeExpandPipForMap(next: PipVisibility) {
  const activeWindow = pip.window.value
  if (!activeWindow) {
    return
  }
  const resizeTarget = getPipResizeTarget(
    {
      innerHeight: activeWindow.innerHeight,
      outerWidth: activeWindow.outerWidth,
      outerHeight: activeWindow.outerHeight,
    },
    next,
  )
  if (resizeTarget) {
    pip.resize(resizeTarget)
  }
}

function togglePip() {
  if (pip.target.value) {
    pip.close()
    return
  }
  const next = resolvePipOpenVisibility(pipVisibility, 'default')
  pipVisibility.subtitles = next.subtitles
  pipVisibility.map = next.map
  void pip.open(getPipWindowDimensions(next))
}

function openMapPip() {
  const next = resolvePipOpenVisibility(pipVisibility, 'map')
  pipVisibility.subtitles = next.subtitles
  pipVisibility.map = next.map
  if (pip.target.value) {
    maybeExpandPipForMap(next)
    return
  }
  void pip.open(getPipWindowDimensions(next))
}

function setPipVisibility(panel: keyof PipVisibility, visible: boolean) {
  pipVisibility[panel] = visible
  if (panel === 'map' && visible) {
    maybeExpandPipForMap({
      subtitles: pipVisibility.subtitles,
      map: pipVisibility.map,
    })
  }
}
</script>

<template>
  <template v-if="configuration && active && session">
    <div class="room-workspace">
      <ListenerPanel
        class="room-listener"
        :session="session"
        :configuration="configuration"
        :connection-state="connectionState"
        :subtitles="subtitles"
        :subtitle-history="subtitleHistory"
        :audio-state="audioState"
        :audio-blocked="audioBlocked"
        :muted="muted"
        :capture="capture"
        :busy="submitting"
        :changing-language="changingLanguage"
        :text-size="textSize"
        :pip-supported="pip.supported.value"
        :pip-open="Boolean(pip.target.value)"
        :pip-opening="pip.opening.value"
        :pip-error="pip.error.value"
        @update:text-size="textSize = $event"
        @toggle-pip="togglePip"
        @leave="leave"
        @close-room="closeRoom"
        @language="changeLanguage"
        @play-audio="playAudio"
        @toggle-mute="toggleMute"
        @retry-history="refreshSubtitleHistory"
      />
      <TacticalMap
        class="room-map"
        :session="session"
        :map="roomMap"
        :view="mapView"
        :pip-supported="pip.supported.value"
        :pip-open="Boolean(pip.target.value)"
        :pip-opening="pip.opening.value"
        :pip-map-visible="pipVisibility.map"
        @update:view="mapView = $event"
        @pop-out-map="openMapPip"
        @close-pip="pip.close()"
      />
      <PlayerList class="room-players" :players="players" :current="playersCurrent" />
    </div>
    <RoomPipWindow
      v-if="pip.target.value"
      :target="pip.target.value"
      :session="session"
      :connection-state="connectionState"
      :language-name="languageName"
      :changing-language="changingLanguage"
      :text-size="textSize"
      :subtitles="subtitles"
      :map="roomMap"
      :view="mapView"
      :show-subtitles="pipVisibility.subtitles"
      :show-map="pipVisibility.map"
      @update:show-subtitles="setPipVisibility('subtitles', $event)"
      @update:show-map="setPipVisibility('map', $event)"
      @update:view="mapView = $event"
    />
  </template>
  <section v-else-if="restoring" class="entry-panel" aria-busy="true" role="status">
    <p>{{ t('restoring') }}</p>
  </section>
</template>
