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

## How to run

1. Make sure Go 1.25+ is installed: <https://go.dev/dl/>
2. Edit `start-studio.bat` and replace `sk-or-v1-PUT-YOUR-KEY-HERE` with your
   OpenRouter API key. (Or set `OPENROUTER_API_KEY` in your Windows environment.)
3. Double-click `start-studio.bat`.

A browser window will open to <http://localhost:7878>. To stop the server, close
the terminal window or press `Ctrl+C` in it.

## File layout

```
dev/studio/
├── main.go               ← the Go server
├── static/
│   ├── index.html        ← the form
│   └── app.js            ← the frontend (vanilla JS)
├── go.mod                ← uses the local SDK via a replace directive
├── start-studio.bat      ← double-click to build & run
└── README.md             ← this file
```

The OpenRouter Go SDK is referenced from `../lib_references/go-sdk-v0_5_16/`
(via a `replace` directive in `go.mod`) so you don't need internet to build.
