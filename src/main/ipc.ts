import { ipcMain, shell } from 'electron'
import { sanitizeWizardInstallState } from '@shared/wizardInstallPersist'
import { runPowerShellScript } from './scriptRunner'
import {
  prepareScriptProgressFile,
  sanitizeProgressToken,
  scriptProgressJsonPath,
  subscribeScriptProgressFromFile
} from './scriptProgressPoll'
import { getDashboardStatus, mergeHealthIntoDashboard, refreshHardwareScan } from './statusStore'
import { runHealthCheck } from './health'
import { readWizardInstallState, writeWizardInstallState } from './wizardInstallPersistStore'

export function registerIpcHandlers(): void {
  ipcMain.handle('wizardInstall:get', async () => readWizardInstallState())

  ipcMain.handle('wizardInstall:set', async (_e, payload: unknown) => {
    const parsed = sanitizeWizardInstallState(payload)
    await writeWizardInstallState(parsed)
    return parsed
  })

  ipcMain.handle('status:get', async () => getDashboardStatus())

  /** Re-runs health-check.ps1 and updates dashboard service state. Does not reject — returns last known status on failure. */
  ipcMain.handle('status:refresh', async () => {
    try {
      const r = await runHealthCheck()
      mergeHealthIntoDashboard(r)
    } catch (err) {
      console.error('[status:refresh] health check failed:', err)
    }
    return getDashboardStatus()
  })

  ipcMain.handle('hardware:scan', async () => refreshHardwareScan())

  ipcMain.handle('health:run', async () => {
    const r = await runHealthCheck()
    mergeHealthIntoDashboard(r)
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
        const result = await runPowerShellScript({
          scriptName: payload.name,
          args,
          timeoutMs: payload.timeoutMs ?? 180_000,
          elevated: payload.elevated === true
        })
        // Wizard (and others) run health via script:run — still merge so Dashboard status stays in sync.
        if (payload.name === 'health-check.ps1') {
          mergeHealthIntoDashboard(result)
        }
        return result
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
    const timeoutMs = elevated ? (code === 'WSL_UPDATE' ? 600_000 : 300_000) : 180_000
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
