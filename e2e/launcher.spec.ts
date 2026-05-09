import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import { _electron as electron } from 'playwright'
import type { ElectronApplication, Page } from 'playwright'

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

const mainEntry = path.join(repoRoot, 'dist-electron', 'main', 'index.js')

test.describe('Electron launcher (smoke)', () => {
  test.beforeAll(() => {
    if (!fs.existsSync(mainEntry)) {
      throw new Error(
        'Missing compiled main bundle. Run `npm run build` before `npm run test:e2e`.'
      )
    }
  })

  let app: ElectronApplication

  test.beforeEach(async () => {
    const env = Object.fromEntries(
      Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined)
    ) as Record<string, string>
    delete env.ELECTRON_RENDERER_URL
    app = await electron.launch({
      cwd: repoRoot,
      args: [mainEntry],
      env
    })
  })

  test.afterEach(async () => {
    await app.close()
  })

  async function waitForLauncherUi(page: Page): Promise<void> {
    await expect(page.getByText('PrivateAI Launcher', { exact: true }).first()).toBeVisible({
      timeout: 30_000
    })
    await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible()
  }

  test('opens Home and navigates to Install Wizard', async () => {
    const page = await app.firstWindow()
    await waitForLauncherUi(page)
    await expect(page).toHaveTitle(/PrivateAI Launcher/)

    await page.getByRole('link', { name: 'Install Wizard' }).click()
    await expect(page.getByRole('heading', { name: 'Install Wizard' })).toBeVisible({
      timeout: 15_000
    })
  })

  /**
   * Clicks Run core install and waits for early scripts (does not wait for Docker/models).
   * Proves Electron IPC, PowerShell runner, and wizard wiring for the hot path.
   */
  test('Run core install starts and finishes system + GPU checks', async () => {
    test.setTimeout(300_000)
    const page = await app.firstWindow()
    await waitForLauncherUi(page)
    await page.getByRole('link', { name: 'Install Wizard' }).click()
    await expect(page.getByRole('heading', { name: 'Install Wizard' })).toBeVisible()

    await page.getByRole('button', { name: 'Run core install' }).click()

    await expect(page.getByText(/--- check-system\.ps1 started ---/)).toBeVisible({
      timeout: 90_000
    })
    await expect(page.getByText(/check-system\.ps1 => ok=true/)).toBeVisible({ timeout: 120_000 })

    await expect(page.getByText(/--- check-gpu\.ps1 started ---/)).toBeVisible({ timeout: 120_000 })
    await expect(page.getByText(/check-gpu\.ps1 => ok=true/)).toBeVisible({ timeout: 120_000 })
  })
})
