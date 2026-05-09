import { ipcMain, shell } from 'electron'
import { runPowerShellScript } from './scriptRunner'
import { getDashboardStatus, refreshHardwareScan, setDashboardStatus } from './statusStore'
import { runHealthCheck } from './health'

function applyHealthToDashboard(r: Awaited<ReturnType<typeof runHealthCheck>>): void {
  const d = r.details as Record<string, unknown> | undefined
  const phone = d?.phoneAccess as Record<string, unknown> | undefined
  const url = typeof phone?.url === 'string' ? phone.url : ''
  const ollama = d?.ollama as Record<string, unknown> | undefined
  const ow = d?.openWebui as Record<string, unknown> | undefined
  const comfy = d?.comfyui as Record<string, unknown> | undefined

  setDashboardStatus({
    lastHealthAt: new Date().toISOString(),
    lastHealthSummary: r.message,
    lanChatUrl: url || '',
    ollama: typeof ollama?.running === 'boolean' ? (ollama.running ? 'running' : 'stopped') : 'unknown',
    openWebui: typeof ow?.running === 'boolean' ? (ow.running ? 'running' : 'stopped') : 'unknown',
    comfyui: typeof comfy?.running === 'boolean' ? (comfy.running ? 'running' : 'stopped') : 'unknown'
  })
}

export function registerIpcHandlers(): void {
  ipcMain.handle('status:get', async () => getDashboardStatus())

  ipcMain.handle('hardware:scan', async () => refreshHardwareScan())

  ipcMain.handle('health:run', async () => {
    const r = await runHealthCheck()
    applyHealthToDashboard(r)
    return r
  })

  ipcMain.handle('script:run', async (_e, payload: { name: string; args?: Record<string, string> }) => {
    return runPowerShellScript({
      scriptName: payload.name,
      args: payload.args,
      timeoutMs: 180_000
    })
  })

  ipcMain.handle('repair:run', async (_e, payload: { code: string }) => {
    return runPowerShellScript({
      scriptName: 'repair.ps1',
      args: { Code: payload.code },
      timeoutMs: 180_000
    })
  })

  ipcMain.handle('shell:openExternal', async (_e, url: string) => {
    await shell.openExternal(url)
  })
}
