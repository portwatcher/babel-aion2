<script setup lang="ts">
import {
  MAP_COLORS,
  type ListenerSnapshot,
  type MapStrokeInput,
} from '@babel/contracts'

const props = defineProps<{
  roomId: string
  session: ListenerSnapshot | null
  credential: string | null
}>()
const { strokes, current, busy, error, enabled, refresh, save, remove } = useRoomMap(
  props.roomId,
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
      <div class="page-heading-copy">
        <p class="eyebrow">共享战术地图</p>
        <h2 id="tactical-title">深渊 · 艾雷修蓝塔下层</h2>
      </div>
      <Tag
        :value="!session ? '加入后可共同画线' : current ? '地图已同步' : '正在重新同步'"
        severity="secondary"
      />
    </div>
    <div class="map-toolbar" role="group" aria-label="地图画线工具">
      <Button
        :label="drawing ? '画线中' : '画线'"
        :aria-pressed="drawing"
        :disabled="!enabled || busy || Boolean(pending)"
        :severity="drawing ? 'primary' : 'secondary'"
        @click="setTool(drawing ? 'move' : 'draw')"
      />
      <Button
        label="移动地图"
        severity="secondary"
        :aria-pressed="!drawing && !erasing"
        @click="setTool('move')"
      />
      <Button
        label="擦除"
        :aria-pressed="erasing"
        :severity="erasing ? 'primary' : 'secondary'"
        :disabled="!enabled || busy || Boolean(pending)"
        @click="setTool(erasing ? 'move' : 'erase')"
      />
      <div class="map-colors" role="group" aria-label="线条颜色">
        <button
          v-for="(choice, index) in MAP_COLORS"
          :key="choice"
          type="button"
          class="map-color"
          :style="{ '--stroke-color': choice }"
          :aria-label="['琥珀色', '蓝色', '粉色', '绿色', '紫色'][index]"
          :aria-pressed="color === choice"
          @click="color = choice"
        />
      </div>
      <Button
        label="撤销上一笔"
        severity="secondary"
        :disabled="!enabled || busy || !own.length"
        @click="own.at(-1) && remove(own.at(-1)!.id)"
      />
    </div>
    <p class="muted map-help">
      {{
        erasing
          ? '点按或拖过自己的线条，擦除整条线。其他成员的线条会保留。'
          : drawing
            ? '按住并拖动画线。双指可缩放；每条线旁会显示你的游戏 ID。'
            : '拖动平移，滚轮或双指缩放；也可用地图上的缩放按钮。'
      }}
    </p>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <div v-if="pending && !busy" class="map-toolbar" role="status">
      <p>这条线尚未确认保存。</p>
      <Button label="重试保存" :disabled="!enabled" @click="commit(pending!)" />
      <Button label="放弃这条线" severity="secondary" @click="pending = null" />
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
            正在加载地图…
          </div></template
        >
      </ClientOnly>
      <aside class="map-legend" aria-label="画线与游戏 ID">
        <h3>
          画线与游戏 ID <span class="muted">{{ strokes.length }}</span>
        </h3>
        <p v-if="!session" class="muted">
          验证角色并加入房间后，即可查看和参与协作画线。
        </p>
        <p v-else-if="!strokes.length" class="muted">
          还没有人画线。选择画笔，在地图上标出路线。
        </p>
        <ol v-else class="map-stroke-list">
          <li v-for="(stroke, index) in strokes" :key="stroke.id">
            <button
              type="button"
              class="map-stroke-focus"
              :aria-label="`定位第 ${index + 1} 条线，${stroke.nickname}`"
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
              label="删除"
              text
              size="small"
              severity="secondary"
              :disabled="busy"
              :aria-label="`删除自己的第 ${index + 1} 条线`"
              @click="remove(stroke.id)"
            />
          </li>
        </ol>
        <Button
          v-if="session"
          label="刷新画线"
          severity="secondary"
          :loading="busy"
          @click="refresh"
        />
      </aside>
    </div>
    <p class="muted map-attribution">
      底图来源：<a
        href="https://interactivemap.app/aion2/maps/tw/abyss-reshanta-a"
        target="_blank"
        rel="noopener noreferrer"
        >InteractiveMap.app</a
      >
      · AION2 / NCSOFT。画线仅在当前房间共享。
    </p>
  </section>
</template>
