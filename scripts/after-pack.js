const path = require('path');
const { execFileSync } = require('child_process');
const { Arch } = require('builder-util');
const { prepareWhisperRuntime } = require('./prepare-whisper-runtime');

/** Add the matching native runtime after Electron has assembled each target.
 *
 * Local transcription is a user-facing feature, so production packages need
 * the matching whisper.cpp sidecar. Set CLARITY_BUNDLE_WHISPER=0 only for a
 * deliberately slim development package. The preparation script caches the
 * pinned runtime per platform/architecture, so normal rebuilds reuse it.
 */
module.exports = async function afterPack(context) {
  const platform = context.packager.platform.nodeName;
  const architecture = typeof context.arch === 'number' ? Arch[context.arch] : context.arch;
  if (!platform || !architecture) throw new Error('electron-builder did not provide a runtime target.');

  if (process.env.CLARITY_BUNDLE_WHISPER === '0') {
    console.log('[Clarity] Skipping the bundled whisper runtime because CLARITY_BUNDLE_WHISPER=0.');
  } else {
    const resourcesDirectory = context.packager.getResourcesDir(context.appOutDir);
    const outputDirectory = path.join(resourcesDirectory, 'whisper-runtime');
    await prepareWhisperRuntime({ platform, architecture, outputDirectory });
  }

  // `mac.identity = null` tells electron-builder to skip signing entirely; it
  // does not create an ad-hoc bundle signature. Electron's executable still
  // carries a linker signature in that case, which makes `codesign --verify`
  // reject the assembled .app because its resources are unsealed. Apply a real
  // ad-hoc signature after all resources (including whisper.cpp) are present.
  // Developer ID builds skip this because electron-builder signs/notarizes them
  // after the afterPack hook finishes.
  if (platform === 'darwin' && process.env.MAC_SIGN !== '1') {
    const productFilename = context.packager.appInfo.productFilename;
    const appBundle = path.join(context.appOutDir, `${productFilename}.app`);
    execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', appBundle], {
      stdio: 'inherit',
    });
    console.log(`[Clarity] Ad-hoc signed ${appBundle}`);
  }
};
