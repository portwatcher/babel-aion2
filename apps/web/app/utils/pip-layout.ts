export interface MapViewState {
  center: [number, number]
  zoom: number
}

export interface PipVisibility {
  subtitles: boolean
  map: boolean
}

export type PipOpenIntent = 'default' | 'map'

export interface PipDimensions {
  width: number
  height: number
}

export interface PipViewportSnapshot {
  innerHeight: number
  outerWidth: number
  outerHeight: number
}

export const DEFAULT_MAP_VIEW: MapViewState = {
  center: [-2048, 2048],
  zoom: 4,
}

export const DEFAULT_PIP_VISIBILITY: PipVisibility = {
  subtitles: true,
  map: true,
}

const MIN_MAP_INNER_HEIGHT = 340

export function resolvePipOpenVisibility(
  current: PipVisibility,
  intent: PipOpenIntent,
): PipVisibility {
  if (intent === 'map') {
    return {
      subtitles: current.subtitles,
      map: true,
    }
  }
  if (!current.subtitles && !current.map) {
    return { ...DEFAULT_PIP_VISIBILITY }
  }
  return { ...current }
}

export function getPipWindowDimensions(visibility: PipVisibility): PipDimensions {
  if (visibility.subtitles && visibility.map) {
    return { width: 520, height: 560 }
  }
  if (visibility.map) {
    return { width: 520, height: 440 }
  }
  if (visibility.subtitles) {
    return { width: 560, height: 220 }
  }
  return { width: 520, height: 560 }
}

export function getPipResizeTarget(
  viewport: PipViewportSnapshot,
  next: PipVisibility,
): PipDimensions | null {
  if (!next.map || viewport.innerHeight >= MIN_MAP_INNER_HEIGHT) {
    return null
  }
  const desiredInnerHeight = next.subtitles ? 520 : 420
  const chromeHeight = Math.max(0, viewport.outerHeight - viewport.innerHeight)
  const width = viewport.outerWidth > 0 ? viewport.outerWidth : 520
  return {
    width,
    height: desiredInnerHeight + chromeHeight,
  }
}
