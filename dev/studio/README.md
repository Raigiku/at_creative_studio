# Creative Studio

A small local web app for generating images and video via OpenRouter.

## What it does

- Pick a kind (image or video)
- Pick a model from the dropdown
- Write a prompt and adjust the per-model options (size, aspect, etc.)
- Optionally attach reference images — the form automatically switches
  to image-to-image / image-to-video mode
- Optionally pick a first/last frame anchor for video (separate from
  references)
- Click **Generate**. The output appears in the browser and is saved
  into `ai_outputs/`.

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

## Capabilities

Each model's per-field support (which aspect ratios, sizes, audio
toggles, frame anchors, etc. are accepted) is fetched from the
`/api/models/{id}` endpoint and used to dim / disable unsupported
options in the form. The form's values are clamped to the model's
advertised ranges whenever the model changes.

## How to run

1. Make sure Go 1.25+ is installed: <https://go.dev/dl/>
2. Store your OpenRouter API key once. The recommended way is a plain
   dotenv file in the directory **above** the repo — it lives outside
   the project tree, can be shared with sibling repos, and never gets
   accidentally committed:

   ```bat
   scripts\env-file.bat
   ```
   ```bash
   ./scripts/env-file.sh
   ```

   You'll be prompted for the key (input is hidden). It gets written to
   `<parent-of-repo>\.ai-creative-studio.env`. For the bundled repo
   that is `c:\custom\projects\.ai-creative-studio.env` (Windows) or
   `~/path/to/parent/.ai-creative-studio.env` (macOS / Linux). The
   script also accepts the key as an argument:

   ```bat
   scripts\env-file.bat sk-or-v1-xxxxxxxxxxxxxxxx
   ```
   ```bash
   ./scripts/env-file.sh sk-or-v1-xxxxxxxxxxxxxxxx
   ```

   The file looks like:

   ```dotenv
   OPENROUTER_API_KEY=sk-or-v1-xxxxxxxxxxxxxxxx
   ```

   You can also edit the file by hand in any text editor.

   If you'd rather use an environment variable (CI, containers, one-off
   runs), set `OPENROUTER_API_KEY` instead. The env var always wins when
   set, even if a key is also in the .env file.

3. Launch the server. From the **repo root**, run:

   ```bash
   go run run.go
   ```

   The `run.go` launcher (which uses a `//go:build ignore` tag, so it
   stays out of the `dev/studio` package's own build) shells out to
   `go run .` inside `dev/studio/`. The `//go:embed` for `static/`
   means frontend edits are picked up automatically — no manual build
   step. Cross-platform: works on Windows, macOS, and Linux identically.

A browser window to <http://localhost:7878> will be reachable after the
server prints `Creative Studio listening on...`. To stop the server,
press `Ctrl+C` in the terminal.

## Managing the stored key

| Command                       | What it does                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| `scripts\env-file.bat [key]`  | Create / update `<parent-of-repo>\.ai-creative-studio.env` with the API key (input hidden)  |
| `./scripts/env-file.sh [key]` | Same, on macOS / Linux                                                                      |

The `studio.exe` server itself has **no** credential subcommands — it
just reads the env var or .env file on startup. This keeps the server
binary small and its job focused.

> **Security note:** the `.ai-creative-studio.env` file is plain text.
> The filename starts with a dot so it's already covered by the
> repo's `.gitignore` (`*.env*`). Keep it that way — do not commit
> your key.

## File layout

```
dev/studio/
├── main.go                 ← server entry point
├── handler.go              ← HTTP routes
├── credentials.go          ← reads OPENROUTER_API_KEY
├── models.go               ← loads models.yaml
├── capabilities.go         ← /api/models/{id}
├── generate_image.go       ← image generation
├── generate_video.go       ← video generation
├── storage.go              ← saves outputs to ai_outputs/
├── params.go               ← request param plumbing
├── config.go               ← env-driven config (ports, paths, ...)
├── errors.go               ← shared error types
├── models.yaml             ← editable list of models shown in the UI
├── static/                 ← embedded into the binary at build time
│   ├── index.html          ← the form
│   ├── app.js              ← Preact entry point (mounts <App/>)
│   ├── state.js            ← shared studio state (context)
│   ├── capabilities.js     ← pure capability helpers
│   ├── fieldConfig.js      ← static field definitions / limits
│   ├── submit.js           ← owns the status bar; submit handler
│   ├── api.js, sort.js, helpers.js, status.js
│   ├── styles.css
│   └── components/         ← one file per UI concern
│       ├── App.js          ← top-level form
│       ├── Kind.js, Model.js, Aspect.js
│       ├── ImageOptions.js, VideoOptions.js
│       ├── Frames.js, References.js
│       ├── Advanced.js, CapHint.js, Submit.js, Status.js
│       └── capFields.js    ← shared CapSelect / CapNumberInput / CapCheckbox
├── scripts/                ← one-shot helper scripts
│   └── env-file.bat / .sh
├── go.mod                  ← uses the local SDK via a replace directive
├── start-studio.bat / .sh  ← double-click / run to build & start
└── README.md               ← this file
```

The frontend is Preact + `htm` loaded via an import map from
`https://esm.sh` — no JS build step. `static/index.html` defines the
import map and `<script type="module" src="app.js">` boots Preact into
`#root`. Each `<script type="module">` in `static/` is a separate
concern: state, capabilities, per-field components, the submit handler,
etc. `app.js` is just the entry point — it imports the top-level
`<App/>` and mounts it.

The OpenRouter Go SDK is referenced from `../lib_references/go-sdk-v0_5_16/`
(via a `replace` directive in `go.mod`) so you don't need internet to build.
