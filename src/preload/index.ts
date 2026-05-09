import { contextBridge, ipcRenderer } from 'electron'
import type { PrivateaiApi } from '@shared/preloadApi'

const api: PrivateaiApi = {
  getStatus: () => ipcRenderer.invoke('status:get'),
  scanHardware: () => ipcRenderer.invoke('hardware:scan'),
  runHealth: () => ipcRenderer.invoke('health:run'),
  runScript: (name, args, options) => ipcRenderer.invoke('script:run', { name, args, ...options }),
  runRepair: (code) => ipcRenderer.invoke('repair:run', { code }),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url)
}

contextBridge.exposeInMainWorld('privateai', api)
