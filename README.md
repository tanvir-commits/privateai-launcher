# PrivateAI Launcher

PrivateAI Launcher turns a supported Windows NVIDIA PC into a private local AI server by orchestrating **Ollama**, **Open WebUI (Docker)**, and **ComfyUI**.

## Download (Windows)

- **Stable link (GitHub):** [Latest release](https://github.com/tanvir-commits/privateai-launcher/releases/latest) — pick **`PrivateAI-Launcher-*-windows-portable.zip`** to unzip and run, or **`*-Setup.exe`** for an installer.
- **Landing page:** **`https://tanvir-commits.github.io/privateai-launcher/download.html`** — includes a Dashboard screenshot (`docs/assets/`) and live links to the latest release assets. Built by [`pages.yml`](.github/workflows/pages.yml). If Pages was never turned on: **Settings → Pages → Source: GitHub Actions**, or `gh api --method POST repos/<owner>/<repo>/pages -f build_type=workflow`.
- **Ship a release from CI:** push a version tag, e.g. `git tag v1.1.0 && git push origin v1.1.0` — [Release Windows](.github/workflows/release-windows.yml) builds and uploads the zip and installer to that release.

Local build + zip: `npm run dist:win:zip` → `release/PrivateAI-Launcher-<version>-windows-portable.zip`.

## Requirements

- Windows 10 22H2+ or Windows 11
- Node.js 20+ and npm (for development)
- PowerShell 5.1+ (Windows built-in)

## Scripts

| Command | Purpose |
| --- | --- |
| `npm install` or `npm.cmd install` | Install dependencies |
| `npm run dev` or `npm.cmd run dev` | Run Electron in development |
| `node scripts/task.mjs dev` | Same as dev, **without** calling `npm.ps1` (use if PowerShell blocks scripts) |
| `npm run build` | Build renderer + main + preload |
| `npm run test` | Vitest unit/UI tests |
| `npm run test:ps` | PowerShell JSON contract smoke tests |
| `npm run test:all` | Typecheck + Vitest + PowerShell smoke |
| `node scripts/task.mjs test:all` | Same as test:all, no `npm.ps1` |
| `npm run icon:from-apng -- <file.apng> [out.ico]` | Build multi-size `app-icon.ico` from APNG/PNG (first frame; optional `--frame N` with **ffmpeg**) |

**Windows / PowerShell:** If `npm` fails with “running scripts is disabled”, either use **`npm.cmd`**, **`dev.bat`** in the repo root, or **`node scripts/task.mjs …`** above. This repo’s **`.vscode/settings.json`** defaults new terminals to **Command Prompt**, which avoids `npm.ps1`.

**VS Code / Cursor:** **Terminal → Run Task… → PrivateAI: Dev** runs `node scripts/task.mjs dev`.

## Security note

Local services may listen on localhost and optionally on your LAN. Do not expose ports directly to the public internet.

## Product spec

See `PRIVATEAI_LAUNCHER_CURSOR_SPEC.md` for the full v0.1 definition.
