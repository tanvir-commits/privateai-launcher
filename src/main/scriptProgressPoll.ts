import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import type { WebContents } from 'electron'
import type { ScriptProgressEvent } from '@shared/scriptProgress'

const PROGRESS_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Accepts UUID v1-v5-shaped tokens only; rejects path injection attempts. */
export function sanitizeProgressToken(t: unknown): string | null {
  if (typeof t !== 'string') return null
  return PROGRESS_UUID.test(t) ? t : null
}

export function scriptProgressJsonPath(token: string): string {
  return join(tmpdir(), 'PrivateAI', 'script-progress', `${token}.json`)
}

export async function prepareScriptProgressFile(filePath: string): Promise<void> {
  await fs.mkdir(dirname(filePath), { recursive: true })
  await fs.rm(filePath, { force: true }).catch(() => {})
}

/** Poll JSON progress snapshots written by scripts; notifies renderer via `script:progress`. */
export function subscribeScriptProgressFromFile(
  sender: WebContents,
  token: string,
  filePath: string
): () => void {
  let lastRawTrimmed = ''

  const tick = async (): Promise<void> => {
    if (sender.isDestroyed()) return
    try {
      const raw = (await fs.readFile(filePath, 'utf8')).replace(/^\uFEFF/, '')
      const trimmed = raw.trim()
      if (trimmed.length === 0 || trimmed === lastRawTrimmed) return
      lastRawTrimmed = trimmed

      const parsed = JSON.parse(trimmed) as { phase?: unknown; pct?: unknown }
      if (typeof parsed.phase !== 'string') return
      const ph = parsed.phase
      if (ph !== 'download' && ph !== 'extract' && ph !== 'starting') return

      let percent: number | null = null
      if ('pct' in parsed && parsed.pct !== null && parsed.pct !== undefined && parsed.pct !== '') {
        const n = Number(parsed.pct)
        if (!Number.isNaN(n)) percent = Math.max(0, Math.min(100, Math.round(n)))
      }

      const payload: ScriptProgressEvent = { token, phase: ph, percent }
      sender.send('script:progress', payload)
    } catch {
      /* missing or truncated file */
    }
  }

  const id = setInterval(() => {
    void tick()
  }, 280)
  void tick()

  return () => {
    clearInterval(id)
    void fs.rm(filePath, { force: true }).catch(() => {})
  }
}
