import type { ReactNode } from 'react'
import type { CompletionChipKind } from '@shared/wizardInstallPersist'
import { completionChipKindToLabel } from '@shared/wizardInstallPersist'

export type StepState = 'pending' | 'running' | 'success' | 'warning' | 'error'

function stateLabel(s: StepState): string {
  switch (s) {
    case 'pending':
      return 'Pending'
    case 'running':
      return 'Running'
    case 'success':
      return 'Done'
    case 'warning':
      return 'Warning'
    case 'error':
      return 'Error'
  }
}

function stateTone(s: StepState): 'ok' | 'warn' | 'bad' | 'unknown' {
  if (s === 'success') return 'ok'
  if (s === 'warning') return 'warn'
  if (s === 'error') return 'bad'
  if (s === 'running') return 'warn'
  return 'unknown'
}

export type StepScriptProgress = {
  caption: string
  barPct: number | null
  indeterminate: boolean
}

export function StepCard(props: {
  index: number
  title: string
  /** One-line subtitle (e.g. version / build info) persisted from last completed run; hidden while `running`. */
  versionSubtitle?: string | null
  /** When successfully completed: show “Installed”, “Verified”, … instead of plain “Done”. */
  completionChip?: CompletionChipKind
  message: string
  state: StepState
  /** Shown in the status chip while `running` (e.g. Installing). */
  runningStatusLabel?: string
  /** Thin indeterminate bar while running when no structured script progress is available. */
  showIndeterminateProgress?: boolean
  /** Script-reported progress (shown inside this step instead of a global bar). */
  scriptProgress?: StepScriptProgress | null
  children?: ReactNode
}) {
  const statusChipLabel = (() => {
    if (props.state === 'running' && props.runningStatusLabel) return props.runningStatusLabel
    if (props.state === 'error') return stateLabel('error')
    if (props.state === 'warning') return stateLabel('warning')
    if (props.state === 'success') {
      return completionChipKindToLabel(props.completionChip ?? null) ?? stateLabel('success')
    }
    return stateLabel(props.state)
  })()

  const tone = stateTone(props.state)
  const dot =
    tone === 'ok' ? 'ok' : tone === 'warn' ? 'warn' : tone === 'bad' ? 'bad' : 'unknown'
  return (
    <div className="step">
      <div className="step-index">{props.index}</div>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <span className={'dot ' + dot} />
          <strong style={{ fontSize: 14 }}>{props.title}</strong>
          <span className="muted" style={{ fontSize: 12 }}>{statusChipLabel}</span>
        </div>
        {props.state !== 'running' && props.versionSubtitle ? (
          <div
            className="muted"
            title={props.versionSubtitle}
            style={{
              fontSize: 12,
              marginBottom: 4,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            {props.versionSubtitle}
          </div>
        ) : null}
        <div className="muted" style={{ fontSize: 13 }}>
          {props.message}
        </div>
        {props.state === 'running' && props.scriptProgress ? (
          <>
            <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              {props.scriptProgress.caption}
            </div>
            <div
              className="progress-track"
              style={{ marginTop: 8 }}
              aria-label="Step script progress"
              role="progressbar"
            >
              {props.scriptProgress.indeterminate || props.scriptProgress.barPct === null ? (
                <div className="progress-fill--indeterminate" />
              ) : (
                <div
                  className="progress-fill--determinate"
                  style={{ width: `${Math.min(100, props.scriptProgress.barPct)}%` }}
                />
              )}
            </div>
          </>
        ) : props.showIndeterminateProgress && props.state === 'running' ? (
          <div className="step-progress" aria-label="In progress" role="progressbar" />
        ) : null}
        {props.children}
      </div>
    </div>
  )
}
