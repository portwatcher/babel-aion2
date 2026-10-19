import type { OpenAISettings, SampleSegment } from '@babel/contracts'

export interface TranslationPath {
  outputLanguage: string
  settings: OpenAISettings
  credential: string
  version: number
}
export interface SubtitleUpdate extends SampleSegment {
  outputLanguage: string
  configurationVersion: number
  sequence: number
  discontinuity: boolean
}
