# MVP status (PrivateAI Launcher v0.1)

Last updated: implementation bootstrap in-repo.

## Working

- Electron + React + TypeScript app shell with dark UI and all primary routes.
- IPC bridge (`window.privateai`) for status, hardware scan, health, script execution, repairs, and opening URLs.
- PowerShell script runner with timeouts and JSON stdout parsing (`src/shared`, `src/main/scriptRunner.ts`).
- Windows scripts under `scripts/windows/` implementing checks, health aggregation, guided-install helpers, model pull, and repair stubs. Automated smoke validates JSON shape via `npm run test:ps`.
- `install-openwebui.ps1` creates/starts a Docker container with `OLLAMA_BASE_URL` pointing at `host.docker.internal` (not included in automated smoke to avoid unintended Docker pulls).

## Remaining / next

- Harden Open WebUI container naming, updates, and admin settings (image backend to ComfyUI).
- Real ComfyUI lifecycle (Desktop vs portable) and workflow/model validation beyond placeholders in `workflows/comfyui/`.
- Richer repair implementations and ownership detection for `PORT_BUSY`.
- Packaging QA on a clean machine (`npm run build` + installer).
