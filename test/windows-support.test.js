const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const builder = require('../electron-builder.cjs');
const pkg = require('../package.json');

test('defines a versioned Windows x64 installer target without implicit publishing', () => {
  assert.equal(pkg.scripts['pack:win'], 'electron-builder --win --dir --publish never');
  assert.equal(pkg.scripts['dist:win'], 'electron-builder --win --publish never');
  assert.deepEqual(builder.win.target, [{ target: 'nsis', arch: ['x64'] }]);
  assert.equal(builder.win.artifactName, '${productName}-${version}-win-${arch}.${ext}');
  assert.equal(builder.win.icon, 'build-resources/icon.ico');
  assert.ok(fs.existsSync(path.join(__dirname, '..', builder.win.icon)));
});

test('Windows app identity and settings links are explicit', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(main, /app\.setAppUserModelId\('com\.clarity\.overlay'\)/);
  assert.match(main, /ms-settings:privacy-\(\?:microphone\|screenrecorder\)/);
  assert.match(main, /privacy-screenrecorder\)\$\/i/);
  assert.match(main, /isWindows[\s\S]*getMediaAccessStatus\('microphone'\)/);
});

test('Windows whisper ZIP extraction uses argv-safe tar.exe instead of PowerShell command parsing', () => {
  const prepare = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'prepare-whisper-runtime.js'), 'utf8');
  assert.match(prepare, /execFileSync\('tar\.exe', \['-xf', archivePath, '-C', extractionDirectory\]/);
  assert.doesNotMatch(prepare, /Expand-Archive|powershell\.exe/);
});

test('tagged releases build and upload a Windows installer on a Windows runner', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '..', '.github/workflows/release.yml'), 'utf8');
  assert.match(workflow, /windows-release:[\s\S]*runs-on: windows-latest/);
  assert.match(workflow, /windows-release:[\s\S]*npm run dist:win/);
  assert.match(workflow, /windows-release:[\s\S]*dist\/\*\.exe/);
  assert.match(workflow, /clarity-windows-\$\{\{ github\.ref_name \}\}/);
});

test('tagged releases validate both macOS architectures and preserve packages', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '..', '.github/workflows/release.yml'), 'utf8');
  assert.match(workflow, /npm run dist:mac -- --arm64 --x64/);
  assert.match(workflow, /clarity-macos-\$\{\{ github\.ref_name \}\}/);
});

test('ships every runtime directory in packaged builds', () => {
  assert.ok(builder.files.includes('main.js'));
  assert.ok(builder.files.includes('preload.js'));
  assert.ok(builder.files.includes('src/**/*'));
  assert.ok(builder.files.includes('renderer/**/*'));
});
