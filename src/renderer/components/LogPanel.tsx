export function LogPanel(props: { text: string }) {
  return <pre className="log-panel">{props.text || '—'}</pre>
}
