import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import {
  emptyWizardInstallState,
  sanitizeWizardInstallState,
  type WizardInstallPersisted
} from '@shared/wizardInstallPersist'

let cachedPath = ''

export function wizardInstallStatePath(): string {
  if (!cachedPath) cachedPath = join(app.getPath('userData'), 'wizard-install-state.json')
  return cachedPath
}

export async function readWizardInstallState(): Promise<WizardInstallPersisted> {
  try {
    const raw = await readFile(wizardInstallStatePath(), 'utf8')
    const parsed = JSON.parse(raw) as unknown
    return sanitizeWizardInstallState(parsed)
  } catch {
    return emptyWizardInstallState()
  }
}

export async function writeWizardInstallState(data: WizardInstallPersisted): Promise<void> {
  const p = wizardInstallStatePath()
  await mkdir(dirname(p), { recursive: true })
  await writeFile(p, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}
