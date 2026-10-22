# Testing Rocky on your Windows laptop

Work through the steps in order. When something fails, copy the output and send it to Claude, saying which step it was. Every step tells you what you should see.

Run the commands in **PowerShell**, in the Rocky folder.

---

## Step 0: Get the latest code

```powershell
git fetch origin
git checkout main-ndgkok
git pull origin main-ndgkok
npm install
```

## Step 1: One-time setup (skip any you already did)

| Check | Command | You should see |
|---|---|---|
| Node 20 or newer | `node -v` | `v20.x` or higher |
| Ollama is running | `ollama list` | a list of models (open the Ollama app if this fails) |
| Brain model | `ollama pull gemma3:4b` | `success` |
| Embedding model (memory + fast path) | `ollama pull nomic-embed-text` | `success` |
| Speech model (needs internet once) | `npm run models` | `Xenova/whisper-base.en: ready` |
| Rocky's voice | `powershell -ExecutionPolicy Bypass -File scripts\install_piper.ps1` | files in `bin\piper\` |
| Chrome or Edge installed | (nothing to run) | |

## Step 2: Automated tests (about 2 minutes)

```powershell
npm test
```

**Expected:** `20 of 20 test files passed.` On Windows nothing should be skipped:
- `smoke.mjs` should say **42 passed, 0 failed** (in the cloud 3 of them were skipped because they need Windows).
- `ocr_integration.mjs` should run real Windows OCR instead of saying "Skipped".

If any file says **FAIL**, send the FAIL lines.

## Step 3: Hardware checks

**3a. Monitors.** This moves your mouse pointer for a second.

```powershell
node scripts/check_displays.mjs
```

Expected: `DPI awareness: per-monitor-v2`, one line per monitor, each with `OK`, and finally `All monitors agree.` Send the whole output, even if it looks fine.

**3b. Fast-path tuning.** Ollama must be running.

```powershell
node scripts/calibrate_router.mjs
```

It prints distances and a suggested `ROCKY_ROUTER_MAX_DISTANCE`. Send the whole output and Claude will set the value.

**3c. Apps Rocky can see.**

```powershell
node scripts/list_apps.mjs spotify notepad chrome "vs code"
```

Expected: each name maps to the app you have installed. Anything wrong or `not found`: send it.

## Step 4: Use Rocky for real

Start him:

```powershell
npm run dev
```

**Keep this terminal open.** Its log (lines starting `[STT]`, `[Browser]`, `[SemanticRouter]`, `[AgentLoop]`) is what Claude needs when something goes wrong.

Tick these off. Say "Rocky" first each time.

**Voice**
- [ ] The status next to Rocky shows `Listening (whisper-base.en) - <your microphone's name>`
- [ ] "Rocky, what time is it?" gets an answer
- [ ] Plug in a headset (or change the default microphone in Windows sound settings). Within about 3 seconds Rocky says *"Grace… Rocky hears through … now"* and the status shows the new name
- [ ] Unplug it again: he switches back
- [ ] Sleep the laptop, wake it, and talk to him: he still hears you (this can take up to 15 seconds)

**Apps and clicks**
- [ ] "Open notepad": Notepad opens and comes to the front
- [ ] "Take a note": Notepad opens quickly. The log shows `[SemanticRouter] Fast path`, or `No fast path` until Step 3b is tuned
- [ ] "Close notepad": it closes. The log must NOT show a fast-path launch
- [ ] With Notepad open: "click File": the File menu opens

**Monitors (only with an external monitor)**
- [ ] "Move to the other monitor": Rocky walks over to it
- [ ] Put an app on the second monitor and ask Rocky to click something in it: the right spot is clicked

**Browser**
- [ ] "Open youtube.com": a Chrome window opens (Rocky's own; sign in there once if you like and he remembers it)
- [ ] "Search youtube for lo-fi music", then "play the first video"
- [ ] "Pause the video", "skip forward 30 seconds", "set the volume to 30 percent"
- [ ] Open another tab yourself, then say "pause the video": he finds the YouTube tab
- [ ] "List my tabs"
- [ ] Close Rocky's Chrome window, then "open google.com": he opens it again

**Downloads and uploads**
- [ ] Download any PDF ("download the PDF" on a page with a PDF link): it lands in your Downloads folder and he tells you the name
- [ ] Download the same file again: you get `name (1).pdf`; the first one is not replaced
- [ ] On a site with an upload button: "upload my resume" (or any file name on your Desktop or in Documents): the file is attached but NOT sent
- [ ] "Upload my .env file" or anything from `.ssh`: he refuses

**Memory and personality**
- [ ] "My brother's name is …", then later "what's my brother's name?"
- [ ] Rocky's mood changes over the session (he gets happier when things go well)

## Step 5: What to send Claude

1. Any `FAIL` lines from Step 2.
2. The full output of `check_displays.mjs` and `calibrate_router.mjs`.
3. For each unticked box: which one, what happened, and the terminal log from around that moment.

Useful switches while testing (set them in PowerShell before `npm run dev`):

```powershell
$env:ROCKY_VECTOR_ROUTER = "0"            # turn the fast path off
$env:ROCKY_ROUTER_MAX_DISTANCE = "0.15"   # loosen or tighten the fast path
$env:ROCKY_BROWSER_PATH = "C:\Path\To\chrome.exe"   # if Chrome is somewhere unusual
$env:ROCKY_STT_MODEL = "Xenova/whisper-small.en"    # better hearing, slower
```
