<script setup lang="ts">
import { MAP_COLORS, type ListenerSnapshot } from '@babel/contracts'
import type { RoomMapController } from '~/composables/useRoomMap'
import type { MapViewState } from '~/utils/pip-layout'
import type { SubtitlePresentation } from '~/utils/subtitle-view'

const { t } = useInterfaceLocale()
const props = defineProps<{
  target: HTMLElement
  session: ListenerSnapshot
  connectionState: string
  languageName: string | null
  changingLanguage: boolean
  textSize: number
  subtitles: SubtitlePresentation
  map: RoomMapController
  view: MapViewState
  showSubtitles: boolean
  showMap: boolean
}>()
const emit = defineEmits<{
  'update:showSubtitles': [visible: boolean]
  'update:showMap': [visible: boolean]
  'update:view': [view: MapViewState]
}>()

const showTools = ref(false)
const drawing = ref(false)
const erasing = ref(false)
const color = ref<(typeof MAP_COLORS)[number]>(MAP_COLORS[0])

const strokes = computed(() => props.map.strokes.value)
const pending = computed(() => props.map.pending.value)
const current = computed(() => props.map.current.value)
const busy = computed(() => props.map.busy.value)
const error = computed(() => props.map.error.value)
const enabled = computed(() => props.map.enabled.value)
const own = computed(() =>
  strokes.value.filter((stroke) => stroke.sessionId === props.session.sessionId),
)

function setTool(tool: 'move' | 'draw' | 'erase') {
  drawing.value = tool === 'draw'
  erasing.value = tool === 'erase'
}
function toggleTools() {
  showTools.value = !showTools.value
  if (!showTools.value) {
    setTool('move')
  }
}

watch(enabled, (value) => {
  if (!value) {
    setTool('move')
  }
})
watch(
  () => props.showMap,
  (visible) => {
    if (!visible) {
      showTools.value = false
      setTool('move')
    }
  },
)
watch(
  () => props.session.sessionId,
  () => {
    showTools.value = false
    setTool('move')
  },
)
</script>

<template>
  <Teleport :to="target">
    <div class="room-pip-shell">
      <header class="pip-toolbar" role="region" :aria-label="t('pipControls')">
        <div class="pip-switches">
          <div class="pip-switch-item">
            <ToggleSwitch
              input-id="pip-toggle-subtitles"
              :model-value="showSubtitles"
              @update:model-value="emit('update:showSubtitles', Boolean($event))"
            />
            <label for="pip-toggle-subtitles">{{ t('pipShowSubtitles') }}</label>
          </div>
          <div class="pip-switch-item">
            <ToggleSwitch
              input-id="pip-toggle-map"
              :model-value="showMap"
              @update:model-value="emit('update:showMap', Boolean($event))"
            />
            <label for="pip-toggle-map">{{ t('pipShowMap') }}</label>
          </div>
        </div>
        <Tag
          v-if="showMap && !current"
          :value="t('mapResyncing')"
          severity="secondary"
        />
      </header>

      <div v-if="!showSubtitles && !showMap" class="pip-empty muted" role="status">
        <p>{{ t('pipAllHidden') }}</p>
      </div>

      <div
        v-if="showSubtitles"
        class="pip-subtitles-pane"
        :class="{ 'pip-subtitles-only': !showMap }"
      >
        <ListenerSubtitleStatus
          :session="session"
          :connection-state="connectionState"
          :language-name="languageName"
          :changing-language="changingLanguage"
          :text-size="textSize"
          :subtitles="subtitles"
          compact
        />
      </div>

      <section v-if="showMap" class="pip-map-pane" :aria-label="t('mapTitle')">
        <div
          v-if="showTools"
          class="pip-map-tools"
          role="group"
          :aria-label="t('mapTools')"
        >
          <div class="map-modes">
            <Button
              :label="t('mapMove')"
              size="small"
              :aria-pressed="!drawing && !erasing"
              :severity="!drawing && !erasing ? 'primary' : 'secondary'"
              @click="setTool('move')"
            />
            <Button
              :label="t('mapDraw')"
              size="small"
              :aria-pressed="drawing"
              :disabled="!enabled || busy || Boolean(pending)"
              :severity="drawing ? 'primary' : 'secondary'"
              @click="setTool(drawing ? 'move' : 'draw')"
            />
            <Button
              :label="t('mapErase')"
              size="small"
              :aria-pressed="erasing"
              :severity="erasing ? 'primary' : 'secondary'"
              :disabled="!enabled || busy || Boolean(pending)"
              @click="setTool(erasing ? 'move' : 'erase')"
            />
          </div>
          <div
            class="map-colors pip-map-colors"
            role="group"
            :aria-label="t('mapColors')"
          >
            <button
              v-for="(choice, index) in MAP_COLORS"
              :key="choice"
              type="button"
              class="map-color pip-map-color"
              :style="{ '--stroke-color': choice }"
              :aria-label="
                [
                  t('colorAmber'),
                  t('colorBlue'),
                  t('colorPink'),
                  t('colorGreen'),
                  t('colorPurple'),
                ][index]
              "
              :aria-pressed="color === choice"
              @click="color = choice"
            />
          </div>
          <Button
            :label="t('mapUndo')"
            size="small"
            severity="secondary"
            variant="text"
            :disabled="!enabled || busy || !own.length"
            @click="own.at(-1) && map.remove(own.at(-1)!.id)"
          />
        </div>
        <div v-if="error || (pending && !busy)" class="pip-map-feedback" role="status">
          <p v-if="error" class="form-error">{{ error }}</p>
          <template v-if="pending && !busy">
            <p class="form-error">{{ t('mapStrokeUnconfirmed') }}</p>
            <Button
              :label="t('mapRetrySave')"
              size="small"
              :disabled="!enabled"
              @click="map.commit(pending!)"
            />
            <Button
              :label="t('mapDiscard')"
              size="small"
              severity="secondary"
              @click="map.discardPending()"
            />
          </template>
        </div>
        <ClientOnly>
          <TacticalMapCanvas
            :strokes="strokes"
            :pending="pending"
            :drawing="drawing && enabled && !busy && !pending"
            :color="color"
            :selected="null"
            :erasing="erasing && enabled && !busy"
            :session-id="session.sessionId"
            :initial-view="view"
            compact
            @draw="map.commit"
            @erase="map.remove"
            @view-change="emit('update:view', $event)"
          >
            <template #controls>
              <Button
                :label="showTools ? t('pipMapHideTools') : t('pipMapToolsToggle')"
                :severity="showTools ? 'primary' : 'secondary'"
                size="small"
                :aria-expanded="showTools"
                @click="toggleTools"
              />
            </template>
          </TacticalMapCanvas>
        </ClientOnly>
      </section>
    </div>
  </Teleport>
</template>
