import { useEffect, useState } from 'react'
import modelProfiles from '@config/model-profiles.json'
import { ActionButton } from '../components/ActionButton'

type ProfileFile = typeof modelProfiles

export default function Models() {
  const [profiles] = useState<ProfileFile['profiles']>(() => modelProfiles.profiles)

  useEffect(() => {
    // Reserved: refresh installed models via ollama / Comfy checks.
  }, [])

  return (
    <div>
      <h1 className="page-title">Models</h1>
      <p className="page-sub">Starter recommendations. Availability depends on Ollama tags and disk space.</p>

      <div className="stack">
        {profiles.map((p) => (
          <div key={p.id} className="card">
            <h3>{p.label}</h3>
            <p className="muted">{p.description}</p>
            <p className="muted">Ollama pull: {p.ollamaPull ?? '—'}</p>
            <p className="muted">Approx size: {p.approxSizeGb ?? '?'} GB</p>
            <div className="row-actions">
              <ActionButton
                variant="primary"
                disabled={!p.ollamaPull}
                onClick={() =>
                  p.ollamaPull &&
                  void window.privateai.runScript('download-models.ps1', { Model: p.ollamaPull })
                }
              >
                Pull via launcher script
              </ActionButton>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
