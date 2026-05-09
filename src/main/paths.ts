import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from 'electron'

const mainDir = dirname(fileURLToPath(import.meta.url))

/**
 * Packaged builds ship scripts under `resources/scripts/windows` (see electron-builder.json).
 * Dev and `electron-vite build` run the main bundle from `dist-electron/main`, so we resolve
 * the repo root relative to this file (not `app.getAppPath()`, which points at that dist folder).
 */
export function getWindowsScriptsDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'scripts', 'windows')
  }
  return join(mainDir, '..', '..', 'scripts', 'windows')
}

export function getConfigDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'config')
  }
  return join(mainDir, '..', '..', 'config')
}
