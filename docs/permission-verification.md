# Permission and UI verification

## Permission contract

Startup and Check Access only read macOS permission state. They never enumerate screens or start a recording. Allow Microphone is the explicit first-use request; concurrent clicks share one request. Previously denied microphone access opens the corresponding System Settings page. Screen/audio access is configured manually in macOS Settings; real capture is reserved for Play and explicit screen actions.

Clarity has no Dock entry. Native dialogs temporarily take foreground ownership through the shared coordinator. Command-Shift-/ returns from external Settings, and the permission card has a direct Clarity Settings action. Permission-window focus counts as Clarity focus. The permission window is an ordinary frameless window, avoiding the macOS nonactivating-panel focus failure.

## Evidence from this audit

- 237 automated tests passed, including passive startup, one microphone prompt for simultaneous clicks, denied/granted handling, native focus restoration, asynchronous capture cleanup, local STT lifecycle, streaming cancellation, history geometry, and settings persistence.
- `node verify.js`, main/renderer/preload syntax checks, and `git diff --check` passed.
- Inspected the permission card with microphone not requested and screen access off. Check Access stayed usable without a recording prompt. All footer controls fit, with Restart left of Check Again and Continue.
- Inspected Keys, Audio, Profile, Interview Prep, Style, and Q&A in the installed app. Long forms scroll without shrinking controls; tabs and Done remain available.
- Verified the Clarity Settings action opens above the permission card; closing Settings restores the card.
- Verified the PDF/DOCX native file picker appears in front, and Cancel returns to the Profile tab without importing or changing text.
- Inspected onboarding permission content and its four actions; they fit the enlarged default window.
- Verified whisper.cpp 1.9.1 bundled runtime. The downloaded base.en model is absent after the user's earlier data deletion.

## Explicit limits and safe failure

The final state intentionally has all Clarity macOS grants reset for the user's setup test. No new grants are silently enabled. Continue stays disabled while required grants are missing; Check Access remains usable. A missing local model produces setup guidance, and no cloud audio fallback is used in Local mode.

This audit does not claim live transcription or provider-answer validation with the final revoked state. API keys and downloaded models were removed at the user's earlier request. Earlier session builds transcribed an audible fixture on both You and Them, but that evidence is not a new end-to-end test of this final permission state. Provider-backed Assist, What to Say, Solve Code, Follow-up, Recap, and Live Answer need configured credentials for live validation.

The computer-use tool explicitly blocked access to the macOS UserNotificationCenter app, so the native first-use permission sheet could not be fully inspected or clicked through by the agent. No workaround was used to grant permission. First-use approval is left for the user's test.

Native signing verification is ad-hoc signing, not Developer ID notarization. A public release still needs a stable signing identity and notarization. The repository is suitable for review, but these limitations prevent claiming an independently verified public release.

If a native dialog cannot be inspected, do not start a hidden capture or grant access through a workaround. Stop capture, preserve settings, record the affected step and observed state, and leave explicit recovery through Settings, Check Access, and Restart. Test TCC through Finder or `open /Applications/Clarity.app`; direct terminal execution can attribute privacy checks to a different responsible process.

## Latest defaults and reset verification

Save transcripts and Live Interview now default on; their Settings descriptions and README match. A persistence test verifies explicit opt-outs still survive reload. The installed app showed both toggles on after clearing settings. Help now displays passive screen/audio check feedback directly beneath its button, inside the tutorial; the revoked-state message and navigation buttons were visually verified together. Settings and cached profile were cleared again after testing, with existing downloaded models and saved transcript files preserved. All Clarity TCC permissions were reset again before the final normal launch.


## First-launch and Custom provider follow-up

Fresh users now see the tutorial without a competing permission window. Permission setup is available in tutorial step 2; the separate recovery window remains available at startup for returning users with missing grants. Verified the installed app opens on Welcome, advances to permission setup, and quits from the tutorial footer. The Quit Clarity button sits between Back and Next. A completely frozen renderer still requires macOS Force Quit.

Custom defaults are https://openrouter.ai/api/v1, fast model deepseek/deepseek-v4.1-flash, and smart model openai/gpt-5.6-sol. Legacy empty OpenRouter fields receive these defaults; configured endpoints and model choices are preserved. Model availability has not been verified with live credentials.

The user subsequently requested a complete reset, including downloaded models and transcript files. App user data and all Clarity TCC grants were cleared. Tutorial verification left onboarding incomplete and Clarity closed for the user's first launch.

## v0.2.3 dual-architecture downloads

At the user's request, v0.2.3 now includes manually attached Apple silicon and Intel ZIPs. Both are ad-hoc signed and not notarized. Both app and whisper-server architecture checks, bundle integrity checks, version checks, ZIP integrity checks, and whisper-server `--help` smoke tests passed on the build Mac. Packaged application source matches the release source. No interactive Intel-hardware capture test was performed. SHA-256 checksums accompany the downloads; these do not establish Gatekeeper approval.


## Audio source thumbnail follow-up

Play now enumerates display sources with zero-sized thumbnails, avoiding an unused preview capture while preserving permission gating and loopback audio. A regression test covers denied access and authorized source selection. All 238 tests pass.

In the installed Apple silicon app, local base.en transcription captured a spoken test phrase accurately on both Them (system audio) and You (microphone). The microphone transcript added a trailing music marker. Listening was stopped after the test.

After quitting, resetting Clarity's macOS permissions, and reopening normally, the permission window appeared with both inputs off. Check Access and Check Again responded, and Continue remained disabled. Settings and transcripts were preserved. The user confirmed the result works. These checks do not establish that macOS-owned recording dialogs can never recur. Published v0.2.3 downloads predate this follow-up change.
