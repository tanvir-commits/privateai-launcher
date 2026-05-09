import { contextBridge, ipcRenderer } from 'electron'
import type { PrivateaiApi } from '@shared/preloadApi'
import type { ScriptProgressEvent } from '@shared/scriptProgress'

const api: PrivateaiApi = {
  getWizardInstallState: () => ipcRenderer.invoke('wizardInstall:get'),
  setWizardInstallState: (payload) => ipcRenderer.invoke('wizardInstall:set', payload),
  getStatus: () => ipcRenderer.invoke('status:get'),
  refreshStatus: () => ipcRenderer.invoke('status:refresh'),
  scanHardware: () => ipcRenderer.invoke('hardware:scan'),
  runHealth: () => ipcRenderer.invoke('health:run'),
  runScript: (name, args, options) => ipcRenderer.invoke('script:run', { name, args, ...options }),
  runRepair: (code) => ipcRenderer.invoke('repair:run', { code }),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  onScriptProgress: (listener) => {
    const wrapped = (_e: unknown, payload: ScriptProgressEvent): void => {
      listener(payload)
    }
    ipcRenderer.on('script:progress', wrapped)
    return () => {
      ipcRenderer.removeListener('script:progress', wrapped)
    }
  }
}

contextBridge.exposeInMainWorld('privateai', api)
