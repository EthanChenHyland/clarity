# Clarity

Clarity is an open-source macOS AI overlay for screen assistance, conversation transcription, and suggested responses. Bring your own AI provider credentials and choose local or cloud speech-to-text.

**Current target: Apple silicon Macs and Intel Macs.** Separate arm64 and x64 builds are available. Intel hardware has not received the same interactive testing as Apple silicon. System-audio capture targets macOS 14.4 or later. Windows and Linux are not validated release targets.

[Releases](https://github.com/EthanChenHyland/clarity/releases) · [Issues](https://github.com/EthanChenHyland/clarity/issues) · [Verification notes](docs/permission-verification.md)

## Release status

**v0.2.11 includes separate macOS builds and source archives.** Choose your Mac's chip under Apple menu → About This Mac:

| Mac | Download |
|---|---|
| Apple silicon (M-series) | [Clarity-0.2.11-mac-arm64.zip](https://github.com/EthanChenHyland/clarity/releases/download/v0.2.11/Clarity-0.2.11-mac-arm64.zip) |
| Intel | [Clarity-0.2.11-mac-x64.zip](https://github.com/EthanChenHyland/clarity/releases/download/v0.2.11/Clarity-0.2.11-mac-x64.zip) |

Unzip the matching download and move `Clarity.app` to Applications. Both builds are **ad-hoc signed, not Developer ID-signed or notarized**. macOS may block them on first launch; passing a signature integrity check does not imply Gatekeeper approval. The release includes `SHA256SUMS.txt` for download-integrity checks. Building from source remains available below.

Automated tests and installed-app onboarding checks pass. Live provider responses and end-to-end transcription with fresh macOS permissions still require testing with configured credentials and a downloaded speech model. See the [verification notes](docs/permission-verification.md) for the scope and remaining limitations.

## Features

| Feature | Purpose |
|---|---|
| Assist | Uses your screen and recent conversation to suggest help |
| What to Say | Drafts a response from the conversation |
| Solve Code | Uses a screenshot to explain and solve a coding problem |
| Follow-up / Recap | Suggests questions or summarizes the conversation |
| Fast / Smart | Switches between your configured answer models |
| Conversation History | Displays separate microphone (**You**) and system-audio (**Them**) transcripts |
| Live Interview | Automatically drafts answers to likely questions in finalized Them transcript turns |
| Profile and interview context | Adds résumé, job description, stories, and response preferences; supports PDF/DOCX text import |

Screen-share exclusion is **best-effort**. Some capture tools can include Clarity despite its content-protection setting. Test your actual sharing setup before relying on it. Use recording and assistance with the agreement of the people involved.

## Build and run

Prerequisites: Node.js 22.12 or later, npm, CMake, and Xcode command-line tools. Preparing the pinned whisper.cpp runtime downloads and builds its source.

```bash
git clone https://github.com/EthanChenHyland/clarity.git
cd clarity
npm ci
npm run prepare:whisper
npm start
```

To produce both macOS apps and ZIPs:

```bash
npm run dist:mac -- --arm64 --x64
```

Apple silicon output is `dist/mac-arm64/Clarity.app` and `dist/Clarity-0.2.11-mac-arm64.zip`; Intel output is `dist/mac/Clarity.app` and `dist/Clarity-0.2.11-mac-x64.zip`. Copy your locally built app to `/Applications` and launch it from Finder for permission testing. Launching the executable directly from a terminal can change which process macOS associates with privacy access.

The speech runtime is bundled during packaging; speech **models** are downloaded separately in Settings. No API keys or downloaded speech models are included in the release.

## First launch

The tutorial opens first. Its second step, **Allow Clarity to see & hear**, contains the permission controls. A separate permission-recovery window appears on later launches if onboarding is complete but access is missing.

1. **Microphone:** choose **Allow Microphone** to request access. If previously denied, this opens the relevant System Settings pane.
2. **Screen & System Audio Recording:** open the privacy pane from the tutorial and enable Clarity. If necessary, use **+** to add `/Applications/Clarity.app`. Return with `⌘⇧/`, then choose **Check Screen & Audio access**. Restart Clarity if its running process still reports old access status.
3. **Answer provider:** open **Settings → Keys**, choose a provider, and configure its credentials and models.
4. **Speech-to-text:** open **Settings → Audio**. Local is the default; `small.en` is the recommended local accuracy/speed balance for meetings. Download it before starting listening. Smaller models such as `base.en` use fewer resources but are less accurate on compressed or noisy meeting audio. Alternatively, configure a supported cloud transcription provider.

Permission checks are passive; startup does not start a recording to force a permission prompt. Actual capture begins through Play or a screen-based action. The system-audio path supplies a display source without Apple's source picker, but macOS may still present native recording confirmations.

Reopen the tutorial with **Help**. Its footer includes **Quit Clarity** between Back and Next. Clarity intentionally has no Dock icon.

## Providers and defaults

Answer-provider options include OpenAI, Anthropic, Gemini, Azure, Groq, MiniMax, Ollama, and Custom OpenAI-compatible endpoints. Provider credentials, capabilities, model availability, and billing are managed by the provider. A screen-based action needs a model that accepts image input.

For OpenRouter, select **Custom**. The fields default to:

| Field | Default |
|---|---|
| Base URL | `https://openrouter.ai/api/v1` |
| Fast model | `moonshotai/kimi-k3:nitro` |
| Smart model | `openai/gpt-5.6-sol` |

Enter your own OpenRouter API key. These are configured defaults, not a guarantee that either model is available to your account or supports screenshots. Replace them with supported model IDs as needed. Existing nonempty custom settings are preserved.

**Answer models and transcription are separate.** OpenRouter/Custom credentials do not configure speech-to-text. Audio options are Local whisper.cpp, Deepgram, OpenAI, Gemini, or Auto selection among configured speech providers. Local mode does not silently fall back to cloud transcription.

Two settings are **on by default**:

- **Save transcripts** in Audio writes finalized transcript text to `~/Documents/Clarity Transcripts`. Turning it off stops further archiving; it does not delete existing files.
- **Real-time answer suggestions** in Interview Prep automatically requests answers to detected questions. It requires working transcription and an answer provider; provider charges may apply. Turn it off to request answers manually.

## Controls

| Action | Default shortcut |
|---|---|
| Assist | `⌘↵` |
| What to Say | `⌘⇧↵` |
| Solve Code | `⌘H` |
| Follow-up | `⌘J` |
| Recap | `⌘K` |
| Settings | `⌘,` |
| Hide / show Clarity | `⌘⇧/` |
| Quit | `⌘⇧X` |
| Zoom in / out (Clarity focused) | `⌘+` / `⌘−` |
| Reset zoom to 100% | `⌘0` |

Settings → Audio → Save transcripts includes an Open Folder button that opens a native transcript browser. File browsers hide Clarity while open and restore it when dismissed, including model and PDF/DOCX imports.

Use Play / Stop in the toolbar to control listening. The History button opens the transcript sidecar. Global shortcuts may conflict with other applications; the visible controls remain available.

While AI is responding, the Send button becomes **Stop response**. Click it to cancel generation and keep the partial answer. Microphone and system-audio listening continue, and you can send another question immediately.

Zoom changes interface scale within the current window, from 60% to 170%; it does not change capture resolution. The same shortcuts are listed in Help and the first-run tutorial.

AI responses render Markdown headings, lists, tables, and code, plus LaTeX math using `$…$`, `$$…$$`, `\(…\)`, `\[…\]`, equation environments, and math/latex/tex code fences. Rendering updates during streaming. Unsupported LaTeX remains visible as source text. Math assets and fonts are bundled locally; rendering does not contact a CDN.

## Privacy and storage

Clarity does not require a Clarity account or hosted backend. It connects to the providers you configure and downloads speech runtime/model files when requested.

- Settings, API keys, and profile text are stored in `~/Library/Application Support/Clarity/clarity-data.json`. This is a plaintext file with owner-only permissions, **not Keychain storage**.
- Custom requests, including the Custom key, go to the configured Base URL.
- Screenshots, conversation text, and relevant profile context can be sent to the selected answer provider. Local transcription does not make cloud answer requests local.
- Local speech inference keeps audio on your computer. Cloud transcription sends audio to the selected speech provider; Auto can fall back among configured speech providers.
- Capture audio is processed in memory. Saved transcript text is written to Documents by default. Downloaded models remain under Clarity's user-data directory until deleted.
- The You/Them labels distinguish capture channels; they do not identify individual speakers within system audio.

## Troubleshooting

**Listening produces no transcript:** check the Audio provider, installed local model or cloud speech key, and both macOS permissions. An answer-provider key alone is insufficient.

**Access is enabled but Clarity reports it off:** verify that System Settings lists the installed copy, then restart Clarity. A rebuild can affect the identity macOS associates with previous grants.

**A recording dialog remains open:** do not start another capture request. Quit Clarity and handle the native macOS dialog. A stuck system-owned dialog is a known unresolved edge case; Clarity cannot guarantee it can dismiss it.

**Clarity freezes:** use the tutorial or toolbar Quit button if the interface still responds. If it is fully frozen, force quit the Clarity process in Activity Monitor. An in-app button cannot recover a blocked renderer.

**Local runtime is missing:** install CMake and Xcode command-line tools, run `npm run prepare:whisper`, and restart. Download the selected speech model separately in Audio settings.

**`npm start` reports `getPath` is undefined:** clear `ELECTRON_RUN_AS_NODE` from the shell environment and retry.

**A model request fails:** check the endpoint, credentials, model ID, permissions, and image-input support. Model defaults do not verify provider availability.

**A downloaded app is blocked by macOS:** the attached builds are ad-hoc signed and not notarized. Building locally is an alternative. Do not disable Gatekeeper globally; a checksum verifies file integrity, not Apple approval.

## Development and release checks

```bash
npm test
node verify.js
node --check main.js
node --check renderer/renderer.js
git diff --check
```

The current suite contains 256 tests. After packaging, verify bundle integrity:

```bash
codesign --verify --deep --strict dist/mac-arm64/Clarity.app
```

Developer ID signing uses `MAC_SIGN=1` with a suitable signing identity and notarization credentials. The tag-triggered release workflow builds Apple silicon and only uploads its ZIP when signing configuration is present. The ad-hoc macOS assets are manually built and attached. No certificate is configured in the local development environment.

The project uses Electron with plain HTML, CSS, and JavaScript: `main.js` owns windows and IPC, `renderer/` contains the UI and audio capture, and `src/` contains providers, transcription, storage, and supporting logic. Review the loopback compatibility configuration before upgrading Electron to 45 or later.

## License and dependencies

Local transcription uses [whisper.cpp](https://github.com/ggml-org/whisper.cpp), under the MIT License; its notice is included in packaged runtimes.

This project is licensed under [GPL-3.0-or-later](LICENSE).
