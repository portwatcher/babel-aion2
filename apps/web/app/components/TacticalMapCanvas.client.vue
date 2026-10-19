<script setup lang="ts">
import {
  MAP_EXTENT,
  type MapPoint,
  type MapStroke,
  type MapStrokeInput,
} from '@babel/contracts'
import type * as Leaflet from 'leaflet'
import 'leaflet/dist/leaflet.css'

const { t } = useInterfaceLocale()
const props = defineProps<{
  strokes: MapStroke[]
  pending: MapStrokeInput | null
  drawing: boolean
  color: MapStrokeInput['color']
  selected: string | null
  erasing: boolean
  sessionId: string | null
}>()
const emit = defineEmits<{ draw: [stroke: MapStrokeInput]; erase: [id: string] }>()
const element = ref<HTMLDivElement>()
const loadError = ref(false)
const zoom = ref(0)
let L: typeof Leaflet | undefined
let map: Leaflet.Map | undefined
let tiles: Leaflet.TileLayer | undefined
let observer: ResizeObserver | undefined
let disposed = false
let preview: Leaflet.Polyline | undefined
let pendingLayer: Leaflet.Polyline | undefined
let pointer: number | null = null
let draft: MapPoint[] = []
const pointers = new Set<number>()
const eraserHits = new Set<string>()
const lines = new Map<string, Leaflet.Polyline>()
const bounds: Leaflet.LatLngBoundsExpression = [
  [-MAP_EXTENT, 0],
  [0, MAP_EXTENT],
]
function latLngs(points: MapPoint[]): Leaflet.LatLngTuple[] {
  return points.map(([x, y]) => [-y, x])
}
function cancel() {
  pointer = null
  draft = []
  preview?.remove()
  preview = undefined
}
function point(event: PointerEvent): MapPoint | null {
  const location = map?.mouseEventToLatLng(event)
  if (!location) {
    return null
  }
  if (
    location.lng < 0 ||
    location.lng > MAP_EXTENT ||
    -location.lat < 0 ||
    -location.lat > MAP_EXTENT
  ) {
    return null
  }
  return [Math.round(location.lng * 100) / 100, Math.round(-location.lat * 100) / 100]
}
function down(event: PointerEvent) {
  pointers.add(event.pointerId)
  if (pointers.size > 1) {
    cancel()
    return
  }
  if (props.erasing && event.button === 0) {
    eraseAt(event)
    element.value?.setPointerCapture(event.pointerId)
    return
  }
  if (!props.drawing || event.button !== 0 || !L || !map) {
    return
  }
  const start = point(event)
  if (!start) {
    return
  }
  pointer = event.pointerId
  draft = [start]
  preview = L.polyline(latLngs(draft), {
    color: props.color,
    weight: 3,
    interactive: false,
  }).addTo(map)
  element.value?.setPointerCapture(event.pointerId)
}
function move(event: PointerEvent) {
  if (props.erasing && pointers.has(event.pointerId) && pointers.size === 1) {
    eraseAt(event)
    return
  }
  if (pointer !== event.pointerId || !props.drawing || !map) {
    return
  }
  const next = point(event)
  const last = draft.at(-1)
  if (!next || !last || draft.length >= 1000) {
    return
  }
  const distance = Math.hypot(next[0] - last[0], next[1] - last[1])
  if (distance < (1 / 2 ** map.getZoom()) * 16) {
    return
  }
  draft.push(next)
  preview?.setLatLngs(latLngs(draft))
}
function up(event: PointerEvent) {
  pointers.delete(event.pointerId)
  if (!pointers.size) {
    eraserHits.clear()
  }
  if (pointer !== event.pointerId) {
    return
  }
  move(event)
  if (draft.length > 1) {
    const result: MapStrokeInput = {
      id: crypto.randomUUID(),
      color: props.color,
      points: [...draft],
    }
    emit('draw', result)
  }
  cancel()
}
function pointerCancel(event: PointerEvent) {
  pointers.delete(event.pointerId)
  if (!pointers.size) {
    eraserHits.clear()
  }
  cancel()
}
function eraseAt(event: PointerEvent) {
  const position = point(event)
  if (!position || !map) {
    return
  }
  const tolerance = (12 * 16) / 2 ** map.getZoom()
  for (const stroke of props.strokes) {
    if (stroke.sessionId !== props.sessionId || eraserHits.has(stroke.id)) {
      continue
    }
    for (let i = 1; i < stroke.points.length; i += 1) {
      const a = stroke.points[i - 1]!
      const b = stroke.points[i]!
      const dx = b[0] - a[0]
      const dy = b[1] - a[1]
      const length = dx * dx + dy * dy
      const t = length
        ? Math.max(
            0,
            Math.min(
              1,
              ((position[0] - a[0]) * dx + (position[1] - a[1]) * dy) / length,
            ),
          )
        : 0
      if (
        Math.hypot(position[0] - a[0] - t * dx, position[1] - a[1] - t * dy) <=
        tolerance
      ) {
        eraserHits.add(stroke.id)
        emit('erase', stroke.id)
        return
      }
    }
  }
}
function render() {
  if (!map || !L) {
    return
  }
  const wanted = new Set(props.strokes.map((stroke) => stroke.id))
  for (const [id, layer] of lines) {
    if (!wanted.has(id)) {
      layer.remove()
      lines.delete(id)
    }
  }
  props.strokes.forEach((stroke, index) => {
    const label = document.createElement('span')
    label.textContent = `${stroke.nickname} · #${index + 1}`
    const existing = lines.get(stroke.id)
    if (existing) {
      existing.setTooltipContent(label)
      return
    }
    const layer = L!
      .polyline(latLngs(stroke.points), {
        color: stroke.color,
        weight: 3,
        opacity: 0.95,
      })
      .bindTooltip(label, {
        permanent: true,
        direction: 'top',
        className: 'map-author-label',
      })
      .addTo(map!)
    lines.set(stroke.id, layer)
  })
  pendingLayer?.remove()
  pendingLayer = props.pending
    ? L.polyline(latLngs(props.pending.points), {
        color: props.pending.color,
        weight: 3,
        dashArray: '6 6',
        interactive: false,
      }).addTo(map)
    : undefined
}
function retryTiles() {
  loadError.value = false
  tiles?.redraw()
}
function reset() {
  map?.setView([-2048, 2048], 4, { animate: false })
}
function changeZoom(delta: number) {
  map?.setZoom(Math.max(0, Math.min(7, map.getZoom() + delta)))
}
function key(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    cancel()
  }
  if (event.key === '0') {
    reset()
    event.preventDefault()
  }
}
watch(() => [props.strokes, props.pending], render)
watch(
  () => props.drawing || props.erasing,
  (drawing) => {
    cancel()
    if (drawing) {
      map?.dragging.disable()
    } else {
      map?.dragging.enable()
    }
  },
)
watch(
  () => props.selected,
  (id) => {
    const layer = id ? lines.get(id) : undefined
    if (layer) {
      map?.fitBounds(layer.getBounds(), {
        maxZoom: 6,
        padding: [48, 48],
        animate: false,
      })
      layer.bringToFront()
    }
  },
)
onMounted(async () => {
  L = await import('leaflet')
  if (disposed || !element.value) {
    return
  }
  const crs = L.extend({}, L.CRS.Simple, {
    transformation: new L.Transformation(1 / 16, 0, -1 / 16, 0),
  })
  map = L.map(element.value, {
    crs,
    minZoom: 0,
    maxZoom: 7,
    zoomSnap: 0.25,
    maxBounds: L.latLngBounds(bounds).pad(0.2),
    maxBoundsViscosity: 1,
    zoomControl: false,
    attributionControl: false,
    preferCanvas: true,
    keyboard: true,
  })
  tiles = L.tileLayer('/api/player/map-tiles/{z}_{x}_{y}.jpg', {
    bounds,
    noWrap: true,
    minZoom: 0,
    maxZoom: 7,
    maxNativeZoom: 7,
    keepBuffer: 1,
  }).addTo(map)
  tiles.on('tileerror', () => {
    loadError.value = true
  })
  map.on('zoomend', () => {
    zoom.value = map?.getZoom() ?? 0
  })
  reset()
  render()
  if (props.drawing) {
    map.dragging.disable()
  }
  observer = new ResizeObserver(() => map?.invalidateSize({ animate: false }))
  observer.observe(element.value)
})
onBeforeUnmount(() => {
  disposed = true
  observer?.disconnect()
  map?.remove()
  lines.clear()
})
</script>

<template>
  <div
    class="map-frame"
    :class="{ 'map-is-drawing': drawing, 'map-is-erasing': erasing }"
  >
    <div
      ref="element"
      class="map-canvas"
      role="region"
      :aria-label="t('mapKeyboardHelp')"
      @pointerdown="down"
      @pointermove="move"
      @pointerup="up"
      @pointercancel="pointerCancel"
      @keydown="key"
    />
    <div class="map-zoom" role="group" :aria-label="t('mapZoom')">
      <Button
        :label="t('mapZoomIn')"
        severity="secondary"
        :disabled="zoom >= 7"
        @click="changeZoom(1)"
      />
      <Button
        :label="t('mapZoomOut')"
        severity="secondary"
        :disabled="zoom <= 0"
        @click="changeZoom(-1)"
      />
      <Button :label="t('mapReset')" severity="secondary" @click="reset" />
    </div>
    <p v-if="loadError" class="map-load-error" role="status">
      {{ t('mapTilesFailed')
      }}<button type="button" @click="retryTiles">{{ t('retryLoad') }}</button>
    </p>
  </div>
</template>
