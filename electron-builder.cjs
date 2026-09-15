/* electron-builder configuration.
 *
 * Moved out of package.json so signing can be chosen by the environment rather
 * than hardcoded.
 *
 *   • Signed + notarized — set MAC_SIGN=1 with a "Developer ID Application"
 *     identity reachable in the keychain (or CSC_LINK in CI), plus
 *     APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID. electron-builder
 *     signs with the hardened runtime, notarizes, and staples. The app then
 *     opens on the first double-click with no warning at all.
 *
 *   • Ad-hoc fallback (no cert) — identity:null prevents electron-builder from
 *     looking for a Developer ID, then scripts/after-pack.js applies a real
 *     ad-hoc signature after all bundled resources are present. It is still not
 *     notarized for public distribution, but the local .app has a valid bundle
 *     signature and passes `codesign --verify`.
 */

// Gated on an explicit flag rather than on CSC_LINK: a bare .p12 carries only
// the leaf certificate, and signing with an incomplete chain fails in a way
// that looks like a wrong password.
const hasCert = process.env.MAC_SIGN === "1";
const canNotarize =
  hasCert &&
  !!process.env.APPLE_ID &&
  !!process.env.APPLE_APP_SPECIFIC_PASSWORD &&
  !!process.env.APPLE_TEAM_ID;

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: "com.clarity.overlay",
  productName: "Clarity",
  asar: true,
  publish: null,
  artifactName: "${productName}-${version}-${os}-${arch}.${ext}",
  // An allowlist, so anything new has to be added here or it simply is not in
  // the shipped app — and the only symptom is a require() that throws at
  // launch, in a build that ran fine from source.
  files: ["main.js", "preload.js", "preload-permissions.js", "src/**/*", "renderer/**/*", "vendor/**/*"],
  directories: { buildResources: "build-resources" },
  beforePack: () => require("./scripts/prepare-renderer").prepareRenderer(),
  afterPack: "scripts/after-pack.js",
  mac: {
    target: [{ target: "zip", arch: ["x64", "arm64"] }],
    icon: "build-resources/icon.icns",
    category: "public.app-category.productivity",
    // With a real cert, let electron-builder discover it and apply the hardened
    // runtime (notarization is refused without it). Without one, identity:null
    // skips electron-builder signing; afterPack supplies the ad-hoc signature.
    identity: hasCert ? undefined : null,
    hardenedRuntime: hasCert,
    gatekeeperAssess: false,
    entitlements: "build-resources/entitlements.mac.plist",
    entitlementsInherit: "build-resources/entitlements.mac.plist",
    // electron-builder 26 wants a boolean; the credentials come from
    // APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID in the env.
    notarize: canNotarize,
    extendInfo: {
      LSUIElement: true,
      NSMicrophoneUsageDescription:
        "Clarity transcribes your microphone so it can help you in conversations.",
      NSCameraUsageDescription: "Clarity does not use the camera.",
      NSAudioCaptureUsageDescription:
        "Clarity captures system audio to transcribe the other participant in a call.",
    },
  },
  win: {
    target: [{ target: "nsis", arch: ["x64"] }],
    artifactName: "${productName}-win-${arch}.${ext}",
  },
  // A per-user install with a visible directory step: Clarity is a personal overlay,
  // not a machine-wide service, so it should never need an elevation prompt.
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    shortcutName: "Clarity",
  },
  linux: {
    target: [{ target: "AppImage", arch: ["x64", "arm64"] }],
    category: "Utility",
  },
};
