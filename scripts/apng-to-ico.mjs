/**
 * Build a Windows .ico from an APNG (or static PNG).
 * ICO is static — only one frame is embedded (default: first frame).
 *
 * Usage:
 *   node scripts/apng-to-ico.mjs <input.apng|png> [output.ico] [--frame N]
 *
 * Default output: resources/branding/app-icon.ico
 *
 * Prefers ffmpeg for APNG frames (reliable). Falls back to sharp (first frame when supported).
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import toIco from 'to-ico'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')

const rawArgs = process.argv.slice(2)
let frameIndex = 0
const args = []
for (let i = 0; i < rawArgs.length; i++) {
  if (rawArgs[i] === '--frame' && rawArgs[i + 1]) {
    frameIndex = Number.parseInt(rawArgs[i + 1], 10)
    if (Number.isNaN(frameIndex) || frameIndex < 0) {
      console.error('Invalid --frame value')
      process.exit(1)
    }
    i++
    continue
  }
  args.push(rawArgs[i])
}

const input = args[0]
const output = path.resolve(root, args[1] || 'resources/branding/app-icon.ico')

if (!input) {
  console.error(`Usage: node scripts/apng-to-ico.mjs <input.apng|png> [output.ico] [--frame N]

  ICO has no animation — one frame is embedded (default: first frame).
  With ffmpeg, --frame N selects the Nth frame (0-based).

  Examples:
    node scripts/apng-to-ico.mjs ./icons/app.apng
    node scripts/apng-to-ico.mjs ./icons/app.apng ./resources/branding/app-icon.ico
    npm run icon:from-apng -- ./icons/app.apng ./resources/branding/app-icon.ico --frame 2`)
  process.exit(1)
}

const inputAbs = path.resolve(process.cwd(), input)
if (!fs.existsSync(inputAbs)) {
  console.error('Input not found:', inputAbs)
  process.exit(1)
}

function extractWithFfmpeg(src, out, frame) {
  const vf = frame <= 0 ? 'null' : `select=eq(n\\,${frame})`
  const argv =
    frame <= 0
      ? ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-frames:v', '1', out]
      : ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-vf', vf, '-vframes', '1', out]
  const r = spawnSync('ffmpeg', argv, { encoding: 'utf8' })
  return r.status === 0 && fs.existsSync(out) && fs.statSync(out).size > 0
}

async function main() {
  const tmpPng = path.join(os.tmpdir(), `privateai-icon-frame-${Date.now()}.png`)

  let extracted = extractWithFfmpeg(inputAbs, tmpPng, frameIndex)
  if (!extracted) {
    try {
      await sharp(inputAbs, { animated: false, limitInputPixels: false }).png().toFile(tmpPng)
      extracted = true
    } catch (e) {
      console.error('Could not read image with sharp.', e.message || e)
      console.error('Tip: install ffmpeg (https://ffmpeg.org) for reliable APNG frame extraction, then re-run.')
      process.exit(1)
    }
  }

  const ICO_SIZES = [256, 48, 32, 16]
  const pngBuffers = await Promise.all(
    ICO_SIZES.map((size) =>
      sharp(tmpPng)
        .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer()
    )
  )

  const icoBuf = await toIco(pngBuffers)
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.writeFileSync(output, icoBuf)
  try {
    fs.unlinkSync(tmpPng)
  } catch {
    /* ignore */
  }

  console.log('Wrote', output, `(${ICO_SIZES.join(', ')} px layers)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
