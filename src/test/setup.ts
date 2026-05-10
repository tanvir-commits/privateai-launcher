import '@testing-library/jest-dom/vitest'
import { defaultDashboardStatus } from '@shared/dashboardTypes'
import type { PrivateaiApi } from '@shared/preloadApi'
import type { ScriptResult } from '@shared/scriptContract'
import { emptyWizardInstallState } from '@shared/wizardInstallPersist'

const okScript = (message: string): ScriptResult => ({
  ok: true,
  status: 'success',
  message,
  details: {},
  warnings: [],
  errors: []
})

const wizardState = emptyWizardInstallState()

const mockApi: PrivateaiApi = {
  getWizardInstallState: async () => ({ ...wizardState }),
  setWizardInstallState: async (payload) => ({ ...payload }),
  getStatus: async () => ({ ...defaultDashboardStatus, lanChatUrl: 'http://192.168.1.10:3000' }),
  refreshStatus: async () => ({ ...defaultDashboardStatus, lanChatUrl: 'http://192.168.1.10:3000' }),
  scanHardware: async () => ({
    system: okScript('system'),
    gpu: okScript('gpu')
  }),
  getLastHardwareScan: async () => null,
  runHealth: async () => okScript('healthy'),
  runScript: async () => okScript('script'),
  runRepair: async () => okScript('repair'),
  openExternal: async () => {},
  onScriptProgress: () => () => {}
}

if (typeof window !== 'undefined') {
  Object.assign(window, { privateai: mockApi })
}
