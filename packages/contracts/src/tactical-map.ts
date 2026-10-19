import { z } from 'zod'

export const MAP_ID = 'abyss-reshanta-a'
export const MAP_EXTENT = 4096
export const MAP_COLORS = [
  '#fbbf24',
  '#38bdf8',
  '#f472b6',
  '#a3e635',
  '#c4b5fd',
] as const
export const mapPointSchema = z.tuple([
  z.number().finite().min(0).max(MAP_EXTENT),
  z.number().finite().min(0).max(MAP_EXTENT),
])
export const mapStrokeInputSchema = z.object({
  id: z.uuid(),
  color: z.enum(MAP_COLORS),
  points: z.array(mapPointSchema).min(2).max(1000),
})
export const mapStrokeSchema = mapStrokeInputSchema.extend({
  sessionId: z.uuid(),
  nickname: z.string(),
  createdAt: z.iso.datetime(),
})
export type MapPoint = z.infer<typeof mapPointSchema>
export type MapStrokeInput = z.infer<typeof mapStrokeInputSchema>
export type MapStroke = z.infer<typeof mapStrokeSchema>
