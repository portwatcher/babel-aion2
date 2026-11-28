<script setup lang="ts">
import {
  MAP_EXTENT,
  type MapPoint,
  type MapStroke,
  type MapStrokeInput,
} from '@babel/contracts'
import type * as Leaflet from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { DEFAULT_MAP_VIEW, type MapViewState } from '~/utils/pip-layout'

const { t } = useInterfaceLocale()
const props = defineProps<{
  strokes: MapStroke[]
  pending: MapStrokeInput | null
  drawing: boolean
  color: MapStrokeInput['color']
  selected: string | null
  erasing: boolean
  sessionId: string | null
  initialView?: MapViewState
  compact?: boolean
}>()
const emit = defineEmits<{
  draw: [stroke: MapStrokeInput]
  erase: [id: string]
  viewChange: [view: MapViewState]
}>()
const element = ref<HTMLDivElement>()
const loadError = ref(false)
const zoom = ref(props.initialView?.zoom ?? DEFAULT_MAP_VIEW.zoom)
const foreignDocument = ref(false)
const panning = ref(false)
let L: typeof Leaflet | undefined
let map: Leaflet.Map | undefined
let tiles: Leaflet.TileLayer | undefined
let observer: ResizeObserver | undefined
let ownerWin: Window | undefined
let invalidateTimer: ReturnType<typeof setTimeout> | undefined
let disposed = false
let preview: Leaflet.Polyline | undefined
let pendingLayer: Leaflet.Polyline | undefined
let pointer: number | null = null
let panPointer: number | null = null
let panLast: [number, number] | null = null
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
function stopPan() {
  panPointer = null
  panLast = null
  panning.value = false
}
function cancel() {
  stopPan()
  pointer = null
  draft = []
  preview?.remove()
  preview = undefined
}
function emitCurrentView() {
  if (!map) {
    return
  }
  const center = map.getCenter()
  emit('viewChange', {
    center: [center.lat, center.lng],
    zoom: map.getZoom(),
  })
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
  if (!props.drawing && foreignDocument.value && event.button === 0 && map) {
    panPointer = event.pointerId
    panLast = [event.clientX, event.clientY]
    panning.value = true
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
  if (panPointer === event.pointerId && panLast && map) {
    const dx = panLast[0] - event.clientX
    const dy = panLast[1] - event.clientY
    if (dx !== 0 || dy !== 0) {
      map.panBy([dx, dy], { animate: false })
      panLast = [event.clientX, event.clientY]
    }
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
  if (panPointer === event.pointerId) {
    stopPan()
    return
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
  const ownerDoc = element.value?.ownerDocument ?? document
  const wanted = new Set(props.strokes.map((stroke) => stroke.id))
  for (const [id, layer] of lines) {
    if (!wanted.has(id)) {
      layer.remove()
      lines.delete(id)
    }
  }
  props.strokes.forEach((stroke, index) => {
    const label = ownerDoc.createElement('span')
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
  map?.setView(DEFAULT_MAP_VIEW.center, DEFAULT_MAP_VIEW.zoom, { animate: false })
}
function changeZoom(delta: number) {
  if (!map) {
    return
  }
  map.setZoom(Math.max(0, Math.min(7, map.getZoom() + delta)), {
    animate: !foreignDocument.value,
  })
}
function key(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    cancel()
  }
  if (event.key === '0') {
    reset()
    event.preventDefault()
    return
  }
  if (!foreignDocument.value || !map) {
    return
  }
  const step = 80
  if (event.key === 'ArrowUp') {
    map.panBy([0, -step], { animate: false })
    event.preventDefault()
  } else if (event.key === 'ArrowDown') {
    map.panBy([0, step], { animate: false })
    event.preventDefault()
  } else if (event.key === 'ArrowLeft') {
    map.panBy([-step, 0], { animate: false })
    event.preventDefault()
  } else if (event.key === 'ArrowRight') {
    map.panBy([step, 0], { animate: false })
    event.preventDefault()
  } else if (event.key === '+' || event.key === '=') {
    changeZoom(1)
    event.preventDefault()
  } else if (event.key === '-' || event.key === '_') {
    changeZoom(-1)
    event.preventDefault()
  }
}
function handleResize() {
  map?.invalidateSize({ animate: false })
}
watch(() => [props.strokes, props.pending], render)
watch(
  () => props.drawing || props.erasing,
  (active) => {
    cancel()
    if (!foreignDocument.value) {
      if (active) {
        map?.dragging.disable()
      } else {
        map?.dragging.enable()
      }
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
  const ownerDoc = element.value.ownerDocument
  ownerWin = ownerDoc.defaultView ?? window
  const isForeign = ownerDoc !== document
  foreignDocument.value = isForeign
  const crs = L.extend({}, L.CRS.Simple, {
    transformation: new L.Transformation(1 / 16, 0, -1 / 16, 0),
  })
  // Inside Document PiP, Leaflet's built-in drag/keyboard/canvas-rAF paths bind to
  // the hidden main window; use synchronous SVG and direct pointer/keyboard handlers.
  map = L.map(element.value, {
    crs,
    minZoom: 0,
    maxZoom: 7,
    zoomSnap: 0.25,
    maxBounds: L.latLngBounds(bounds).pad(0.2),
    maxBoundsViscosity: 1,
    zoomControl: false,
    attributionControl: false,
    preferCanvas: !isForeign,
    fadeAnimation: !isForeign,
    zoomAnimation: !isForeign,
    markerZoomAnimation: !isForeign,
    dragging: !isForeign,
    boxZoom: !isForeign,
    touchZoom: !isForeign,
    keyboard: !isForeign,
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
    emitCurrentView()
  })
  map.on('moveend', emitCurrentView)
  const initial = props.initialView ?? DEFAULT_MAP_VIEW
  map.setView(initial.center, initial.zoom, { animate: false })
  zoom.value = map.getZoom()
  render()
  if (!isForeign && (props.drawing || props.erasing)) {
    map.dragging.disable()
  }
  const activeObserver = new ResizeObserver(handleResize)
  activeObserver.observe(element.value)
  observer = activeObserver
  ownerWin.addEventListener('resize', handleResize)
  invalidateTimer = setTimeout(handleResize, 0)
})
onBeforeUnmount(() => {
  disposed = true
  clearTimeout(invalidateTimer)
  observer?.disconnect()
  ownerWin?.removeEventListener('resize', handleResize)
  map?.remove()
  lines.clear()
})
</script>

<template>
  <div
    class="map-frame"
    :class="{
      'map-is-drawing': drawing,
      'map-is-erasing': erasing,
      'map-is-foreign': foreignDocument,
      'map-is-panning': panning,
      'map-frame-compact': compact,
    }"
  >
    <div
      ref="element"
      class="map-canvas"
      role="region"
      :tabindex="foreignDocument ? 0 : undefined"
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
        :size="compact ? 'small' : undefined"
        :disabled="zoom >= 7"
        @click="changeZoom(1)"
      />
      <Button
        :label="t('mapZoomOut')"
        severity="secondary"
        :size="compact ? 'small' : undefined"
        :disabled="zoom <= 0"
        @click="changeZoom(-1)"
      />
      <Button
        :label="t('mapReset')"
        severity="secondary"
        :size="compact ? 'small' : undefined"
        @click="reset"
      />
    </div>
    <div v-if="$slots.controls" class="map-corner-controls">
      <slot name="controls" />
    </div>
    <p v-if="loadError" class="map-load-error" role="status">
      {{ t('mapTilesFailed')
      }}<button type="button" @click="retryTiles">{{ t('retryLoad') }}</button>
    </p>
  </div>
</template>
