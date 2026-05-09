import { join } from 'node:path'
import { app } from 'electron'

/**
 * Packaged builds ship scripts under `resources/scripts/windows` (see electron-builder.json).
 * In development, scripts live in the repo next to `package.json`.
 */
export function getWindowsScriptsDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'scripts', 'windows')
  }
  return join(app.getAppPath(), 'scripts', 'windows')
}

export function getConfigDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'config')
  }
  return join(app.getAppPath(), 'config')
}
