# ScamScope

Paste a suspicious SMS, WhatsApp message or email into a local web page. A small AI
model (Qwen3 1.7B, quantized) runs **entirely on your machine** via the
[QVAC SDK](https://github.com/tetherto/qvac) and streams back a verdict card:

- **Verdict** - SCAM, SUSPICIOUS or LIKELY LEGIT, with a confidence level
- **Manipulation tactics** it is using (urgency, authority impersonation, payment-rail red flags, OTP requests...)
- **Why** - the specific lines in your message that triggered the verdict
- **Do NOT** - the risky actions to avoid right now
- **Safer next step** - the *official* channel to verify through, instead of the link or number in the message

Everything is scanned by a model on your own hardware. The text you paste is never
uploaded anywhere: no API key, no usage bill, no cloud, no telemetry. After the
one-time model download, ScamScope keeps working even with your Wi-Fi switched off.

## Why on-device matters for this app

The messages people most want a second opinion on are also the most sensitive ones -
bank warnings, tax threats, blackmail attempts, "verify your identity" texts. Sending
those to a cloud AI service defeats the purpose. ScamScope runs the analyst on
your device, so the embarrassing or dangerous message never leaves your laptop.

## How it uses the QVAC SDK
**Dependencies :" @qvac/sdk": "^0.19.1" **
All inference happens on-device through `@qvac/sdk`:

- `loadModel` - loads Qwen3 1.7B (Q4) into the local QVAC worker; downloads the
  model on first run with progress events
- `completion` - streams the analysis token by token (temperature 0 for consistent verdicts)
- `cancel` - cancels an in-flight analysis if you close the page mid-scan
- `unloadModel` + `close` - frees RAM and shuts the worker down cleanly on Ctrl+C

There is no other AI dependency and no network call from the app itself. The model
file is the only thing ever downloaded, once, from the QVAC model registry.


## Requirements

- Node.js 22.17 or newer, npm 10.9 or newer
- Windows: Vulkan 1.4 runtime is required by the QVAC worker even for CPU-only
  inference (macOS 14+ / Ubuntu 22+ / any modern Linux also work)

## Install

```bash
npm install
```

This installs a single runtime dependency: `@qvac/sdk` (version 0.19.1), Tether's
open-source on-device AI SDK. The QVAC worker ships inside the package.

## Run

```bash
npm start
```

Then open **http://127.0.0.1:8787** in your browser.

The first analysis triggers a one-time download of the Qwen3 1.7B model
(roughly 1.1 GB). Progress is shown in the UI. Every analysis after that starts
instantly and works completely offline - you can verify this by disconnecting
your network and running another scan.

Press CTRL+C in terminal to stop.

## Try it

Click one of the sample-message chips (delivery-fee scam, bank OTP scam, prize
scam, a normal neighbourhood message) or paste your own suspicious message, then
press **Analyze on-device**. The verdict card streams in token by token while the
model thinks.


## Project structure

```
server.mjs    Node HTTP server (127.0.0.1 only): static UI + streaming /analyze endpoint
shield.mjs    QVAC SDK wrapper: model lifecycle, prompt, streaming completion
index.html    Single-page UI: paste box, streaming verdict card
```

## Privacy

- The server binds to 127.0.0.1 only - nothing is reachable from your network
- Message text goes from the browser to the local process in memory; it is never
  written to disk and never sent over the network
- The only download is the open-weight model file on first run

## Troubleshooting

- **"Port is already in use" on startup** - another ScamScope instance is
  still running. Stop it, or start on a different port: `PORT=8890 npm start`
  in bash, or `$ENV:PORT=8890; npm start` in PowerShell.
- **Windows: worker fails to start** - the QVAC worker needs the Vulkan 1.4
  runtime even for CPU-only inference. Update your GPU driver or install the
  Vulkan runtime, then try again.
- **First analysis stalls on "Downloading model"** - the 1.1 GB model download
  only happens once and is resumable; give it a few minutes on a slow
  connection and restart if interrupted.
- **RPC init timeout on the very first run after install** - antivirus software
  sometimes slows the first worker start while it scans new binaries. Re-run
  npm start; the second start is fast.


## Disclaimer

ScamScope is an educational demo of on-device AI. Verdicts come from a 1.7B-parameter
model and can be wrong. Always verify through official channels; this tool is not
legal, financial or security advice.

## License

MIT - see [LICENSE](LICENSE).
