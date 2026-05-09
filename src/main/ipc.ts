import { ipcMain, shell } from 'electron'
import { runPowerShellScript } from './scriptRunner'
import {
  prepareScriptProgressFile,
  sanitizeProgressToken,
  scriptProgressJsonPath,
  subscribeScriptProgressFromFile
} from './scriptProgressPoll'
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

  ipcMain.handle(
    'script:run',
    async (
      event,
      payload: {
        name: string
        args?: Record<string, string>
        elevated?: boolean
        timeoutMs?: number
        progressToken?: string
      }
    ) => {
      const token = sanitizeProgressToken(payload.progressToken)
      const args: Record<string, string> = { ...(payload.args ?? {}) }
      delete args.ProgressFile

      let detachProgress: (() => void) | undefined
      if (token !== null) {
        const fp = scriptProgressJsonPath(token)
        await prepareScriptProgressFile(fp)
        args.ProgressFile = fp
        detachProgress = subscribeScriptProgressFromFile(event.sender, token, fp)
      }

      try {
        return await runPowerShellScript({
          scriptName: payload.name,
          args,
          timeoutMs: payload.timeoutMs ?? 180_000,
          elevated: payload.elevated === true
        })
      } finally {
        detachProgress?.()
      }
    }
  )

  ipcMain.handle('repair:run', async (_e, payload: { code: string }) => {
    const code = payload.code.toUpperCase()
    const elevated =
      code === 'DOCKER_PROGRAMDATA_ACL' ||
      code === 'DOCKER_VIRTUALIZATION_PREREQS' ||
      code === 'WSL_UPDATE' ||
      code === 'DOCKER_ENGINE_WINDOWS'
    const timeoutMs = elevated
      ? code === 'WSL_UPDATE'
        ? 600_000
        : code === 'DOCKER_ENGINE_WINDOWS'
          ? 120_000
          : 300_000
      : 180_000
    return runPowerShellScript({
      scriptName: 'repair.ps1',
      args: { Code: payload.code },
      timeoutMs,
      elevated
    })
  })

  ipcMain.handle('shell:openExternal', async (_e, url: string) => {
    await shell.openExternal(url)
  })
}
