import { languageSampleSchema } from '@babel/contracts'
import { languageOperation, outputCode } from '../../../../utils/output-languages'
import { readSampleBody, runProviderSample } from '../../../../utils/provider-sample'
import { useProviderService } from '../../../../utils/provider-configuration'

export default defineEventHandler((event) =>
  languageOperation(event, async (service, actor) => {
    const input = await readSampleBody(event, languageSampleSchema)
    const prepared = await service.prepare(outputCode(event), input.expectedVersion)
    const sample = await runProviderSample(event, useProviderService(event), actor, {
      recognition: prepared.recognition,
      translation: prepared.translation,
      outputLanguage: prepared.language.code,
      includeTerms: prepared.language.includeTerms,
      audioBase64: input.audioBase64,
    })
    return service.recordValidation(prepared, sample, actor)
  }),
)
