/**
 * Run project tasks without invoking npm.ps1 (PowerShell execution policy friendly).
 * Usage: node scripts/task.mjs <command>
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.join(fileURLToPath(new URL('.', import.meta.url)), '..')

function die(code) {
  process.exit(code ?? 1)
}

function tsc(project) {
  const r = spawnSync(
    process.execPath,
    ['node_modules/typescript/lib/tsc.js', '--noEmit', '-p', project],
    { cwd: root, stdio: 'inherit', shell: false }
  )
  if (r.status !== 0) die(r.status ?? 1)
}

function typecheck() {
  tsc('tsconfig.json')
  tsc('tsconfig.node.json')
}

function electronVite(sub) {
  const r = spawnSync(process.execPath, ['node_modules/electron-vite/bin/electron-vite.js', sub], {
    cwd: root,
    stdio: 'inherit',
    shell: false
  })
  die(r.status ?? 0)
}

function vitestRun() {
  return spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run'], {
    cwd: root,
    stdio: 'inherit',
    shell: false
  }).status ?? 1
}

function testPsRun() {
  return spawnSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'scripts/windows/_run-all-smoke.ps1')],
    { cwd: root, stdio: 'inherit' }
  ).status ?? 1
}

function verifyScriptsParse() {
  return spawnSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'scripts/windows/_verify-scripts-parse.ps1')],
    { cwd: root, stdio: 'inherit' }
  ).status ?? 1
}

function vitest() {
  die(vitestRun())
}

function testPs() {
  die(testPsRun())
}

function testAll() {
  typecheck()
  if (verifyScriptsParse() !== 0) die(1)
  if (vitestRun() !== 0) die(1)
  die(testPsRun())
}

function playwrightTestRun() {
  return spawnSync(
    process.execPath,
    [path.join(root, 'node_modules/@playwright/test/cli.js'), 'test'],
    { cwd: root, stdio: 'inherit', shell: false }
  ).status ?? 1
}

function testE2e() {
  die(playwrightTestRun())
}

function testE2eCi() {
  const b = spawnSync(process.execPath, ['node_modules/electron-vite/bin/electron-vite.js', 'build'], {
    cwd: root,
    stdio: 'inherit',
    shell: false
  })
  if ((b.status ?? 1) !== 0) die(b.status ?? 1)
  die(playwrightTestRun())
}

const name = process.argv[2]

switch (name) {
  case 'dev':
    electronVite('dev')
    break
  case 'build':
    electronVite('build')
    break
  case 'preview':
    electronVite('preview')
    break
  case 'typecheck':
    typecheck()
    die(0)
    break
  case 'test':
    vitest()
    break
  case 'test:ps':
    testPs()
    break
  case 'verify-ps-parse':
    die(verifyScriptsParse())
    break
  case 'test:all':
    testAll()
    break
  default:
    console.error(`Unknown task: ${name ?? '(none)'}`)
    console.error(
      'Usage: node scripts/task.mjs <dev|build|preview|typecheck|test|verify-ps-parse|test:ps|test:all|test:e2e|test:e2e:ci>'
    )
    die(1)
}
