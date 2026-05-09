/** Phases reported by long-running scripts (e.g. Comfy portable install). */
export type ScriptProgressPhase = 'download' | 'extract' | 'starting'

export interface ScriptProgressEvent {
  /** Matches `progressToken` passed to `runScript` so the UI ignores stale jobs. */
  token: string
  phase: ScriptProgressPhase
  /** 0-100 when known; null during extract or while waiting for Comfy to listen. */
  percent: number | null
}
