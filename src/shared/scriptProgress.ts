/**
 * Renderer receives these from Electron main polling script-written JSON snapshots.
 * `phase` is a lowercase script-defined label (e.g. download, install, winget, preflight).
 */
export interface ScriptProgressEvent {
  /** Matches `progressToken` passed to `runScript` so the UI ignores stale jobs. */
  token: string
  phase: string
  /** 0-100 when the script supplies it; absent or null means indeterminate. */
  percent: number | null
  detail?: string
}
