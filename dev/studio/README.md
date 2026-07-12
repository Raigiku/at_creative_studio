# Creative Studio

A small local web app for generating images and video via OpenRouter.

## What it does

- Pick a generation type (text→image, image→image, text→video, image→video)
- Write a prompt (and optionally upload reference images)
- Pick a model
- Click **Generate**. The output appears in the browser and is saved into `ai_outputs/`.

## Where outputs go

Every generation is saved as a self-describing file in `ai_outputs/`:

```
ai_outputs/
  2026-07-11T143022Z_image_gemini-2.5-flash-image.png
  2026-07-11T143055Z_image_flux.2-pro.jpg
  2026-07-11T144200Z_video_seedance-1.0-pro.mp4
```

The user is responsible for moving these files wherever they need them
(into `creative_projects/start/assets/...`, etc.).

You can override the output directory by setting the `AI_OUTPUTS_DIR`
environment variable.

## Models

The list of models shown in the dropdown is read from a YAML file so you
can add or remove entries without recompiling. The file lives at
`<binaryDir>/models.yaml` (next to `studio.exe`), and the path can be
overridden with the `STUDIO_MODELS` environment variable.

On first run, if no `models.yaml` exists, the server writes one with the
default curated list. Edit it, restart, and your changes show up in the
UI.

```yaml
image:
  - id: "x-ai/grok-imagine-image-quality"
    name: "Grok Imagine (Image) — quality"

video:
  - id: "bytedance/seedance-2.0"
    name: "Seedance 2.0 — video"
  - id: "google/veo-3.1-lite"
    name: "Veo 3.1 Lite — video"
```

Each entry needs an `id` (the OpenRouter model identifier). `name` is
optional and defaults to the id. Comments and blank lines are allowed.
Entries with an empty `id` are skipped with a warning at startup.

## How to run

1. Make sure Go 1.25+ is installed: <https://go.dev/dl/>
2. Store your OpenRouter API key once. The recommended way is the OS
   credential manager — the key is encrypted by the OS and never written
   to a file:

   ```bat
   scripts\set-key.bat
   ```
   ```bash
   ./scripts/set-key.sh
   ```

   You'll be prompted for the key (input is hidden). It gets saved under
   `service=creative-studio`, `user=openrouter-api-key` in the OS credential
   manager (Windows Credential Manager, macOS Keychain, or Linux Secret
   Service). The script also accepts the key as an argument:

   ```bat
   scripts\set-key.bat sk-or-v1-xxxxxxxxxxxxxxxx
   ```
   ```bash
   ./scripts/set-key.sh sk-or-v1-xxxxxxxxxxxxxxxx
   ```

   If you'd rather use an environment variable (CI, containers, one-off
   runs), set `OPENROUTER_API_KEY` instead. The env var always wins when
   set, even if a key is also in the credential manager.

3. Launch the server:

   - **Windows:** double-click `start-studio.bat` (or run `studio.exe`
     directly). The launcher does a pre-flight check and tells you
     clearly if no key is available.
   - **macOS / Linux:** run `./start-studio.sh` (or `./studio` directly
     after building). Same pre-flight check, opens the browser with
     `open` / `xdg-open`.

A browser window will open to <http://localhost:7878>. To stop the server, close
the terminal window or press `Ctrl+C` in it.

## Managing the stored key

The credential-management scripts in `scripts/` use **native OS tools** —
no extra Go binary to install:

| Command (Windows)              | What it does                                                | Native tool              |
| ------------------------------ | ----------------------------------------------------------- | ------------------------ |
| `scripts\set-key.bat [key]`    | Store / replace the API key in the OS credential manager    | `cmdkey`                 |
| `scripts\clear-key.bat`        | Remove the stored key                                       | `cmdkey`                 |
| `scripts\where-is-the-key.bat` | Show which source the server will use (env or credential)   | `cmdkey` (pure stdlib)   |

The matching `.sh` scripts work on macOS (using `security`) and Linux
(using `secret-tool` — install `libsecret-tools` / `libsecret` if missing).

The `studio.exe` server itself has **no** credential subcommands — it
just reads the key on startup. This keeps the server binary small and
its job focused.

> **The scripts never print the key to stdout.** If you need to see the
> stored value, use the OS GUI: **Keychain Access** on macOS (under the
> `creative-studio` item), or **Control Panel → Credential Manager →
> Windows Credentials** on Windows. This is by design — a script that
> dumps the secret to the terminal would defeat the point of storing it
> in the OS vault.

## File layout

```
dev/studio/
├── main.go                 ← the Go server
├── models.yaml             ← editable list of models shown in the UI
├── static/
│   ├── index.html          ← the form
│   └── app.js              ← the frontend (vanilla JS)
├── scripts/                ← one-shot credential-management scripts
│   │                         (use native OS tools: cmdkey / security / secret-tool)
│   ├── set-key.bat / .sh
│   ├── clear-key.bat / .sh
│   └── where-is-the-key.bat / .sh
├── go.mod                  ← uses the local SDK via a replace directive
├── start-studio.bat / .sh  ← double-click / run to build & start
└── README.md               ← this file
```

The OpenRouter Go SDK is referenced from `../lib_references/go-sdk-v0_5_16/`
(via a `replace` directive in `go.mod`) so you don't need internet to build.
The `zalando/go-keyring` library provides the cross-platform OS credential
manager wrapper.
