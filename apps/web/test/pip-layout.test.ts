import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_PIP_VISIBILITY,
  getPipResizeTarget,
  getPipWindowDimensions,
  resolvePipOpenVisibility,
} from '../app/utils/pip-layout.ts'

test('opening PiP restores defaults when both panels were hidden and respects explicit map pop-out', () => {
  assert.deepEqual(
    resolvePipOpenVisibility({ subtitles: false, map: false }, 'default'),
    DEFAULT_PIP_VISIBILITY,
  )
  assert.deepEqual(
    resolvePipOpenVisibility({ subtitles: true, map: false }, 'default'),
    { subtitles: true, map: false },
  )
  assert.deepEqual(resolvePipOpenVisibility({ subtitles: true, map: false }, 'map'), {
    subtitles: true,
    map: true,
  })
  assert.deepEqual(resolvePipOpenVisibility({ subtitles: false, map: false }, 'map'), {
    subtitles: false,
    map: true,
  })
})

test('PiP window dimensions fit combined, map-only, and subtitle-only layouts', () => {
  const combined = getPipWindowDimensions({ subtitles: true, map: true })
  const mapOnly = getPipWindowDimensions({ subtitles: false, map: true })
  const subtitlesOnly = getPipWindowDimensions({ subtitles: true, map: false })

  assert.ok(combined.height > mapOnly.height)
  assert.ok(mapOnly.height > subtitlesOnly.height)
  assert.deepEqual(
    getPipWindowDimensions({ subtitles: false, map: false }),
    combined,
    'hidden fallback opens at combined size',
  )
})

test('turning the map on inside a short PiP window expands height while preserving width and chrome', () => {
  assert.deepEqual(
    getPipResizeTarget(
      { innerHeight: 200, outerWidth: 600, outerHeight: 236 },
      { subtitles: true, map: true },
    ),
    { width: 600, height: 556 },
  )
  assert.deepEqual(
    getPipResizeTarget(
      { innerHeight: 180, outerWidth: 500, outerHeight: 210 },
      { subtitles: false, map: true },
    ),
    { width: 500, height: 450 },
  )
  assert.equal(
    getPipResizeTarget(
      { innerHeight: 420, outerWidth: 520, outerHeight: 456 },
      { subtitles: true, map: true },
    ),
    null,
    'already tall windows keep the user size',
  )
  assert.equal(
    getPipResizeTarget(
      { innerHeight: 200, outerWidth: 560, outerHeight: 236 },
      { subtitles: true, map: false },
    ),
    null,
    'hiding the map never forces a resize',
  )
})
