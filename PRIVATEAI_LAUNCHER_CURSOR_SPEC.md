# PrivateAI Launcher — Cursor Build Spec

## Product Summary

Build **PrivateAI Launcher v0.1**, a Windows desktop control panel that turns a supported NVIDIA Windows PC into a private local AI server.

The app does **not** replace Open WebUI, Ollama, or ComfyUI. It wraps them into a guided appliance-like experience.

Core promise:

> Turn your Windows gaming PC into a private ChatGPT + image generator for every device in your house.

The MVP must be practical, constrained, and reliable. Do not overbuild.

---

## MVP Definition

PrivateAI Launcher v0.1 should:

1. Detect whether the PC is AI-ready.
2. Install or verify Ollama.
3. Install or verify Docker Desktop / WSL2 for Open WebUI.
4. Install or verify Open WebUI.
5. Install or verify ComfyUI.
6. Download recommended starter models.
7. Configure Open WebUI to talk to Ollama.
8. Configure Open WebUI image generation through ComfyUI.
9. Show local desktop URL.
10. Show LAN phone URL.
11. Run health checks.
12. Provide repair buttons for common failures.

---

## Non-Goals For v0.1

Do **not** build these yet:

- Custom ChatGPT-style UI
- Custom model runtime
- Custom Linux distro
- Bootable ISO
- AMD GPU support
- Intel GPU support
- macOS support
- Linux support
- Multi-GPU support
- Agent marketplace
- Voice assistant
- RAG/document search
- Cloud sync
- Enterprise auth
- Paid billing
- Remote internet access outside home network
- Automatic port forwarding
- Kubernetes
- Any custom AI model training

The MVP is an installer/control panel, not a full AI platform.

---

## Supported v0.1 Matrix

### Required

- Windows 10 22H2 or newer, or Windows 11
- NVIDIA GPU
- Recommended: 8 GB VRAM minimum
- Recommended: 16 GB system RAM minimum
- Recommended: 100 GB free disk space minimum
- Internet connection during install

### Strongly Recommended

- 12 GB+ VRAM for best image-generation experience
- 32 GB system RAM
- SSD storage

### Unsupported For v0.1

- AMD GPU full image stack
- Intel GPU full image stack
- CPU-only image generation
- Windows S Mode
- Locked-down corporate laptops
- Systems without admin permission

---

## User-Facing Positioning

Use plain language.

Good:

> Your private AI server is ready.

> Open this on your phone while connected to the same Wi-Fi.

> Your GPU is good for chat and image generation.

Bad:

> Docker backend container failed because host networking blah blah.

Instead, show:

> Open WebUI could not reach Ollama. Click Repair to fix the local connection.

---

## Recommended Tech Stack

Use the simplest stack that lets us ship quickly.

### Desktop App

Use **Electron + React + TypeScript**.

Reason:

- Easy Windows desktop packaging
- Easy process spawning
- Easy PowerShell integration
- Easy local dashboard UI
- Cursor can build it fast
- No need for Rust/Tauri complexity in MVP

### Installer / Orchestration

Use:

- Node.js backend inside Electron main process
- PowerShell scripts under `scripts/windows/`
- JSON status files under app data
- Child process calls with structured stdout/stderr

### External Components

Use existing tools:

- Ollama native Windows app
- Docker Desktop / WSL2 for Open WebUI
- Open WebUI Docker container
- ComfyUI Desktop or ComfyUI Portable

Prefer stable and boring.

---

## High-Level Architecture

```text
PrivateAI Launcher Electron App
│
├── React UI
│   ├── Home
│   ├── Hardware Doctor
│   ├── Install Wizard
│   ├── Models
│   ├── Services
│   └── Troubleshooting
│
├── Electron Main Process
│   ├── Hardware detection
│   ├── Script runner
│   ├── Service manager
│   ├── Port checker
│   ├── LAN IP detector
│   └── Health checks
│
├── PowerShell Scripts
│   ├── check-system.ps1
│   ├── check-gpu.ps1
│   ├── check-ollama.ps1
│   ├── install-ollama.ps1
│   ├── check-docker.ps1
│   ├── install-openwebui.ps1
│   ├── check-comfyui.ps1
│   ├── install-comfyui.ps1
│   ├── download-models.ps1
│   ├── configure-openwebui.ps1
│   ├── configure-comfyui.ps1
│   └── health-check.ps1
│
└── Managed Services
    ├── Ollama        http://localhost:11434
    ├── Open WebUI   http://localhost:3000
    └── ComfyUI      http://localhost:8188
```

---

## Repo Structure

Create this structure:

```text
privateai-launcher/
│
├── README.md
├── package.json
├── tsconfig.json
├── electron-builder.json
├── .gitignore
│
├── src/
│   ├── main/
│   │   ├── index.ts
│   │   ├── ipc.ts
│   │   ├── scriptRunner.ts
│   │   ├── hardware.ts
│   │   ├── services.ts
│   │   ├── ports.ts
│   │   ├── lan.ts
│   │   └── health.ts
│   │
│   ├── preload/
│   │   └── index.ts
│   │
│   └── renderer/
│       ├── App.tsx
│       ├── main.tsx
│       ├── styles.css
│       ├── components/
│       │   ├── StatusCard.tsx
│       │   ├── StepCard.tsx
│       │   ├── LogPanel.tsx
│       │   ├── ActionButton.tsx
│       │   └── UrlCard.tsx
│       │
│       └── pages/
│           ├── Home.tsx
│           ├── HardwareDoctor.tsx
│           ├── InstallWizard.tsx
│           ├── Models.tsx
│           ├── Services.tsx
│           └── Troubleshooting.tsx
│
├── scripts/
│   └── windows/
│       ├── check-system.ps1
│       ├── check-gpu.ps1
│       ├── check-ollama.ps1
│       ├── install-ollama.ps1
│       ├── check-docker.ps1
│       ├── install-openwebui.ps1
│       ├── check-comfyui.ps1
│       ├── install-comfyui.ps1
│       ├── download-models.ps1
│       ├── configure-openwebui.ps1
│       ├── configure-comfyui.ps1
│       ├── health-check.ps1
│       └── repair.ps1
│
├── workflows/
│   └── comfyui/
│       ├── txt2img_flux_schnell_api.json
│       └── img2img_basic_api.json
│
├── config/
│   ├── model-profiles.json
│   ├── supported-hardware.json
│   └── ports.json
│
└── docs/
    ├── MVP.md
    ├── TROUBLESHOOTING.md
    └── INSTALL_FLOW.md
```

---

## UX Pages

### 1. Home

Purpose: show overall system state.

Display cards:

- PC Readiness
- Ollama status
- Open WebUI status
- ComfyUI status
- Chat URL
- Phone URL
- Last health check result

Buttons:

- Run Health Check
- Open Chat UI
- Open ComfyUI
- Repair Setup

Example:

```text
PrivateAI Launcher

Status: Ready

Local Chat:
http://localhost:3000

Phone / LAN:
http://192.168.1.52:3000
```

---

### 2. Hardware Doctor

Purpose: determine if machine is supported.

Detect:

- Windows version
- CPU name
- system RAM
- NVIDIA GPU name
- VRAM
- NVIDIA driver version
- disk free space
- WSL installed
- Docker installed
- required ports available

Output example:

```text
GPU: NVIDIA RTX 3060
VRAM: 12 GB
Driver: OK
RAM: 32 GB
Disk: 420 GB free
Windows: Windows 11

AI readiness: Recommended

This PC can run:
✅ Local chat
✅ Image feedback
✅ Image generation
⚠️ Video generation not recommended
```

Readiness tiers:

```text
Unsupported:
- no NVIDIA GPU
- Windows too old
- less than 8 GB RAM

Basic:
- NVIDIA GPU with 6-8 GB VRAM
- chat OK
- vision OK
- image generation limited

Recommended:
- NVIDIA GPU with 10-12 GB VRAM
- chat OK
- vision OK
- image generation OK

Creator:
- NVIDIA GPU with 16 GB+ VRAM
- higher quality image workflows OK

Pro:
- NVIDIA GPU with 24 GB+ VRAM
- heavy workflows OK
```

---

### 3. Install Wizard

Purpose: guided install.

Steps:

1. Check system
2. Install/verify Ollama
3. Install/verify Docker/WSL2
4. Install/verify Open WebUI
5. Install/verify ComfyUI
6. Download text model
7. Download vision model
8. Download image model
9. Configure Open WebUI
10. Configure ComfyUI workflow
11. Run health check
12. Show final URLs

Each step needs:

- status: pending/running/success/warning/error
- readable message
- details/log expand button
- repair/retry button

---

### 4. Models

Purpose: show installed/recommended models.

For v0.1, hardcode safe recommendations.

Recommended starter models:

```text
Text model:
- qwen2.5:7b or llama3.1:8b-class model through Ollama

Vision/image feedback:
- qwen2.5vl:7b through Ollama if available
- fallback: qwen2.5vl:3b-class model if low VRAM/RAM

Image generation:
- FLUX.1 Schnell FP8 workflow for 12GB+ VRAM
- SDXL fallback workflow for 8GB VRAM
```

Important:

- Do not assume every model name is always available.
- Implement model config through `config/model-profiles.json`.
- The UI should show model download sizes when known.
- Always check disk space before model download.

---

### 5. Services

Purpose: manage local services.

Show:

- Ollama: running/stopped/error
- Open WebUI: running/stopped/error
- ComfyUI: running/stopped/error

Actions:

- Start
- Stop
- Restart
- Open Logs
- Repair

---

### 6. Troubleshooting

Purpose: human-readable repair actions.

Common failures:

```text
Ollama not reachable
Open WebUI not reachable
Open WebUI cannot reach Ollama
ComfyUI not reachable
Image generation disabled
Image model missing
Image workflow missing
Port 3000 busy
Port 8188 busy
Docker Desktop not running
WSL2 missing
NVIDIA driver missing/outdated
Disk space too low
```

Each failure should have:

- plain-English explanation
- detected cause
- one-click repair if possible
- manual instructions if repair is not possible

---

## PowerShell Script Requirements

All scripts must:

1. Be idempotent.
2. Return structured JSON to stdout.
3. Avoid destructive actions.
4. Use clear exit codes.
5. Log detailed output to a log file.
6. Never silently reboot the machine.
7. Ask the app to show a reboot-required message when needed.

Standard JSON response format:

```json
{
  "ok": true,
  "status": "success",
  "message": "Ollama is running",
  "details": {
    "version": "...",
    "url": "http://localhost:11434"
  },
  "warnings": [],
  "errors": []
}
```

For failure:

```json
{
  "ok": false,
  "status": "error",
  "message": "Docker Desktop is not installed",
  "details": {},
  "warnings": [],
  "errors": [
    {
      "code": "DOCKER_NOT_FOUND",
      "message": "Docker Desktop was not detected"
    }
  ]
}
```

---

## Hardware Detection Details

### Windows Version

Use PowerShell:

```powershell
Get-ComputerInfo | Select-Object WindowsProductName, WindowsVersion, OsBuildNumber
```

### RAM

```powershell
Get-CimInstance Win32_ComputerSystem | Select-Object TotalPhysicalMemory
```

### Disk Space

```powershell
Get-PSDrive -PSProvider FileSystem
```

### NVIDIA GPU

Try in this order:

1. `nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader`
2. WMI fallback:

```powershell
Get-CimInstance Win32_VideoController | Select-Object Name, AdapterRAM, DriverVersion
```

Prefer `nvidia-smi` when available because WMI VRAM reporting can be wrong.

---

## Ports

Default ports:

```json
{
  "ollama": 11434,
  "openWebui": 3000,
  "comfyui": 8188
}
```

Before install, check if ports are available.

If a port is busy:

- Show which process owns it if possible.
- Offer to use an alternate port.
- Do not kill processes automatically.

PowerShell port check example:

```powershell
Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue
```

---

## Open WebUI Install Strategy

Use Docker container for v0.1.

The launcher should:

1. Check Docker Desktop installed.
2. Check Docker Desktop running.
3. Check WSL2 backend availability.
4. Pull Open WebUI image.
5. Create persistent volume.
6. Run Open WebUI on port 3000.
7. Configure it to reach Ollama.

Important Docker networking issue:

Inside Docker, `localhost` points to the container, not the Windows host. Use `host.docker.internal` where needed.

Open WebUI should reach Ollama at something like:

```text
http://host.docker.internal:11434
```

Container command should include the right environment variables and host mapping where appropriate.

Do not hardcode blindly. Put this in a helper that can be changed.

---

## Ollama Strategy

Use native Windows Ollama.

The launcher should:

1. Check if `ollama` command exists.
2. Check if `http://localhost:11434/api/tags` responds.
3. If missing, install Ollama or prompt user to install.
4. Allow model storage folder selection.
5. Set `OLLAMA_MODELS` if the user chooses a custom folder.
6. Restart Ollama after changing model folder.
7. Pull starter text/vision models.

Health check:

```powershell
Invoke-WebRequest -Uri "http://localhost:11434/api/tags" -UseBasicParsing
```

---

## ComfyUI Strategy

Use ComfyUI Desktop or Portable for v0.1.

The launcher should:

1. Detect if ComfyUI is installed.
2. If not, guide install.
3. Ensure ComfyUI is launched with network accessibility for Open WebUI.
4. Confirm `http://localhost:8188` responds.
5. Install/copy known-good workflow files.
6. Ensure required model files exist.
7. Configure Open WebUI image generation settings.

Important:

Open WebUI image generation should use **API-format ComfyUI workflows**, not normal ComfyUI workflow exports.

Ship known-good workflow files under:

```text
workflows/comfyui/
```

Do not support arbitrary custom workflows in v0.1.

---

## Image Generation v0.1 Scope

Support only:

1. Text-to-image
2. Basic image-to-image / edit if stable

Do not support:

- video generation
- ControlNet
- LoRA marketplace
- custom node installer
- arbitrary ComfyUI graph editing
- face swap
- NSFW generation features

Starter modes:

```text
Fast Image Mode:
- 512x512 or 768x768
- low steps
- optimized for 8GB-12GB VRAM

Quality Image Mode:
- 1024x1024
- more steps
- for 12GB+ VRAM
```

---

## Phone Access v0.1

Only support LAN phone access.

Show:

```text
Open this from another device on the same Wi-Fi:
http://<LAN_IP>:3000
```

Do not expose the service to the public internet.

Do not automatically open router ports.

Optional later:

- Tailscale
- Cloudflare Tunnel
- reverse proxy
- HTTPS

But not v0.1.

---

## Security Requirements

Because this app starts local services, be careful.

v0.1 rules:

1. Bind services to local/LAN only.
2. Do not expose to public internet.
3. Warn user before enabling LAN access.
4. Show which ports are open.
5. Do not store passwords in plaintext.
6. Do not collect telemetry by default.
7. Do not auto-update external components without user consent.
8. Show logs locally.

Add a security warning on first launch:

```text
PrivateAI Launcher runs local AI services on your computer. LAN access lets other devices on your Wi-Fi reach the chat UI. Do not expose this directly to the public internet.
```

---

## Repair System

The repair system is the product moat.

Implement `repair.ps1` with repair actions by code.

Repair codes:

```text
OLLAMA_NOT_RUNNING
OLLAMA_API_DOWN
DOCKER_NOT_INSTALLED
DOCKER_NOT_RUNNING
WSL2_MISSING
OPENWEBUI_CONTAINER_MISSING
OPENWEBUI_CONTAINER_STOPPED
OPENWEBUI_CANNOT_REACH_OLLAMA
COMFYUI_NOT_RUNNING
COMFYUI_PORT_BLOCKED
IMAGE_GENERATION_DISABLED
IMAGE_MODEL_MISSING
IMAGE_WORKFLOW_MISSING
PORT_BUSY
DISK_SPACE_LOW
NVIDIA_DRIVER_MISSING
```

Example UI:

```text
Problem:
Open WebUI cannot reach Ollama.

Likely cause:
Open WebUI is running inside Docker and cannot access localhost on the Windows host.

Repair:
Update Open WebUI backend URL to http://host.docker.internal:11434 and restart the container.

[Repair]
```

---

## Install Flow Details

### Step 1 — System Scan

- Run `check-system.ps1`
- Run `check-gpu.ps1`
- Run port checks
- Generate readiness result

### Step 2 — User Chooses Storage

Ask user where to store models.

Default:

```text
%USERPROFILE%\.privateai\models
```

Warn if disk space is low.

### Step 3 — Install Ollama

- Check native install
- Install if missing
- Start/restart
- Verify API

### Step 4 — Install Docker/Open WebUI

- Check Docker Desktop
- If missing, show install button
- Pull Open WebUI image
- Run container
- Verify URL

### Step 5 — Install ComfyUI

- Prefer guided install path
- Verify URL
- Verify model path
- Copy workflow templates

### Step 6 — Download Models

- Text model
- Vision model
- Image model

### Step 7 — Configure Integrations

- Open WebUI to Ollama
- Open WebUI image engine to ComfyUI
- ComfyUI workflow/model selection

### Step 8 — Health Test

Run:

1. Ollama API check
2. Simple text completion
3. Open WebUI HTTP check
4. ComfyUI HTTP check
5. Image generation smoke test if image model exists

### Step 9 — Done Screen

Show:

- desktop URL
- phone URL
- service status
- next action

---

## Health Checks

Implement health checks in `src/main/health.ts` and `scripts/windows/health-check.ps1`.

Health check output:

```json
{
  "ollama": {
    "running": true,
    "url": "http://localhost:11434",
    "models": ["qwen2.5:7b"]
  },
  "openWebui": {
    "running": true,
    "url": "http://localhost:3000"
  },
  "comfyui": {
    "running": true,
    "url": "http://localhost:8188"
  },
  "phoneAccess": {
    "lanIp": "192.168.1.52",
    "url": "http://192.168.1.52:3000"
  },
  "issues": []
}
```

---

## UI Style Direction

Make it look polished and dark by default.

Design feel:

- Dark mode
- Simple cards
- Green/yellow/red status indicators
- Minimal technical jargon
- Big “Install AI Stack” button
- Clean progress timeline
- Logs hidden behind expandable details

Do not make it look like an admin console from 2008.

Use copy like:

```text
Ready
Needs attention
Repair available
Unsupported
Recommended
```

---

## First Demo Goal

The first real demo should show:

1. Launch app.
2. It detects RTX GPU and readiness.
3. Click install.
4. App installs/verifies stack.
5. Opens Open WebUI.
6. User chats locally.
7. User uploads image and gets feedback.
8. User generates image.
9. User opens same UI from phone using LAN URL.

This demo is the viral video.

---

## Acceptance Criteria

v0.1 is acceptable when:

- App launches on Windows.
- Hardware Doctor detects NVIDIA GPU and VRAM.
- App detects unsupported machines gracefully.
- Ollama install/check works.
- Open WebUI install/check works.
- ComfyUI install/check works or guided setup works.
- Health check accurately reports running/stopped/error.
- LAN URL is shown correctly.
- Repair buttons exist for top 5 failures.
- Logs are viewable.
- No destructive actions happen without confirmation.

Top 5 repair failures for v0.1:

1. Ollama not running
2. Open WebUI container stopped/missing
3. Open WebUI cannot reach Ollama
4. ComfyUI not running
5. Port busy

---

## Implementation Order For Cursor

Build in this exact order.

### Phase 1 — Skeleton App

- Create Electron + React + TypeScript app.
- Create Home, Hardware Doctor, Install Wizard, Services pages.
- Add fake/mock status data first.
- Add basic dark UI.

### Phase 2 — Script Runner

- Implement `scriptRunner.ts`.
- It should run PowerShell scripts and parse JSON stdout.
- Show script logs in UI.

### Phase 3 — Hardware Doctor

- Implement `check-system.ps1`.
- Implement `check-gpu.ps1`.
- Display real hardware scan results.

### Phase 4 — Ollama

- Implement Ollama check.
- Implement Ollama API health check.
- Add model pull button.

### Phase 5 — Open WebUI

- Check Docker Desktop.
- Create Open WebUI container.
- Verify web URL.
- Show local URL and LAN URL.

### Phase 6 — ComfyUI

- Detect ComfyUI.
- Start/check ComfyUI URL.
- Add image backend status.

### Phase 7 — Repair

- Implement repair action codes.
- Add repair buttons.
- Add better errors.

### Phase 8 — Polish

- Add loading states.
- Add logs.
- Add clear copy.
- Add packaging.

---

## Coding Style

- TypeScript strict mode.
- Keep modules small.
- No giant files.
- All PowerShell scripts output JSON.
- Prefer boring reliable code over clever abstractions.
- Every external process call must have timeout handling.
- Every script must have clear error messages.
- Every install step must be resumable.

---

## Cursor Instructions

When implementing this project:

1. Start by creating the repo structure.
2. Build a working Electron + React skeleton.
3. Add mock data for all pages.
4. Then implement real PowerShell script calls one at a time.
5. Do not implement unsupported features.
6. Do not create a custom AI chat UI.
7. Do not replace Open WebUI.
8. Do not add cloud services.
9. Do not add account login.
10. Keep v0.1 focused on Windows + NVIDIA.

Before writing large code changes, create a short implementation plan.

After each phase, update `docs/MVP.md` with what works and what remains.

---

## Suggested README Copy

```md
# PrivateAI Launcher

PrivateAI Launcher turns a supported Windows NVIDIA PC into a private local AI server.

It installs and manages:

- Ollama for local language and vision models
- Open WebUI for the ChatGPT-like interface
- ComfyUI for local image generation

The goal is to make local AI feel like an appliance instead of a weekend Linux project.

## v0.1 Support

- Windows 10 22H2+ / Windows 11
- NVIDIA GPU recommended
- 8GB+ VRAM recommended
- LAN-only phone access

## Not Supported Yet

- AMD GPU full image stack
- Intel GPU full image stack
- macOS
- Linux
- public internet hosting
- custom workflows
```

---

## Final Product Rule

If the user has to learn Docker networking, ComfyUI workflow formats, or Ollama environment variables, the product failed.

The app should detect, configure, test, and repair everything it reasonably can.

Keep the MVP small enough to actually ship.
