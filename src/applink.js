// The publik app link: how Iris asks Clarity what it is doing.
//
// Before this, an assistant helping someone with Clarity could only see what was on
// screen and whatever had already been written to a log file. Neither answers
// the question people actually report — "it isn't listening any more" — because
// the reason is in memory: a 403 from the speech model, a shortcut another app
// grabbed first, a Screen Recording grant that was never given.
//
// So Clarity answers questions instead. Nothing is exposed until the user says yes,
// and the transcript never leaves this process; see `describeState` below.
//
// The library lives in vendor/app-link and is maintained in the publik repo at
// packages/app-link. Do not edit it here.

const { app, ipcMain } = require('electron');
const { AppLinkServer } = require('../vendor/app-link');
const { describeState, consentCopy } = require('./applink-state');

let link = null;
let consentSeq = 0;

/** Nobody is going to sit in front of an unanswered sheet for longer than this. */
const CONSENT_TIMEOUT_MS = 120_000;

/**
 * Ask inside Clarity's own window.
 *
 * The first version of this used a native message box, and it was unusable:
 * Clarity calls app.dock.hide(), so it is an accessory application and never
 * becomes active on its own. The panel appeared and then would not take a
 * click, because the app it belonged to was not frontmost and nothing was
 * bringing it forward.
 *
 * Clarity's own window has none of that problem, matches the rest of the app, and
 * carries setContentProtection — so a consent prompt does not show up in a
 * screen share, which for this particular prompt is the right default.
 */
function askInWindow(win, copy, scope) {
  const id = `consent-${++consentSeq}`;

  return new Promise((resolve) => {
    let settled = false;
    const settle = (allowed) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ipcMain.removeListener('applink:consent-response', onResponse);
      win.removeListener('closed', onClosed);
      resolve(allowed);
    };
    const onResponse = (_event, payload) => {
      if (payload && payload.id === id) settle(!!payload.allowed);
    };
    const onClosed = () => settle(false);
    const timer = setTimeout(() => settle(false), CONSENT_TIMEOUT_MS);

    ipcMain.on('applink:consent-response', onResponse);
    win.once('closed', onClosed);

    // Clarity deliberately never steals focus — except here. A question about who
    // may read your screen activity is the one thing that should interrupt.
    if (!win.isVisible()) win.show();
    app.focus({ steal: true });
    win.focus();

    win.webContents.send('applink:consent-request', { id, scope, ...copy });
  });
}

/** Copy comes from applink-state.js so it can be tested without Electron. */
async function requestConsent(request, deps) {
  const copy = consentCopy(request);
  if (deps && typeof deps.canPresentConsent === 'function' && !deps.canPresentConsent()) return false;
  const win = deps && deps.getWindow ? deps.getWindow() : null;

  if (win && !win.isDestroyed()) return askInWindow(win, copy, request.scope);

  // Fail closed when the protected in-app consent sheet is unavailable. A
  // native message box from this accessory app can appear behind other Clarity
  // windows and bypasses the single native-UI foreground coordinator.
  return false;
}

/**
 * @param {object} deps  Live references from main.js — not a snapshot, so
 *   `get_state` reflects the moment it is asked rather than the moment Clarity
 *   started.
 */
function startAppLink(deps) {
  if (link) return link;

  link = new AppLinkServer({
    appId: 'com.clarity.overlay', // Matches electron-builder.cjs. Read off a build, not guessed.
    appSlug: 'clarity',
    appName: 'Clarity',
    appVersion: app.getVersion(),
    stateProvider: () => describeState(deps.snapshot()),
    onConsentRequest: (request) => requestConsent(request, deps),
    diagnosticsProvider: () => ({
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      userDataPath: app.getPath('userData'),
    }),
  });

  // Both directions are recorded, because an action that changes what the
  // microphone is doing should be visible afterwards in the same place a user
  // or a patch agent looks for anything else that happened.
  link.action('set_capturing', {
    description: 'Start or stop listening',
    inputSchema: { type: 'object', properties: { active: { type: 'boolean' } }, required: ['active'] },
    handler: async (args, { caller }) => {
      const active = !!args.active;
      const capturing = await deps.setCapturing(active);
      link.record({
        level: 'info',
        event: 'applink_set_capturing',
        msg: `${caller.name} requested listening ${active ? 'on' : 'off'}; listening is ${capturing ? 'on' : 'off'}`,
      });
      return { capturing };
    },
  });

  link.start().catch((error) => {
    // A link that will not start must never stop Clarity from starting. The app
    // worked without this yesterday.
    console.log('[clarity] app link unavailable:', error && error.message);
    link = null;
  });

  return link;
}

/** Record an event. Safe before start() and after stop(); does nothing if the link is off. */
function recordEvent(event) {
  if (!link) return null;
  try {
    return link.record(event);
  } catch (_) {
    return null;
  }
}

function appLinkConsentState() {
  return link ? link.consent.snapshot() : { callers: {} };
}

function revokeAppLinkCaller(callerId) {
  return link ? link.consent.revoke(callerId) : false;
}

async function stopAppLink() {
  if (!link) return;
  const current = link;
  link = null;
  await current.stop().catch(() => {});
}

module.exports = {
  startAppLink,
  stopAppLink,
  recordEvent,
  appLinkConsentState,
  revokeAppLinkCaller,
  describeState,
  requestConsent,
};
