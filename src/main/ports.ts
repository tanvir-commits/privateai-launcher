import fs from 'node:fs'
import { join } from 'node:path'
import { getConfigDir } from './paths'

export interface PortsConfig {
  ollama: number
  openWebui: number
  comfyui: number
}

const FALLBACK: PortsConfig = {
  ollama: 11434,
  openWebui: 3000,
  comfyui: 8188
}

export function readPortsConfig(): PortsConfig {
  try {
    const raw = fs.readFileSync(join(getConfigDir(), 'ports.json'), 'utf8')
    const parsed = JSON.parse(raw) as Partial<PortsConfig>
    return {
      ollama: typeof parsed.ollama === 'number' ? parsed.ollama : FALLBACK.ollama,
      openWebui: typeof parsed.openWebui === 'number' ? parsed.openWebui : FALLBACK.openWebui,
      comfyui: typeof parsed.comfyui === 'number' ? parsed.comfyui : FALLBACK.comfyui
    }
  } catch {
    return FALLBACK
  }
}
