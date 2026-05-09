import type { ReactNode } from 'react'

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

export function StepCard(props: {
  index: number
  title: string
  message: string
  state: StepState
  children?: ReactNode
}) {
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
          <span className="muted" style={{ fontSize: 12 }}>
            {stateLabel(props.state)}
          </span>
        </div>
        <div className="muted" style={{ fontSize: 13 }}>
          {props.message}
        </div>
        {props.children}
      </div>
    </div>
  )
}
