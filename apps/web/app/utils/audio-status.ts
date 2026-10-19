import type { PublicRoomConfiguration } from '@babel/contracts'
import type { InterfaceMessageKey } from '~/locales'

export const audioStatus: Record<
  PublicRoomConfiguration['room']['audioState'],
  { label: InterfaceMessageKey; description: InterfaceMessageKey }
> = {
  UNCONFIGURED: {
    label: 'audioUNCONFIGUREDLabel',
    description: 'audioUNCONFIGUREDDescription',
  },
  STOPPED: { label: 'audioSTOPPEDLabel', description: 'audioSTOPPEDDescription' },
  STOPPING: { label: 'audioSTOPPINGLabel', description: 'audioSTOPPINGDescription' },
  CONNECTING: {
    label: 'audioCONNECTINGLabel',
    description: 'audioCONNECTINGDescription',
  },
  LISTENING: { label: 'audioLISTENINGLabel', description: 'audioLISTENINGDescription' },
  UNAVAILABLE: {
    label: 'audioUNAVAILABLELabel',
    description: 'audioUNAVAILABLEDescription',
  },
}
