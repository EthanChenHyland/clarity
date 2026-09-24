# Clarity

Clarity is an open-source desktop AI overlay for macOS and Windows with screen assistance, conversation transcription, and suggested responses. Bring your own AI provider credentials and choose local or cloud speech-to-text.

**Current target: Apple silicon Macs, Intel Macs, and Windows x64.** macOS system-audio capture targets macOS 14.4 or later. Windows packaging and the bundled local speech runtime are exercised on `windows-latest` in CI; Windows capture/audio behavior should still be field-tested on the exact conferencing setup you plan to use. Linux is not a validated release target.

[Releases](https://github.com/EthanChenHyland/clarity/releases) · [Issues](https://github.com/EthanChenHyland/clarity/issues) · [Verification notes](docs/permission-verification.md)

## Release status

**v0.2.15 includes separate macOS builds, a Windows x64 installer, and source archives.**

| Platform | Download |
|---|---|
| Apple silicon (M-series) | [Clarity-0.2.15-mac-arm64.zip](https://github.com/EthanChenHyland/clarity/releases/download/v0.2.15/Clarity-0.2.15-mac-arm64.zip) |
| Intel Mac | [Clarity-0.2.15-mac-x64.zip](https://github.com/EthanChenHyland/clarity/releases/download/v0.2.15/Clarity-0.2.15-mac-x64.zip) |
| Windows 10/11 x64 | [Clarity-0.2.15-win-x64.exe](https://github.com/EthanChenHyland/clarity/releases/download/v0.2.15/Clarity-0.2.15-win-x64.exe) |

On macOS, unzip the matching build and move `Clarity.app` to Applications. The Mac builds are **ad-hoc signed, not Developer ID-signed or notarized**, so Gatekeeper may warn on first launch. On Windows, run the x64 NSIS installer; the current Windows installer is **not Authenticode-signed**, so Microsoft Defender SmartScreen may warn before first launch. The release includes `SHA256SUMS.txt` for download-integrity checks.

Automated tests pass on supported Node versions, Windows packaging runs on `windows-latest`, and the Windows whisper.cpp runtime is downloaded, checksum-verified, launched, and smoke-tested in CI. Live provider responses plus end-to-end capture with real conferencing software still require field testing on each target OS. See the [verification notes](docs/permission-verification.md) for the current macOS permission scope and remaining limitations.

## Features

| Feature | Purpose |
|---|---|
| Assist | Uses your screen and recent conversation to suggest help |
| What to Say | Drafts a response from the conversation |
| Solve Code | Uses a screenshot to explain and solve a coding problem |
| Follow-up / Recap | Suggests questions or summarizes the conversation |
| Fast / Smart | Switches between your configured answer models |
| Conversation History | Displays separate microphone (**You**) and system-audio (**Them**) transcripts |
| Live Interview | Starts from stable streaming transcript context, cancels stale drafts, and can fall back from Fast to Smart when Fast stalls |
| Profile and interview context | Adds résumé, job description, stories, and response preferences; supports PDF/DOCX text import |

Screen-share exclusion is **best-effort**. Some capture tools can include Clarity despite its content-protection setting. Test your actual sharing setup before relying on it. Use recording and assistance with the agreement of the people involved.

## Build and run

Prerequisites: Node.js 22.12 or later and npm. macOS source builds of the pinned whisper.cpp runtime also require CMake and Xcode command-line tools; Windows uses the checksum-pinned upstream x64 runtime archive.

```bash
git clone https://github.com/EthanChenHyland/clarity.git
cd clarity
npm ci
npm run prepare:whisper
npm start
```

To produce release packages:

```bash
# macOS (run on a Mac)
npm run dist:mac -- --arm64 --x64

# Windows x64 (run on Windows; CI does this for tagged releases)
npm run dist:win
```

Apple silicon output is `dist/mac-arm64/Clarity.app` and `dist/Clarity-0.2.15-mac-arm64.zip`; Intel output is `dist/mac/Clarity.app` and `dist/Clarity-0.2.15-mac-x64.zip`; Windows output is `dist/Clarity-0.2.15-win-x64.exe`. For macOS permission testing, copy the local app to `/Applications` and launch it from Finder. On Windows, install with the NSIS package so the packaged executable and bundled runtime are tested together.

The speech runtime is bundled during packaging; speech **models** are downloaded separately in Settings. No API keys or downloaded speech models are included in the release.

## First launch

The tutorial opens first. Its second step, **Allow Clarity to see & hear**, contains platform-specific permission controls.

**macOS**
1. **Microphone:** choose **Allow Microphone**. If access was previously denied, Clarity opens the relevant System Settings pane.
2. **Screen & System Audio Recording:** enable Clarity in **System Settings → Privacy & Security → Screen & System Audio Recording**. Return with `⌘⇧/`, then choose **Check Screen & Audio access**; restart Clarity if macOS still reports stale access.

**Windows 10/11 x64**
1. Use **Open Microphone settings** and allow microphone access for desktop apps/Clarity.
2. Windows 11 also exposes **Screen recording** privacy settings from onboarding. On Windows 10, screen capture does not require that extra privacy toggle.
3. System audio uses Chromium loopback capture from the active display/output path. If the Them channel is silent, verify the active Windows output device and disable exclusive-mode use by other apps before retrying Play.

On both platforms, configure the answer provider under **Settings → Keys** and speech-to-text under **Settings → Audio**. Auto is the default low-latency path: it prefers Deepgram streaming, then OpenAI Realtime when those keys are configured. For private on-device transcription, choose Local and download `small.en`.

Permission checks are passive; startup does not start recording just to probe access. Actual capture begins through Play or a screen-based action. On macOS, Clarity supplies the display source without Apple's source picker; macOS may still present native recording confirmations.

Reopen the tutorial with **Help**. Its footer includes **Quit Clarity** between Back and Next. Clarity intentionally has no Dock icon on macOS and stays out of the Windows taskbar/Alt+Tab surface as an overlay.

## Providers and defaults

Answer-provider options include OpenAI, Anthropic, Gemini, Azure, Groq, MiniMax, Ollama, and Custom OpenAI-compatible endpoints. Provider credentials, capabilities, model availability, and billing are managed by the provider. A screen-based action needs a model that accepts image input.

For OpenRouter, select **Custom**. The fields default to:

| Field | Default |
|---|---|
| Base URL | `https://openrouter.ai/api/v1` |
| Fast model | `deepseek/deepseek-v4.1-flash:nitro` |
| Smart model | `openai/gpt-6-sol` |

Enter your own OpenRouter API key. These are configured defaults, not a guarantee that either model is available to your account or supports screenshots. Replace them with supported model IDs as needed. Existing nonempty custom settings are preserved.

**Answer models and transcription are separate.** OpenRouter/Custom credentials do not configure speech-to-text. Audio options are Local whisper.cpp, Deepgram, OpenAI, Gemini, or Auto selection among configured speech providers. Local mode does not silently fall back to cloud transcription.

## Connected knowledge

Settings → Profile can connect up to eight GitHub repositories as read-only knowledge sources. Public repositories need no token. Private repositories can use an optional fine-grained GitHub token with read-only **Contents** access.

Clarity indexes supported text/code files into a local cache and retrieves only the excerpts relevant to the current interview question. Retrieval is hybrid: BM25-style lexical ranking preserves exact code/file matches, while local semantic concept vectors rerank conceptually related implementation details even when the interviewer uses different wording. This semantic step is offline and adds no embedding API call or extra provider cost. Repository content is treated as untrusted reference data rather than instructions, so text inside a README, source comment, or prompt file cannot replace Clarity's system rules. The GitHub token is used only for repository access and is never inserted into model prompts.

Two settings are **on by default**:

- **Save transcripts** in Audio writes finalized transcript text to `~/Documents/Clarity Transcripts`. Turning it off stops further archiving; it does not delete existing files.
- **Real-time answer suggestions** in Interview Prep automatically requests answers to detected questions. It requires working transcription and an answer provider; provider charges may apply. Turn it off to request answers manually.

## Controls

| Action | macOS | Windows |
|---|---|---|
| Assist | `⌘↵` | `Ctrl+↵` |
| What to Say | `⌘⇧↵` | `Ctrl+Shift+↵` |
| Solve Code | `⌘H` | `Ctrl+H` |
| Follow-up | `⌘J` | `Ctrl+J` |
| Recap | `⌘K` | `Ctrl+K` |
| Settings | `⌘,` | `Ctrl+,` |
| Hide / show Clarity | `⌘⇧/` | `Ctrl+Shift+/` |
| Quit | `⌘⇧X` | `Ctrl+Shift+X` |
| Zoom in / out (Clarity focused) | `⌘+` / `⌘−` | `Ctrl+` / `Ctrl−` |
| Reset zoom to 100% | `⌘0` | `Ctrl+0` |

Settings → Audio → Save transcripts includes an Open Folder button that opens a native transcript browser. File browsers hide Clarity while open and restore it when dismissed, including model and PDF/DOCX imports.

Use Play / Stop in the toolbar to control listening. The History button opens the transcript sidecar. Global shortcuts may conflict with other applications; the visible controls remain available.

While AI is responding, the Send button becomes **Stop response**. Click it to cancel generation and keep the partial answer. Microphone and system-audio listening continue, and you can send another question immediately.

Zoom changes interface scale within the current window, from 60% to 170%; it does not change capture resolution. The same shortcuts are listed in Help and the first-run tutorial.

AI responses render Markdown headings, lists, tables, and code, plus LaTeX math using `$…$`, `$$…$$`, `\(…\)`, `\[…\]`, equation environments, and math/latex/tex code fences. Rendering updates during streaming. Unsupported LaTeX remains visible as source text. Math assets and fonts are bundled locally; rendering does not contact a CDN.

## Privacy and storage

Clarity does not require a Clarity account or hosted backend. It connects to the providers you configure and downloads speech runtime/model files when requested.

- Settings, API keys, and profile text are stored in Electron's per-user data directory (`~/Library/Application Support/Clarity/clarity-data.json` on macOS and `%APPDATA%\Clarity\clarity-data.json` on Windows). This is a plaintext file, **not Keychain/Credential Manager storage**. Clarity writes mode `0600` on POSIX systems; on Windows, access control comes from the user's profile/NTFS ACLs.
- Custom requests, including the Custom key, go to the configured Base URL.
- Screenshots, conversation text, and relevant profile context can be sent to the selected answer provider. Local transcription does not make cloud answer requests local.
- Local speech inference keeps audio on your computer. Cloud transcription sends audio to the selected speech provider; Auto can fall back among configured speech providers.
- Capture audio is processed in memory. Saved transcript text is written to Documents by default. Downloaded models remain under Clarity's user-data directory until deleted.
- The You/Them labels distinguish capture channels; they do not identify individual speakers within system audio.

## Troubleshooting

**Listening produces no transcript:** check the Audio provider, installed local model or cloud speech key, and the platform microphone/capture permissions. An answer-provider key alone is insufficient.

**macOS access is enabled but Clarity reports it off:** verify that System Settings lists the installed copy, then restart Clarity. A rebuild can affect the identity macOS associates with previous grants.

**A recording dialog remains open on macOS:** do not start another capture request. Quit Clarity and handle the native system dialog. A stuck system-owned dialog is a known unresolved edge case; Clarity cannot guarantee it can dismiss it.

**Clarity freezes:** use the tutorial or toolbar Quit button if the interface still responds. If it is fully frozen, force quit Clarity in Activity Monitor (macOS) or Task Manager (Windows). An in-app button cannot recover a blocked renderer.

**Local runtime is missing:** run `npm run prepare:whisper` and restart. macOS source preparation additionally requires CMake and Xcode command-line tools. Windows downloads the checksum-pinned x64 runtime archive. Download the selected speech model separately in Audio settings.

**`npm start` reports `getPath` is undefined:** clear `ELECTRON_RUN_AS_NODE` from the shell environment and retry.

**A model request fails:** check the endpoint, credentials, model ID, permissions, and image-input support. Model defaults do not verify provider availability.

**A downloaded app is blocked by macOS:** the attached Mac builds are ad-hoc signed and not notarized. Building locally is an alternative. Do not disable Gatekeeper globally; a checksum verifies file integrity, not Apple approval.

**Windows SmartScreen warns about the installer:** the current Windows installer is not Authenticode-signed. Verify its SHA-256 against `SHA256SUMS.txt` before choosing the Windows option to continue.

## Development and release checks

```bash
npm test
node verify.js
node --check main.js
node --check renderer/renderer.js
git diff --check
```

The current suite contains 276 tests. After packaging, verify the macOS bundle integrity:

```bash
codesign --verify --deep --strict dist/mac-arm64/Clarity.app
```

Developer ID signing uses `MAC_SIGN=1` with a suitable signing identity and notarization credentials. The tag-triggered workflow builds the Windows x64 NSIS installer on `windows-latest` and uploads it to the release. It also builds Apple silicon as a release check; macOS CI upload remains gated on complete signing/notarization credentials, so local ad-hoc Mac ZIPs are attached manually when no certificate is configured.

The project uses Electron with plain HTML, CSS, and JavaScript: `main.js` owns windows and IPC, `renderer/` contains the UI and audio capture, and `src/` contains providers, transcription, storage, and supporting logic. Review the loopback compatibility configuration before upgrading Electron to 45 or later.

## License and dependencies

Local transcription uses [whisper.cpp](https://github.com/ggml-org/whisper.cpp), under the MIT License; its notice is included in packaged runtimes.

This project is licensed under [GPL-3.0-or-later](LICENSE).
