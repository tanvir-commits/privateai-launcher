import '@testing-library/jest-dom/vitest'
import { defaultDashboardStatus } from '@shared/dashboardTypes'
import type { PrivateaiApi } from '@shared/preloadApi'
import type { ScriptResult } from '@shared/scriptContract'

const okScript = (message: string): ScriptResult => ({
  ok: true,
  status: 'success',
  message,
  details: {},
  warnings: [],
  errors: []
})

const mockApi: PrivateaiApi = {
  getStatus: async () => ({ ...defaultDashboardStatus, lanChatUrl: 'http://192.168.1.10:3000' }),
  scanHardware: async () => ({
    system: okScript('system'),
    gpu: okScript('gpu')
  }),
  runHealth: async () => okScript('healthy'),
  runScript: async () => okScript('script'),
  runRepair: async () => okScript('repair'),
  openExternal: async () => {}
}

if (typeof window !== 'undefined') {
  Object.assign(window, { privateai: mockApi })
}
