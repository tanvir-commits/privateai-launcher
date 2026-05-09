import { ActionButton } from './ActionButton'

export function UrlCard(props: { title: string; url: string }) {
  return (
    <div className="card">
      <h3>{props.title}</h3>
      <p className="muted" style={{ wordBreak: 'break-all' }}>
        {props.url || '—'}
      </p>
      <div className="row-actions">
        <ActionButton
          variant="primary"
          disabled={!props.url}
          onClick={() => props.url && void window.privateai.openExternal(props.url)}
        >
          Open
        </ActionButton>
        <ActionButton
          variant="ghost"
          disabled={!props.url}
          onClick={() => props.url && void navigator.clipboard.writeText(props.url)}
        >
          Copy
        </ActionButton>
      </div>
    </div>
  )
}
