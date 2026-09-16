const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('settings has toolbar, local, and global entry points', () => {
  const html = read('renderer/index.html');
  const renderer = read('renderer/renderer.js');
  const main = read('main.js');
  const preload = read('preload.js');

  assert.match(html, /id="toolbar-settings-btn"/);
  assert.match(renderer, /#toolbar-settings-btn[^\n]*addEventListener\('click', openSettings\)/);
  assert.match(renderer, /CommandOrControl|metaKey/);
  assert.match(main, /CommandOrControl\+,/);
  assert.match(main, /settings:open/);
  assert.match(preload, /settings:open/);
  assert.match(preload, /exposeInMainWorld\('clarity'/);
});

test('opening settings explicitly disables click-through', () => {
  const renderer = read('renderer/renderer.js');
  const openSettings = renderer.slice(renderer.indexOf('function openSettings('), renderer.indexOf('async function closeSettings()'));
  assert.match(openSettings, /setIgnore\(false\)/);
});

test('renderer starts interactive so the first click is not dropped', () => {
  const renderer = read('renderer/renderer.js');
  assert.match(renderer, /Start interactive[\s\S]*setIgnore\(false\)/);
});


test('answer viewport follows each newly generated response', () => {
  const renderer = read('renderer/renderer.js');
  assert.match(renderer, /activeResponseGroup = group/);
  assert.match(renderer, /scrollResponseIntoView\(group, 'smooth'\)/);
  assert.match(renderer, /function scheduleStreamScroll\(\)/);
  assert.match(renderer, /scheduleStreamScroll\(\);/);
});

test('all five assistant actions including recap stay on one row', () => {
  const html = read('renderer/index.html');
  const css = read('renderer/styles.css');
  const actionRow = css.slice(css.indexOf('#action-row {'), css.indexOf('.act {', css.indexOf('#action-row {')));
  const actionMarkup = html.slice(html.indexOf('<div id="action-row">'), html.indexOf('<div id="composer">'));
  assert.match(actionRow, /display:\s*grid/);
  assert.match(actionRow, /grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\)/);
  assert.equal((actionMarkup.match(/<button class="act"/g) || []).length, 5);
  assert.match(actionMarkup, />Recap</);
});

test('all assistant actions show their shortcuts and follow-up/recap are globally registered', () => {
  const html = read('renderer/index.html');
  const css = read('renderer/styles.css');
  const renderer = read('renderer/renderer.js');
  const main = read('main.js');
  const actionMarkup = html.slice(html.indexOf('<div id="action-row">'), html.indexOf('<div id="composer">'));
  for (const id of ['say', 'assist', 'leetcode', 'followup', 'recap']) {
    assert.match(actionMarkup, new RegExp(`id="${id}-shortcut-hint"`));
  }
  assert.match(css, /#action-row \.act \{[\s\S]*flex-direction:\s*column/);
  assert.match(css, /#action-row \.shortcut-hint \{[\s\S]*display:\s*block/);
  assert.match(renderer, /followupHintEl\.textContent = isWindows \? 'Ctrl\+J' : '⌘J'/);
  assert.match(renderer, /recapHintEl\.textContent = isWindows \? 'Ctrl\+K' : '⌘K'/);
  assert.match(main, /CommandOrControl\+J[\s\S]*runFeature\('followup'/);
  assert.match(main, /CommandOrControl\+K[\s\S]*runFeature\('recap'/);
  assert.match(renderer, /followupShortcut[\s\S]*<strong>Follow-up<\/strong>/);
  assert.match(renderer, /recapShortcut[\s\S]*<strong>Recap<\/strong>/);
});


test('quit button calls the exposed quit action and app enforces one instance', () => {
  const renderer = read('renderer/renderer.js');
  const main = read('main.js');
  assert.match(renderer, /#quit-btn[^\n]*addEventListener\('click', \(\) => clarity\.quit\(\)\)/);
  assert.match(main, /requestSingleInstanceLock\(\)/);
  assert.match(main, /second-instance/);
});

test('saved transcripts have an IPC bridge and an Open Saved control', () => {
  const html = read('renderer/index.html');
  const preload = read('preload.js');
  const main = read('main.js');
  assert.match(html, /id="open-transcripts-btn"/);
  assert.match(preload, /openTranscriptFolder/);
  assert.match(main, /transcript:open-folder/);
  assert.match(main, /Clarity Transcripts/);
});

test('transcript disk archiving defaults on and remains user-controlled', () => {
  const html = read('renderer/index.html');
  const renderer = read('renderer/renderer.js');
  const store = read('src/store.js');
  const main = read('main.js');
  assert.match(html, /id="save-transcripts-toggle"/);
  assert.match(store, /saveTranscripts:\s*true/);
  assert.match(renderer, /save-transcripts-toggle'\)\.checked = !!settings\.saveTranscripts/);
  assert.match(renderer, /settings\.saveTranscripts = !!\$\('#save-transcripts-toggle'\)\.checked/);
  assert.match(main, /!store\.getSettings\(\)\.saveTranscripts/);
});

test('unsupported system audio capture never leaves the startup latch set', () => {
  const renderer = read('renderer/renderer.js');
  const start = renderer.indexOf('async function startSystemAudio()');
  const end = renderer.indexOf('function stopSystemAudio()', start);
  const source = renderer.slice(start, end);
  const capabilityCheck = source.indexOf("typeof navigator.mediaDevices.getDisplayMedia !== 'function'");
  const latch = source.indexOf('sysStarting = true');
  assert.ok(capabilityCheck >= 0 && latch >= 0 && capabilityCheck < latch);
  assert.match(source, /finally\s*\{[\s\S]*?sysStarting = false;/);
});

test('window restore and screenshots follow the display containing Clarity', () => {
  const main = read('main.js');
  const screenSource = read('src/screen.js');
  assert.match(main, /screen\.getDisplayNearestPoint/);
  assert.match(main, /screen\.getDisplayMatching\(win\.getBounds\(\)\)\.id/);
  assert.match(screenSource, /captureScreenshot\(preferredDisplayId = null\)/);
  assert.match(screenSource, /screen\.getAllDisplays\(\)/);
  assert.match(screenSource, /String\(display\.id\) === String\(preferredDisplayId\)/);
});

test('screen-based actions do not summon a macOS screen permission prompt', () => {
  const main = read('main.js');
  const featureRunner = main.slice(main.indexOf('async function runFeature'), main.indexOf('// -------- IPC --------'));
  assert.match(featureRunner, /screenPermissionStatus = isMac \? systemPreferences\.getMediaAccessStatus\('screen'\) : 'granted'/);
  assert.match(featureRunner, /if \(isMac && screenPermissionStatus !== 'granted'\)[\s\S]*Screen & System Audio Recording permission is required/);
  assert.match(featureRunner, /imageDataUrl = await abortable\(captureScreenshot\(displayId\), streamController.signal\)/);
  assert.doesNotMatch(featureRunner, /withNativeUiYield\(capture\)/);
});

test('renderer sandbox and external navigation guards are enabled', () => {
  const main = read('main.js');
  assert.equal((main.match(/sandbox:\s*true/g) || []).length, 2);
  assert.equal((main.match(/setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/g) || []).length, 2);
  assert.match(main, /will-navigate/);
  assert.match(main, /isAllowedPaneUrl/);
  assert.match(main, /ms-settings:privacy-/);
  assert.match(main, /x-apple\\\.systempreferences/);
});


test('startup shows a real start message instead of the old demo answer', () => {
  const renderer = read('renderer/renderer.js');
  assert.match(renderer, /Ready when you are/);
  assert.match(renderer, /Press ▶ to start listening/);
  assert.doesNotMatch(renderer, /discounted cash flow model values a company/);
  assert.match(renderer, /showStartMessage\(\)/);
});

test('toolbar exposes help and a dedicated four-way drag handle', () => {
  const html = read('renderer/index.html');
  const renderer = read('renderer/renderer.js');
  const icons = read('renderer/icons.js');
  const css = read('renderer/styles.css');

  assert.match(html, /id="logo-btn" title="Help" aria-label="Help"/);
  assert.match(html, /class="drag-icon"/);
  assert.match(renderer, /#logo-btn'\)\.innerHTML = icon\('circle-help'/);
  assert.match(renderer, /\.drag-icon'\)\.innerHTML = icon\('move'/);
  assert.match(renderer, /#logo-btn[^\n]*addEventListener\('click', showOnboard\)/);
  assert.match(icons, /move:.*M12 2v20/);
  assert.match(css, /\.drag-pill[\s\S]*-webkit-app-region:\s*drag/);
  assert.match(css, /\.drag-pill[\s\S]*app-region:\s*drag/);
  assert.match(css, /button[\s\S]*app-region:\s*no-drag/);
  assert.match(css, /\.drag-icon svg \{ pointer-events:\s*none; \}/);
  assert.match(renderer, /clarity\.on\('mouse:interactive'/);
  assert.doesNotMatch(css, /html\.mouse-ignored/);
});

test('toolbar icon controls are circular while drag stays a pill', () => {
  const css = read('renderer/styles.css');
  assert.match(css, /\.tb-logo,[\s\S]*\.tb-quit[\s\S]*border-radius:\s*50%/);
  assert.match(css, /\.drag-pill[\s\S]*border-radius:\s*var\(--r-pill\)/);
});

test('settings opens without a full-window blur or dim layer', () => {
  const html = read('renderer/index.html');
  const css = read('renderer/styles.css');
  const block = css.match(/#settings-scrim \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(html, /<div id="settings-scrim" class="hidden">/);
  assert.doesNotMatch(html, /<dialog id="settings-scrim"/);
  assert.match(block, /background:\s*transparent/);
  assert.doesNotMatch(block, /backdrop-filter\s*:/);
  assert.doesNotMatch(block, /rgba\(0,0,0/);
});

test('settings can open above onboarding without closing the tutorial', () => {
  const html = read('renderer/index.html');
  const css = read('renderer/styles.css');
  const renderer = read('renderer/renderer.js');
  const preload = read('preload.js');
  const main = read('main.js');
  const settingsBlock = css.match(/#settings-scrim \{[\s\S]*?\n\}/)?.[0] || '';
  const onboardBlock = css.match(/#onboard-scrim \{[\s\S]*?\n\}/)?.[0] || '';
  const consentBlock = css.match(/#consent-scrim \{ position: fixed;[\s\S]*?\}/)?.[0] || '';
  const settingsZ = Number(settingsBlock.match(/z-index:\s*(\d+)/)?.[1]);
  const onboardZ = Number(onboardBlock.match(/z-index:\s*(\d+)/)?.[1]);
  const consentZ = Number(consentBlock.match(/z-index:\s*(\d+)/)?.[1]);
  assert.ok(settingsZ > onboardZ, `settings z-index ${settingsZ} must exceed onboarding ${onboardZ}`);
  assert.ok(settingsZ > consentZ, `settings z-index ${settingsZ} must exceed consent ${consentZ}`);
  assert.ok(settingsZ > 50, `settings z-index ${settingsZ} must exceed transient app UI`);
  assert.match(html, /<div id="settings-scrim" class="hidden">/);
  assert.doesNotMatch(html, /<dialog id="settings-scrim"/);
  assert.doesNotMatch(css, /#settings-scrim::backdrop/);
  assert.doesNotMatch(renderer, /scrim\.showModal\(\)|scrim\.close\(\)/);
  assert.match(preload, /setSettingsPriority:\s*\(open\)\s*=>\s*ipcRenderer\.send\('window:settings-priority'/);
  assert.match(main, /SETTINGS_WINDOW_LEVEL = 3/);
  assert.match(main, /ipcMain\.on\('window:settings-priority'/);
  assert.match(renderer, /buttons:\s*\[\{ label: 'Open Clarity Settings', action: openSettings \}\]/);
  assert.match(renderer, /tutorialScrim\?\.classList\.toggle\('settings-underlay', tutorialIsOpen\)/);
  assert.match(css, /#onboard-scrim\.settings-underlay \{[^}]*opacity:\s*0/);
  assert.match(css, /#settings \{[\s\S]*background:\s*rgb\(20,22,28\)/);
  assert.doesNotMatch(renderer, /Open Clarity Settings'[\s\S]{0,120}finishOnboard\(\)/);
});

test('tutorial and consent overlays keep the area around their cards transparent', () => {
  const css = read('renderer/styles.css');
  const onboardBlock = css.match(/#onboard-scrim \{[\s\S]*?\n\}/)?.[0] || '';
  const consentBlock = css.match(/#consent-scrim \{ position: fixed;[\s\S]*?\}/)?.[0] || '';
  assert.match(onboardBlock, /background:\s*transparent/);
  assert.match(consentBlock, /background:\s*transparent/);
});

test('onboarding uses the polished Clarity setup shell', () => {
  const html = read('renderer/index.html');
  const css = read('renderer/styles.css');
  const renderer = read('renderer/renderer.js');
  const icons = read('renderer/icons.js');
  assert.match(html, /class="ob-head"/);
  assert.match(html, /id="ob-logo"/);
  assert.match(html, /id="ob-step"/);
  assert.match(html, /id="ob-stage"/);
  assert.match(css, /#onboard \{[\s\S]*max-height:[\s\S]*display:\s*flex/);
  assert.match(css, /\.ob-stage\.step-in[\s\S]*tutorialStepIn/);
  assert.match(css, /\.ob-actions \{[^}]*gap:\s*14px/);
  assert.match(renderer, /Step \$\{obIndex \+ 1\} of \$\{OB_STEPS\.length\}/);
  assert.match(renderer, /icon\('circle-help', \{ size: 20 \}\)/);
  assert.doesNotMatch(renderer, /icon\('logo'/);
  assert.doesNotMatch(icons, /const LOGO|name === 'logo'/);
});

test('permissions window leaves the area outside its card transparent', () => {
  const permissions = read('renderer/permissions.html');
  const rootBlock = permissions.match(/#perm-root \{[\s\S]*?\n    \}/)?.[0] || '';
  assert.match(permissions, /html, body \{[\s\S]*?background:\s*transparent/);
  assert.doesNotMatch(rootBlock, /background:\s*(?!transparent)/);
});

test('permissions page uses an external script under a strict script CSP', () => {
  const permissions = read('renderer/permissions.html');
  assert.match(permissions, /script-src 'self';/);
  assert.doesNotMatch(permissions, /script-src[^;]*'unsafe-inline'/);
  assert.match(permissions, /<script src="\.\/permissions\.js"><\/script>/);
});

test('permissions window uses a narrow preload bridge', () => {
  const main = read('main.js');
  const preload = read('preload-permissions.js');
  const permissionWindow = main.slice(main.indexOf('function createPermissionsWindow()'), main.indexOf('// -------- launch --------'));
  assert.match(permissionWindow, /preload:\s*path\.join\(__dirname, 'preload-permissions\.js'\)/);
  for (const action of ['permissionsCheck', 'openPane', 'permissionsContinue', 'quit', 'log']) {
    assert.match(preload, new RegExp(`${action}:`));
  }
  assert.doesNotMatch(preload, /settingsSet|\bask:|micPcm|systemPcm|appLinkState|pickProfileDocument/);
});

test('assistant action buttons use one consistent visual class', () => {
  const html = read('renderer/index.html');
  const css = read('renderer/styles.css');
  const actionMarkup = html.slice(html.indexOf('<div id="action-row">'), html.indexOf('<div id="composer">'));

  assert.equal((actionMarkup.match(/<button class="act"/g) || []).length, 5);
  assert.doesNotMatch(actionMarkup, /act-primary|act-secondary|act-code/);
  assert.doesNotMatch(css, /\.act-primary|\.act-secondary/);
});

test('settings tabs navigate without saving and are laid out without horizontal clipping', () => {
  const renderer = read('renderer/renderer.js');
  const css = read('renderer/styles.css');
  const tabLogic = renderer.slice(renderer.indexOf('function activateSettingsTab'), renderer.indexOf('function updateCustomProviderFields'));
  const tabsCss = css.slice(css.indexOf('.s-tabs {'), css.indexOf('/* Tab panes */'));

  assert.match(tabLogic, /activateSettingsTab\(tab\.dataset\.tab\)/);
  assert.doesNotMatch(tabLogic, /saveSettings\(\)/);
  assert.match(tabsCss, /display:\s*grid/);
  assert.match(tabsCss, /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(tabsCss, /overflow:\s*visible/);
});


test('top toolbar controls use the help-circle and drag-pill visual language', () => {
  const css = read('renderer/styles.css');
  assert.match(css, /\.tb-logo,[\s\S]*\.tb-quit \{[\s\S]*border-radius:\s*50%[\s\S]*background:\s*rgba\(255,255,255,0\.06\)/);
  assert.match(css, /\.tb-hide \{[\s\S]*border-radius:\s*var\(--r-pill\)[\s\S]*background:\s*rgba\(255,255,255,0\.06\)/);
});

test('settings card has no blur or halo', () => {
  const css = read('renderer/styles.css');
  const block = css.match(/#settings \{[\s\S]*?\n\}/)?.[0] || '';
  assert.doesNotMatch(block, /backdrop-filter\s*:/);
  assert.match(block, /box-shadow:\s*none/);
});

test('transcript sidebar never reformats the main panel', () => {
  const css = read('renderer/styles.css');
  const renderer = read('renderer/renderer.js');
  assert.doesNotMatch(css, /#panel-wrap\.sidebar-open/);
  assert.doesNotMatch(renderer, /classList\.(?:add|remove)\('sidebar-open'\)/);
});



test('main translucent surfaces do not use blurred shadow halos', () => {
  const css = read('renderer/styles.css');
  const toolbar = css.match(/#toolbar \{[\s\S]*?\n\}/)?.[0] || '';
  const glass = css.match(/\.glass \{[\s\S]*?\n\}/)?.[0] || '';
  const transcript = css.match(/\.transcript-sidebar \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(toolbar, /box-shadow:\s*none/);
  assert.match(glass, /box-shadow:\s*none/);
  assert.match(transcript, /box-shadow:\s*none/);
});

test('visible Clarity surfaces and progress controls keep rounded corners', () => {
  const html = read('renderer/index.html');
  const css = read('renderer/styles.css');
  const permissions = read('renderer/permissions.html');

  assert.match(css, /#settings \{[\s\S]*border-radius:\s*var\(--r-panel\)/);
  assert.match(css, /#onboard \{[\s\S]*border-radius:\s*var\(--r-panel\)/);
  assert.match(css, /#consent \{[^}]*border-radius:\s*var\(--r-panel\)/);
  assert.match(css, /\.user-bubble \{[\s\S]*border-radius:\s*var\(--r-16\)/);
  assert.match(css, /\.input-interim \{[\s\S]*border-radius:\s*var\(--r-control\)/);
  assert.match(css, /\.whisper-progress-wrap progress \{[\s\S]*border-radius:\s*var\(--r-pill\)/);
  assert.match(permissions, /\.perm-body \{[^}]*overflow-y:\s*auto/);
  assert.match(permissions, /\.perm-card \{[\s\S]*border-radius:\s*var\(--r-panel\)/);
  assert.match(permissions, /\.perm-card \{[\s\S]*overflow-x:\s*hidden[\s\S]*overflow-y:\s*hidden[\s\S]*clip-path:\s*inset\(0 round var\(--r-panel\)\)/);
  assert.match(permissions, /\.perm-open-btn \{[\s\S]*border-radius:\s*var\(--r-control\)/);
  assert.match(html, /id="salary-target" class="s-input"/);
  assert.doesNotMatch(css, /border-radius:\s*[^;]*\b0\b[^;]*;/);
});

test('start and stop hover states are green and red', () => {
  const css = read('renderer/styles.css');
  assert.match(css, /#toolbar \.tb-stop:not\(\.active\):hover \{[\s\S]*background:\s*rgba\(34,197,94,0\.22\)[\s\S]*color:\s*#86efac/);
  assert.match(css, /#toolbar \.tb-stop\.active:hover \{[\s\S]*background:\s*rgba\(239,68,68,0\.22\)[\s\S]*color:\s*#fca5a5/);
});

test('all renderer backdrop blur effects are removed while transparency remains', () => {
  const css = read('renderer/styles.css');
  const permissions = read('renderer/permissions.html');
  assert.doesNotMatch(css + permissions, /backdrop-filter\s*:/);
  assert.doesNotMatch(css + permissions, /filter:\s*blur\(/);
  assert.match(css, /background:\s*rgba\(/);
});

test('toolbar button fills are not overridden by the generic toolbar button rule', () => {
  const css = read('renderer/styles.css');
  assert.match(css, /#toolbar \.tb-logo,[\s\S]*#toolbar \.tb-stop,[\s\S]*background:\s*rgba\(255,255,255,0\.06\)/);
  assert.match(css, /#toolbar \.tb-hide[\s\S]*background:\s*rgba\(255,255,255,0\.06\)/);
});


test('macOS permissions are presented over the already-created Clarity window', () => {
  const main = read('main.js');
  const permissionWindow = main.slice(main.indexOf('function createPermissionsWindow()'), main.indexOf('// -------- launch --------'));
  const startup = main.slice(main.indexOf('app.whenReady().then'), main.indexOf("app.on('will-quit'"));
  const continueHandler = main.slice(main.indexOf("ipcMain.on('permissions:continue'"), main.indexOf('// -------- shortcuts --------'));

  assert.doesNotMatch(permissionWindow, /type:\s*isMac \? 'panel'/);
  assert.match(permissionWindow, /transparent:\s*true/);
  assert.match(permissionWindow, /roundedCorners:\s*true/);
  assert.match(permissionWindow, /alwaysOnTop:\s*!isForegroundYieldActive\(\)/);
  assert.match(main, /PERMISSIONS_WINDOW_LEVEL = 2/);
  assert.match(permissionWindow, /setAlwaysOnTop\(true, 'screen-saver', PERMISSIONS_WINDOW_LEVEL\)/);
  assert.match(permissionWindow, /if \(isForegroundYieldActive\(\)\)[\s\S]*permWin\.setAlwaysOnTop\(false\)[\s\S]*permWin\.hide\(\)/);
  assert.match(permissionWindow, /setVisibleOnAllWorkspaces\(true, \{ visibleOnFullScreen: true \}\)/);
  assert.match(permissionWindow, /permWin\.moveTop\(\)/);
  assert.match(permissionWindow, /parentBounds\.x \+ \(parentBounds\.width - W\) \/ 2/);
  assert.match(permissionWindow, /parentBounds\.y \+ \(parentBounds\.height - H\) \/ 2/);
  assert.ok(startup.indexOf('launchApp();') < startup.indexOf('requestPermissions()'));
  assert.match(startup, /did-finish-load/);
  assert.doesNotMatch(continueHandler, /launchApp\(\)/);
  assert.match(continueHandler, /!isForegroundYieldActive\(\)/);
});


test('macOS privacy settings yield Clarity so System Settings can come to the front', () => {
  const main = read('main.js');
  const openPane = main.slice(main.indexOf('function yieldToExternalSettings()'), main.indexOf("ipcMain.on('app:quit'"));
  assert.match(openPane, /win\.setAlwaysOnTop\(false\)/);
  assert.match(openPane, /permWin\.setAlwaysOnTop\(false\)/);
  assert.match(openPane, /permWin\.hide\(\)/);
  assert.match(openPane, /shell\.openExternal\(url, isMac \? \{ activate: true \} : undefined\)/);
  assert.match(openPane, /browser-window-focus[\s\S]*restoreAfterExternalSettings\(\)/);
  assert.match(openPane, /permWin\.setAlwaysOnTop\(true, 'screen-saver', PERMISSIONS_WINDOW_LEVEL\)/);
});

test('all native UI uses one depth-counted yield/restore coordinator', () => {
  const main = read('main.js');
  const preload = read('preload.js');
  const renderer = read('renderer/renderer.js');
  const promptBridge = main.slice(
    main.indexOf('function beginNativeUiYield('),
    main.indexOf("ipcMain.on('open-pane'")
  );
  assert.match(promptBridge, /nativeUiDepth \+= 1/);
  assert.match(promptBridge, /win\.setAlwaysOnTop\(false\)/);
  assert.match(promptBridge, /win\.blur\(\)/);
  assert.match(promptBridge, /permWin\.hide\(\)/);
  assert.match(promptBridge, /nativeUiDepth -= 1/);
  assert.match(promptBridge, /NATIVE_UI_RESTORE_GRACE_MS/);
  assert.match(promptBridge, /nativeUiRestorePending = true/);
  assert.match(promptBridge, /win\.isFocused\(\)[\s\S]*permWin\.isFocused\(\)/);
  assert.match(promptBridge, /settingsPriorityActive \? SETTINGS_WINDOW_LEVEL : MAIN_WINDOW_LEVEL/);
  assert.match(promptBridge, /permWin\.setAlwaysOnTop\(true, 'screen-saver', PERMISSIONS_WINDOW_LEVEL\)/);
  assert.match(promptBridge, /async function withNativeUiYield\(operation\)/);
  assert.match(promptBridge, /async function showNativeOpenDialog\(options/);
  assert.match(promptBridge, /dialog\.showOpenDialog\(options\)/);
  assert.match(main, /ipcMain\.handle\('native-permission-prompt:begin'/);
  assert.match(main, /ipcMain\.handle\('native-permission-prompt:end'/);
  assert.match(main, /browser-window-focus[\s\S]*nativeUiRestorePending[\s\S]*restoreAfterNativeUiYield\(\)/);
  assert.match(preload, /beginNativePermissionPrompt:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('native-permission-prompt:begin'\)/);
  assert.match(preload, /endNativePermissionPrompt:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('native-permission-prompt:end'\)/);
  assert.match(renderer, /await clarity\.beginNativePermissionPrompt\(\)[\s\S]*getUserMedia/);
  assert.match(renderer, /finally \{[\s\S]*await clarity\.endNativePermissionPrompt\(\)[\s\S]*micStarting = false/);
  const systemAudio = renderer.slice(
    renderer.indexOf('async function startSystemAudio()'),
    renderer.indexOf('function stopSystemAudio()')
  );
  assert.match(systemAudio, /getDisplayMedia\(\{ video: true, audio: true \}\)/);
  assert.doesNotMatch(systemAudio, /beginNativePermissionPrompt|endNativePermissionPrompt/);
  assert.match(systemAudio, /await clarity\.beginSystemAudioPermissionPrompt\(\)/);
  assert.match(systemAudio, /finally \{[\s\S]*await clarity\.endSystemAudioPermissionPrompt\(\)/);
  assert.match(preload, /beginSystemAudioPermissionPrompt:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('system-audio-permission-prompt:begin'\)/);
  assert.match(preload, /endSystemAudioPermissionPrompt:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('system-audio-permission-prompt:end'\)/);
  const startupPermissions = main.slice(
    main.indexOf('async function requestMicrophoneAccess()'),
    main.indexOf('function createPermissionsWindow()')
  );
  assert.match(startupPermissions, /withNativeUiYield\([\s\S]*askForMediaAccess\('microphone'\)/);
  assert.doesNotMatch(startupPermissions, /desktopCapturer\.getSources|requestScreenPermissionOnce/);
});

test('screen permission setup is passive and never summons a startup recording prompt', () => {
  const main = read('main.js');
  const permissions = main.slice(
    main.indexOf('// -------- permissions --------'),
    main.indexOf('function createPermissionsWindow()')
  );
  assert.match(permissions, /screen:\s*getScreenPermissionStatus\(\)/);
  assert.doesNotMatch(permissions, /desktopCapturer\.getSources/);
  assert.doesNotMatch(permissions, /requestScreenPermissionOnce|screenPermissionRequestPromise|screenPermissionRequestAttempted/);
});

test('explicit microphone permission yields only when macOS can show a prompt', () => {
  const main = read('main.js');
  const permissions = main.slice(
    main.indexOf('async function requestMicrophoneAccess()'),
    main.indexOf('function createPermissionsWindow()')
  );
  assert.match(permissions, /micStatus === 'not-determined'/);
  const startup = main.slice(main.indexOf('async function requestPermissions()'), main.indexOf('function createPermissionsWindow()'));
  assert.doesNotMatch(startup, /askForMediaAccess|withNativeUiYield|openExternal/);
});

test('macOS tutorial and permissions UI keep Screen & System Audio Recording setup passive', () => {
  const main = read('main.js');
  const preload = read('preload.js');
  const permissionPreload = read('preload-permissions.js');
  const renderer = read('renderer/renderer.js');
  const permissions = read('renderer/permissions.html');
  const permissionScript = read('renderer/permissions.js');
  assert.doesNotMatch(main, /permissions:request-screen|requestScreenPermissionDirect/);
  assert.doesNotMatch(preload + permissionPreload, /requestScreenPermission/);
  assert.doesNotMatch(renderer, /requestScreenPermission/);
  assert.match(renderer, /Screen & System Audio Recording[\s\S]*System Settings → Privacy & Security → Screen & System Audio Recording/);
  assert.match(renderer, /Check Screen & Audio access[\s\S]*clarity\.permissionsCheck\(\)/);
  assert.match(permissions, /Screen &amp; System Audio Recording/);
  assert.match(permissions, /Check Access/);
  assert.match(permissions, /Privacy &amp; Security → Screen &amp; System Audio Recording/);
  assert.doesNotMatch(permissionScript, /getDisplayMedia|getSources/);
  assert.doesNotMatch(permissions, /Enable Screen &amp; Audio|Open System Settings instead/);
  assert.match(permissionScript, /btnScreen\.addEventListener\('click', async \(\) =>[\s\S]*checkPermissions\(\)/);
  assert.match(permissions, /Restart Clarity/);
  assert.match(permissions, /Open Screen &amp; Audio Settings/);
});

test('permissions window is larger and the card sits lower with balanced breathing room', () => {
  const main = read('main.js');
  const permissions = read('renderer/permissions.html');
  const permissionWindow = main.slice(main.indexOf('function createPermissionsWindow()'), main.indexOf('// -------- launch --------'));
  assert.match(permissionWindow, /W = Math.min\(520, workArea.width\), H = Math.min\(640, workArea.height\)/);
  assert.match(permissionWindow, /centeredY \+ 52/);
  assert.match(permissions, /#perm-root \{[\s\S]*padding:\s*32px 10px 44px/);
  assert.match(permissions, /\.perm-card \{[\s\S]*max-width:\s*500px[\s\S]*max-height:\s*calc\(100vh - 76px\)/);
});

test('screen permission status refreshes after returning from System Settings and can relaunch Clarity', () => {
  const main = read('main.js');
  const preload = read('preload-permissions.js');
  const permissions = read('renderer/permissions.js');

  assert.match(main, /externalSettingsPane = \/Privacy_ScreenCapture\$\/i\.test\(url\) \? 'screen' : 'microphone'/);
  assert.match(main, /webContents\.send\('permissions:refresh', \{ pane \}\)/);
  assert.match(main, /ipcMain\.on\('permissions:restart-app'[\s\S]*app\.relaunch\(\)[\s\S]*app\.quit\(\)/);
  assert.match(preload, /restartApp:\s*\(\)\s*=>\s*ipcRenderer\.send\('permissions:restart-app'\)/);
  assert.match(preload, /onPermissionsRefresh:[\s\S]*ipcRenderer\.on\('permissions:refresh'/);
  assert.match(permissions, /screenCheckAttempted = true/);
  assert.match(permissions, /onPermissionsRefresh[\s\S]*checkPermissions\(\)/);
  assert.match(permissions, /restartBtn\.addEventListener\('click',[\s\S]*restartApp\(\)/);
});

test('README matches the current macOS setup, speech install, shortcuts, and picker-free capture flow', () => {
  const readme = read('README.md');
  assert.match(readme, /Current target: Apple silicon Macs/);
  assert.match(readme, /Local is the default; `small\.en` is the recommended local accuracy\/speed balance/);
  assert.match(readme, /OpenRouter\/Custom credentials do not configure speech-to-text/);
  assert.match(readme, /without Apple's source picker/);
  assert.match(readme, /Screen & System Audio Recording/);
  assert.match(readme, /Follow-up \| `⌘J`/);
  assert.match(readme, /Recap \| `⌘K`/);
  assert.match(readme, /Live Interview/);
  assert.match(readme, /Conversation History/);
  assert.match(readme, /ad-hoc signed/);
  assert.match(readme, /Clarity-0\.2\.4-mac-x64\.zip/);
  assert.match(readme, /Saved transcript text is written to Documents by default/);
});

test('main-process native file pickers cannot bypass the native UI coordinator', () => {
  const main = read('main.js');
  const appLink = read('src/applink.js');
  const coordinatorStart = main.indexOf('async function showNativeOpenDialog(options');
  const coordinatorEnd = main.indexOf("ipcMain.handle('native-permission-prompt:begin'", coordinatorStart);
  assert.ok(coordinatorStart >= 0 && coordinatorEnd > coordinatorStart);
  const outsideCoordinator = main.slice(0, coordinatorStart) + main.slice(coordinatorEnd);
  assert.doesNotMatch(outsideCoordinator, /dialog\.(?:showOpenDialog|showSaveDialog|showMessageBox|showErrorBox)\s*\(/);
  assert.doesNotMatch(appLink, /dialog\.(?:showOpenDialog|showSaveDialog|showMessageBox|showErrorBox)\s*\(/);
  assert.match(main, /whisper:model-import[\s\S]*showNativeOpenDialog\(/);
  assert.match(main, /pickAndParseDocument\(\)[\s\S]*showNativeOpenDialog\(/);
});

test('assistant consent cannot steal focus from native or external OS UI', () => {
  const main = read('main.js');
  const appLink = read('src/applink.js');
  const start = appLink.indexOf('async function requestConsent(');
  const end = appLink.indexOf('/**\n * @param {object} deps', start);
  const requestConsent = appLink.slice(start, end);
  assert.match(main, /canPresentConsent:\s*\(\) => !isForegroundYieldActive\(\)/);
  assert.match(requestConsent, /typeof deps\.canPresentConsent === 'function'[\s\S]*!deps\.canPresentConsent\(\)[\s\S]*return false/);
  assert.ok(requestConsent.indexOf('!deps.canPresentConsent()') < requestConsent.indexOf('askInWindow(win'));
});

test('closing the saved transcript dialog restores Clarity through the native UI coordinator', () => {
  const main = read('main.js');
  const start = main.indexOf("ipcMain.handle('transcript:open-folder'");
  const end = main.indexOf('function isMainRendererSender', start);
  const handler = main.slice(start, end);
  assert.match(handler, /showNativeOpenDialog\(\{/);
  assert.match(handler, /defaultPath: directory/);
  assert.match(handler, /finally \{[\s\S]*returnToClarity\(\)/);
  assert.match(handler, /selection.canceled.*return \{ ok: true, canceled: true \}/);
  assert.match(handler, /yieldToExternalSettings\(\)[\s\S]*shell\.openPath\(selection.filePaths\[0\]\)/);
});

test('external privacy settings also yield Clarity on Windows and macOS', () => {
  const main = read('main.js');
  const external = main.slice(main.indexOf('function yieldToExternalSettings()'), main.indexOf('function restoreAfterExternalSettings()'));
  assert.doesNotMatch(external, /if \(!isMac\) return/);
  assert.match(external, /win\.setAlwaysOnTop\(false\)/);
});

test('macOS display capture stays picker-free and uses Clarity loopback capture', () => {
  const main = read('main.js');
  const launch = main.slice(main.indexOf('function launchApp()'), main.indexOf('// -------- lifecycle --------'));
  assert.match(launch, /if \(isWindows \|\| isMac\) request\.audio = 'loopback'/);
  assert.match(launch, /\{ useSystemPicker: false \}/);
  assert.doesNotMatch(launch, /useSystemPicker: isMac/);
});

test('starting an already-authorized microphone does not hide Clarity', () => {
  const renderer = read('renderer/renderer.js');
  const start = renderer.indexOf('async function startMic()');
  const end = renderer.indexOf('function stopMic()', start);
  const micStart = renderer.slice(start, end);
  assert.match(micStart, /const permissionStatus = await clarity\.permissionsCheck\(\)/);
  assert.match(micStart, /permissionStatus\?\.mic === 'not-determined'/);
  assert.match(micStart, /if \(permissionStatus\?\.mic === 'not-determined'\) \{[\s\S]*await clarity\.beginNativePermissionPrompt\(\)/);
});

test('Chromium media permissions are limited to Clarity audio and display capture', () => {
  const main = read('main.js');
  const launch = main.slice(main.indexOf('function launchApp()'), main.indexOf('// -------- lifecycle --------'));
  assert.match(launch, /webContents\.id !== win\.webContents\.id/);
  assert.match(launch, /details\.isMainFrame === false/);
  assert.match(launch, /currentUrl\.endsWith\('\/renderer\/index\.html'\)/);
  assert.match(launch, /permission === 'display-capture'/);
  assert.match(launch, /permission !== 'media'/);
  assert.match(launch, /mediaTypes\.includes\('audio'\) && !mediaTypes\.includes\('video'\)/);
  assert.match(launch, /details\.mediaType !== 'video'/);
  assert.doesNotMatch(launch, /permission === 'microphone'/);
  assert.doesNotMatch(launch, /permission === 'audioCapture'/);
  assert.doesNotMatch(launch, /permission === 'screen'/);
});

test('high-volume renderer IPC validates sender and payload shape', () => {
  const main = read('main.js');
  const ipc = main.slice(main.indexOf("ipcMain.on('ask'"), main.indexOf('function isAllowedPaneUrl'));
  assert.match(main, /const MAX_PCM_CHUNK_BYTES = 1024 \* 1024/);
  assert.match(ipc, /isMainRendererSender\(event\.sender\)/);
  assert.match(ipc, /!payload \|\| typeof payload !== 'object'/);
  assert.match(ipc, /if \(!MODES\[mode\]\) return/);
  assert.match(ipc, /payload\.text\.slice\(0, 20000\)/);
  assert.match(ipc, /isValidPcmPayload\(arrayBuffer\)/);
});

test('settings cannot be covered by the native permissions panel', () => {
  const main = read('main.js');
  const renderer = read('renderer/renderer.js');
  const priorityHandler = main.slice(
    main.indexOf("ipcMain.on('window:settings-priority'"),
    main.indexOf("ipcMain.on('permissions:continue'")
  );
  assert.match(priorityHandler, /settingsPriorityActive[\s\S]*permWin\.isVisible\(\)[\s\S]*permWin\.hide\(\)/);
  assert.match(priorityHandler, /permissionsHiddenForSettings[\s\S]*permWin\.show\(\)[\s\S]*permWin\.moveTop\(\)/);
  assert.match(priorityHandler, /if \(isForegroundYieldActive\(\)\)[\s\S]*return;/);
  const foregroundGuard = priorityHandler.slice(0, priorityHandler.indexOf('const level ='));
  assert.doesNotMatch(foregroundGuard, /win\.setAlwaysOnTop\(true/);
  assert.doesNotMatch(foregroundGuard, /win\.moveTop\(\)|win\.focus\(\)/);
  assert.doesNotMatch(renderer, /showModal\(\)|scrim\.close\(\)/);
});

test('tutorial has six navigable steps, includes speech setup, and can be reopened from Help', () => {
  const renderer = read('renderer/renderer.js');
  const tutorial = renderer.slice(renderer.indexOf('const OB_STEPS = ['), renderer.indexOf('// ---- boot'));
  assert.equal((tutorial.match(/title:\s*'/g) || []).length, 6);
  assert.match(tutorial, /title:\s*'Install speech-to-text'/);
  assert.match(tutorial, /Settings → Audio[\s\S]*small\.en[\s\S]*Download/);
  assert.match(tutorial, /Open Audio Settings[\s\S]*openSettings\('transcription'\)/);
  assert.match(tutorial, /#ob-next'[\s\S]*obIndex === OB_STEPS\.length - 1[\s\S]*obIndex\+\+/);
  assert.match(tutorial, /#ob-back'[\s\S]*obIndex > 0[\s\S]*obIndex--/);
  assert.match(tutorial, /#ob-skip'\)\.addEventListener\('click', finishOnboard\)/);
  assert.match(tutorial, /#logo-btn'\)\.addEventListener\('click', showOnboard\)/);
});


test('conversation history opens as a true sidecar without resizing the native window', () => {
  const css = read('renderer/styles.css');
  const renderer = read('renderer/renderer.js');
  const preload = read('preload.js');
  const main = read('main.js');
  const sidebar = css.match(/\.transcript-sidebar \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(sidebar, /left:\s*var\(--history-left,\s*calc\(50% \+ 324px\)\)/);
  assert.match(sidebar, /width:\s*240px/);
  assert.match(main, /const BASE_WINDOW_WIDTH = 700/);
  assert.match(main, /const HISTORY_CANVAS_EXTRA = 430/);
  assert.match(main, /const W = BASE_WINDOW_WIDTH \+ HISTORY_CANVAS_EXTRA/);
  assert.doesNotMatch(preload, /setHistoryPanelOpen/);
  assert.doesNotMatch(renderer, /setHistoryPanelOpen/);
  assert.doesNotMatch(main, /window:history-panel/);
  assert.doesNotMatch(renderer, /historySidecarIn/);
  assert.doesNotMatch(css, /#panel-wrap\.sidebar-open/);
});

test('conversation history fades and scales out without moving the window', () => {
  const css = read('renderer/styles.css');
  const renderer = read('renderer/renderer.js');
  const dismissStart = css.indexOf('@keyframes sidecarDismiss');
  const dismissEnd = css.indexOf('@keyframes historyRowIn', dismissStart);
  const dismiss = css.slice(dismissStart, dismissEnd);
  assert.match(css, /\.transcript-sidebar\.closing[\s\S]*sidecarDismiss/);
  assert.match(dismiss, /opacity:\s*0/);
  assert.match(dismiss, /scale\(0\.97\)/);
  assert.doesNotMatch(dismiss, /translate[XY]?\(/);
  assert.match(renderer, /sidebar\.classList\.add\('closing'\)/);
  assert.match(renderer, /historyHideTimer = setTimeout\(finishHide, 230\)/);
});

test('conversation history uses a deliberate open animation and guards rapid retoggles', () => {
  const css = read('renderer/styles.css');
  const renderer = read('renderer/renderer.js');
  const revealStart = css.indexOf('@keyframes sidecarReveal');
  const revealEnd = css.indexOf('@keyframes sidecarDismiss', revealStart);
  const reveal = css.slice(revealStart, revealEnd);
  assert.match(css, /animation:\s*sidecarReveal 260ms var\(--ease-out\) both/);
  assert.match(reveal, /opacity:\s*0/);
  assert.match(reveal, /scale\(0\.96\)/);
  assert.doesNotMatch(reveal, /translate[XY]?\(/);
  assert.match(renderer, /clearTimeout\(historyHideTimer\)/);
});

test('ready state suppresses message scrollbars during panel show and hide', () => {
  const css = read('renderer/styles.css');
  const renderer = read('renderer/renderer.js');
  assert.match(css, /#messages\.start-state \{[\s\S]*overflow-y:\s*hidden[\s\S]*scrollbar-width:\s*none/);
  assert.match(css, /#messages\.start-state::\-webkit-scrollbar \{ display:\s*none; \}/);
  assert.match(renderer, /function showStartMessage\(\)[\s\S]*messages\.classList\.add\('start-state'\)/);
  assert.match(renderer, /clarity\.on\('llm:start'[\s\S]*messages\.classList\.remove\('start-state'\)/);
});

test('Hide fades the main panel shell out instead of disappearing immediately', () => {
  const css = read('renderer/styles.css');
  const renderer = read('renderer/renderer.js');
  const collapseStart = css.indexOf('@keyframes panelShellOut');
  const collapseEnd = css.indexOf('@keyframes modalIn', collapseStart);
  const collapse = css.slice(collapseStart, collapseEnd);
  assert.match(css, /#panel-wrap\.collapsing[\s\S]*panelShellOut/);
  assert.match(collapse, /opacity:\s*0/);
  assert.match(collapse, /scale\(0\.992\)/);
  assert.doesNotMatch(collapse, /translate[XY]?\(/);
  assert.match(renderer, /panelWrap\.classList\.add\('collapsing'\)/);
  assert.match(renderer, /panelHideTimer = setTimeout\(finishCollapse, 180\)/);
  assert.doesNotMatch(renderer, /\$\('#panel'\)\.classList\.toggle\('collapsed'\)/);
});

test('conversation history matches and follows the main panel height', () => {
  const css = read('renderer/styles.css');
  const renderer = read('renderer/renderer.js');
  const sidebar = css.match(/\.transcript-sidebar \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(sidebar, /top:\s*var\(--history-top/);
  assert.match(sidebar, /height:\s*var\(--history-height/);
  assert.match(renderer, /function syncHistorySidebarGeometry\(\)/);
  assert.match(renderer, /panel\.getBoundingClientRect\(\)/);
  assert.match(renderer, /--history-top[^\n]*rect\.top/);
  assert.match(renderer, /const left = rect\.right \+ 12/);
  assert.match(renderer, /--history-height[^\n]*rect\.height/);
  assert.match(renderer, /new ResizeObserver\(\(\) => syncHistorySidebarGeometry\(\)\)/);
  assert.match(renderer, /window\.addEventListener\('resize', syncHistorySidebarGeometry\)/);
});

test('main panel uses one shell entrance animation and visible keyboard focus', () => {
  const css = read('renderer/styles.css');
  const panelWrap = css.match(/#panel-wrap \{[\s\S]*?\n\}/)?.[0] || '';
  const panel = css.match(/#panel \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(panelWrap, /animation:\s*panelShellIn/);
  assert.doesNotMatch(panel, /animation\s*:/);
  assert.match(css, /button:focus-visible,[\s\S]*outline:\s*2px solid var\(--focus\)/);
});

test('icon controls and settings tabs expose accessible state', () => {
  const html = read('renderer/index.html');
  const renderer = read('renderer/renderer.js');
  assert.match(html, /id="history-btn"[^>]*aria-expanded="false"[^>]*aria-controls="transcript-sidebar"/);
  assert.match(html, /id="toolbar-settings-btn"[^>]*aria-label="Open settings"/);
  assert.match(html, /class="s-tabs" role="tablist"/);
  assert.equal((html.match(/role="tab"/g) || []).length, 6);
  assert.equal((html.match(/role="tabpanel"/g) || []).length, 6);
  assert.match(renderer, /item\.setAttribute\('aria-selected', String\(active\)\)/);
  assert.match(renderer, /historyBtn\.setAttribute\('aria-expanded', 'true'\)/);
});

test('settings fades and scales out before it is hidden', () => {
  const css = read('renderer/styles.css');
  const renderer = read('renderer/renderer.js');
  const modalOutStart = css.indexOf('@keyframes modalOut');
  const modalOutEnd = css.indexOf('@keyframes scrimIn', modalOutStart);
  const modalOut = css.slice(modalOutStart, modalOutEnd);
  assert.match(css, /#settings-scrim\.closing #settings \{ animation:\s*modalOut/);
  assert.match(modalOut, /opacity:\s*0/);
  assert.match(modalOut, /scale\(0\.985\)/);
  assert.doesNotMatch(modalOut, /translate[XY]?\(/);
  assert.match(renderer, /scrim\.classList\.add\('closing'\)/);
  assert.match(renderer, /settingsHideTimer = setTimeout\(finishClose, 170\)/);
});

test('onboarding, consent, and permissions honor reduced motion', () => {
  const css = read('renderer/styles.css');
  const permissions = read('renderer/permissions.html');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /#onboard-scrim\.closing #onboard[\s\S]*modalOut/);
  assert.match(css, /#consent-scrim\.closing #consent[\s\S]*modalOut/);
  assert.match(permissions, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(permissions, /\.perm-card\.closing[\s\S]*fadeOut/);
});
