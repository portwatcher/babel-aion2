<script setup lang="ts">
import {
  MAP_COLORS,
  type ListenerSnapshot,
  type MapStrokeInput,
} from '@babel/contracts'

const { t } = useInterfaceLocale()
const props = defineProps<{
  roomNumber: string
  session: ListenerSnapshot | null
  credential: string | null
}>()
const { strokes, current, busy, error, enabled, refresh, save, remove } = useRoomMap(
  props.roomNumber,
  toRef(props, 'session'),
  toRef(props, 'credential'),
)
const drawing = ref(false)
const erasing = ref(false)
const color = ref<(typeof MAP_COLORS)[number]>(MAP_COLORS[0])
const pending = shallowRef<MapStrokeInput | null>(null)
const selected = ref<string | null>(null)
const own = computed(() =>
  strokes.value.filter((stroke) => stroke.sessionId === props.session?.sessionId),
)
function setTool(tool: 'move' | 'draw' | 'erase') {
  drawing.value = tool === 'draw'
  erasing.value = tool === 'erase'
}
async function commit(stroke: MapStrokeInput) {
  pending.value = stroke
  if (await save(stroke)) {
    pending.value = null
  }
}
watch(enabled, (value) => {
  if (!value) {
    drawing.value = false
    erasing.value = false
  }
})
watch(
  () => props.session?.sessionId,
  () => {
    pending.value = null
    selected.value = null
    setTool('move')
  },
)
</script>

<template>
  <section class="tactical-section" aria-labelledby="tactical-title">
    <div class="section-heading">
      <h2 id="tactical-title">{{ t('mapTitle') }}</h2>
      <Tag v-if="session && !current" :value="t('mapResyncing')" severity="secondary" />
    </div>
    <div class="map-toolbar" role="group" :aria-label="t('mapTools')">
      <div class="map-modes">
        <Button
          :label="t('mapMove')"
          :aria-pressed="!drawing && !erasing"
          :severity="!drawing && !erasing ? 'primary' : 'secondary'"
          @click="setTool('move')"
        />
        <Button
          :label="t('mapDraw')"
          :aria-pressed="drawing"
          :disabled="!enabled || busy || Boolean(pending)"
          :severity="drawing ? 'primary' : 'secondary'"
          @click="setTool(drawing ? 'move' : 'draw')"
        />
        <Button
          :label="t('mapErase')"
          :aria-pressed="erasing"
          :severity="erasing ? 'primary' : 'secondary'"
          :disabled="!enabled || busy || Boolean(pending)"
          @click="setTool(erasing ? 'move' : 'erase')"
        />
      </div>
      <div class="map-colors" role="group" :aria-label="t('mapColors')">
        <button
          v-for="(choice, index) in MAP_COLORS"
          :key="choice"
          type="button"
          class="map-color"
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
        severity="secondary"
        variant="text"
        :disabled="!enabled || busy || !own.length"
        @click="own.at(-1) && remove(own.at(-1)!.id)"
      />
    </div>
    <p v-if="drawing || erasing" class="muted map-help">
      {{ erasing ? t('mapEraseHelp') : t('mapDrawHelp') }}
    </p>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <div v-if="pending && !busy" class="map-toolbar" role="status">
      <p class="form-error">{{ t('mapStrokeUnconfirmed') }}</p>
      <Button
        :label="t('mapRetrySave')"
        :disabled="!enabled"
        @click="commit(pending!)"
      />
      <Button :label="t('mapDiscard')" severity="secondary" @click="pending = null" />
    </div>
    <div class="tactical-layout">
      <ClientOnly>
        <TacticalMapCanvas
          :strokes="strokes"
          :pending="pending"
          :drawing="drawing && enabled && !busy && !pending"
          :color="color"
          :selected="selected"
          :erasing="erasing && enabled && !busy"
          :session-id="session?.sessionId ?? null"
          @draw="commit"
          @erase="remove"
        />
        <template #fallback
          ><div class="map-canvas map-loading" aria-busy="true">
            {{ t('mapLoading') }}
          </div></template
        >
      </ClientOnly>
      <aside class="map-legend" :aria-label="t('mapLegend')">
        <h3>
          {{ t('mapLegend') }} <span class="muted">{{ strokes.length }}</span>
        </h3>
        <p v-if="!session" class="muted">{{ t('mapJoinHelp') }}</p>
        <p v-else-if="!strokes.length" class="muted">{{ t('mapEmpty') }}</p>
        <ol v-else class="map-stroke-list">
          <li v-for="(stroke, index) in strokes" :key="stroke.id">
            <button
              type="button"
              class="map-stroke-focus"
              :aria-label="
                t('mapFocusStroke', { number: index + 1, name: stroke.nickname })
              "
              @click="selected = stroke.id"
            >
              <svg width="32" height="16" viewBox="0 0 32 16" aria-hidden="true">
                <path
                  d="M2 12 L12 4 L20 10 L30 4"
                  :stroke="stroke.color"
                  fill="none"
                  stroke-width="3"
                />
              </svg>
              <span>{{ stroke.nickname }}</span
              ><small class="muted">#{{ index + 1 }}</small>
            </button>
            <Button
              v-if="stroke.sessionId === session?.sessionId"
              :label="t('mapDelete')"
              text
              size="small"
              severity="secondary"
              :disabled="busy"
              :aria-label="t('mapDeleteStroke', { number: index + 1 })"
              @click="remove(stroke.id)"
            />
          </li>
        </ol>
        <Button
          v-if="session"
          :label="t('mapRefresh')"
          severity="secondary"
          variant="text"
          size="small"
          :loading="busy"
          @click="refresh"
        />
      </aside>
    </div>
    <p class="muted map-attribution">
      {{ t('mapAttribution') }}
      <a
        href="https://interactivemap.app/aion2/maps/tw/abyss-reshanta-a"
        target="_blank"
        rel="noopener noreferrer"
        >InteractiveMap.app</a
      >
      · AION2 / NCSOFT
    </p>
  </section>
</template>
