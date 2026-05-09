export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '—'
  const gb = bytes / 1024 ** 3
  if (gb >= 100) return `${Math.round(gb)} GB`
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  const mb = bytes / 1024 ** 2
  return `${Math.round(mb)} MB`
}

/** VRAM from script: `vramMb` is mebibytes (MiB) from nvidia-smi nounits. */
export function formatVramMiB(vramMb: number | null | undefined): string {
  if (vramMb == null || !Number.isFinite(vramMb) || vramMb <= 0) return 'Unknown'
  const gb = vramMb / 1024
  if (Math.abs(gb - Math.round(gb)) < 0.05) return `${Math.round(gb)} GB VRAM`
  return `${gb.toFixed(1)} GB VRAM`
}

export function formatPortEntry(
  ports: Record<string, { port?: number; free?: boolean }> | undefined,
  key: string
): { label: string; busy: boolean | null } {
  if (!ports || typeof ports !== 'object') return { label: '—', busy: null }
  const p = ports[key] as { port?: number; free?: boolean } | undefined
  if (!p || typeof p.port !== 'number') return { label: '—', busy: null }
  if (p.free === true) return { label: `Port ${p.port} (free)`, busy: false }
  if (p.free === false) return { label: `Port ${p.port} (in use)`, busy: true }
  return { label: `Port ${p.port}`, busy: null }
}
