import { describe, expect, it } from 'vitest'
import {
  emptyWizardInstallState,
  sanitizeWizardInstallState,
  wizardStepVersionSubtitle
} from './wizardInstallPersist'
import type { ScriptResult } from './scriptContract'

const okResult = (details: Record<string, unknown>): ScriptResult => ({
  ok: true,
  status: 'success',
  message: 'ok',
  details,
  warnings: [],
  errors: []
})

describe('sanitizeWizardInstallState', () => {
  it('returns empty when schema is wrong', () => {
    expect(sanitizeWizardInstallState({ schemaVersion: 999, core: { x: {} } })).toEqual(
      emptyWizardInstallState()
    )
  })

  it('loads valid snapshots', () => {
    const s = sanitizeWizardInstallState({
      schemaVersion: 1,
      core: {
        docker: {
          state: 'success',
          message: 'ok',
          version: '28.5.1',
          recordedAt: '2026-05-08T12:00:00.000Z'
        }
      },
      optional: {},
      portableComfy: null
    })
    expect(s.core.docker?.message).toBe('ok')
    expect(s.portableComfy).toBeNull()
  })

  it('parses portable with variant', () => {
    const s = sanitizeWizardInstallState({
      schemaVersion: 1,
      core: {},
      optional: {},
      portableComfy: {
        state: 'success',
        message: 'done',
        version: 'http://localhost:8188',
        variant: 'nvidia_cu126',
        recordedAt: '2026-05-08T12:00:00.000Z'
      }
    })
    expect(s.portableComfy?.variant).toBe('nvidia_cu126')
    expect(s.portableComfy?.version).toBe('http://localhost:8188')
  })
})

describe('wizardStepVersionSubtitle', () => {
  it('reads docker serverVersion', () => {
    expect(
      wizardStepVersionSubtitle('docker', okResult({ serverVersion: '27.3.1' }))
    ).toBe('27.3.1')
  })

  it('shortens open-webui image ref', () => {
    const sub = wizardStepVersionSubtitle(
      'openwebui',
      okResult({ containerImage: 'ghcr.io/open-webui/open-webui:v0.6.30' })
    )
    expect(sub).toContain('open-webui:v0.6.30')
  })

  it('honors wizard ollama-missing success', () => {
    const r: ScriptResult = {
      ok: false,
      status: 'error',
      message: 'missing',
      details: {},
      warnings: [],
      errors: [{ code: 'OLLAMA_NOT_FOUND', message: 'x' }]
    }
    expect(wizardStepVersionSubtitle('ollama-check', r, { wizardOllamaMissingOnly: true })).toBe(
      undefined
    )
  })

  it('honors wizard gpu-missing subtitle from readiness label', () => {
    const r: ScriptResult = {
      ok: false,
      status: 'error',
      message: 'No NVIDIA',
      details: { readinessLabel: 'Unsupported: no NVIDIA GPU detected.' },
      warnings: [],
      errors: [{ code: 'NVIDIA_NOT_FOUND', message: 'x' }]
    }
    expect(wizardStepVersionSubtitle('gpu', r, { wizardGpuMissingOnly: true })).toContain('NVIDIA')
  })

  it('reads ollamaVersion', () => {
    expect(
      wizardStepVersionSubtitle('ollama', okResult({ ollamaVersion: 'ollama version is 1.2.3' }))
    ).toBe('ollama version is 1.2.3')
  })
})
