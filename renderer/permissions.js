(function () {
  const clarity = window.clarity;

  const statusMic = document.getElementById('status-mic');
  const statusScreen = document.getElementById('status-screen');
  const rowMic = document.getElementById('row-mic');
  const rowScreen = document.getElementById('row-screen');
  const badgeMic = document.getElementById('badge-mic');
  const badgeScreen = document.getElementById('badge-screen');
  const btnMic = document.getElementById('btn-mic');
  const btnScreen = document.getElementById('btn-screen');
  const checkBtn = document.getElementById('check-btn');
  const restartBtn = document.getElementById('restart-btn');
  const continueBtn = document.getElementById('continue-btn');
  const quitBtn = document.getElementById('quit-btn');
  const card = document.querySelector('.perm-card');
  let screenCheckAttempted = false;

  function updateUI(status) {
    const micOk = status.mic === 'granted';
    const screenOk = status.screen === 'granted';

    rowMic.className = 'perm-row no-drag ' + (micOk ? 'granted' : 'denied');
    statusMic.textContent = micOk ? 'Granted' : (status.mic === 'not-determined' ? 'Not yet requested' : 'Not granted — open Settings to allow');
    statusMic.className = 'perm-status ' + (micOk ? 'ok' : 'bad');
    badgeMic.textContent = micOk ? 'On' : 'Off';
    badgeMic.className = 'perm-badge ' + (micOk ? 'ok' : 'bad');
    btnMic.classList.toggle('hidden', micOk);
    btnMic.textContent = status.mic === 'not-determined' ? 'Allow Microphone' : 'Open Settings';

    rowScreen.className = 'perm-row no-drag ' + (screenOk ? 'granted' : 'denied');
    statusScreen.textContent = screenOk
      ? 'Granted'
      : (screenCheckAttempted
          ? 'Still not active — restart Clarity if you just enabled it'
          : 'Not granted — enable Clarity in macOS Settings');
    statusScreen.className = 'perm-status ' + (screenOk ? 'ok' : 'bad');
    badgeScreen.textContent = screenOk ? 'On' : 'Off';
    badgeScreen.className = 'perm-badge ' + (screenOk ? 'ok' : 'bad');
    btnScreen.classList.remove('hidden');
    restartBtn.classList.toggle('hidden', screenOk || !screenCheckAttempted);

    continueBtn.disabled = !(micOk && screenOk);
  }

  async function checkPermissions() {
    checkBtn.classList.add('checking');
    checkBtn.textContent = 'Checking…';
    try {
      const status = await clarity.permissionsCheck();
      updateUI(status);
    } catch (e) {
      statusScreen.textContent = 'Access check failed. Try Check Again.';
      clarity.log('permissions check error: ' + e);
    } finally {
      checkBtn.classList.remove('checking');
      checkBtn.textContent = 'Check Again';
    }
  }

  document.getElementById('open-screen-settings').addEventListener('click', () => {
    clarity.openPane('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
  });
  document.getElementById('open-clarity-settings').addEventListener('click', () => clarity.openClaritySettings());
  btnMic.addEventListener('click', async () => {
    if (btnMic.disabled) return;
    btnMic.disabled = true;
    try { updateUI(await clarity.requestMicrophoneAccess()); }
    catch (error) { statusMic.textContent = 'Could not open microphone access. Try again.'; clarity.log(String(error)); }
    finally { btnMic.disabled = false; }
  });
  btnScreen.addEventListener('click', async () => {
    screenCheckAttempted = true;
    await checkPermissions();
  });
  checkBtn.addEventListener('click', () => {
    screenCheckAttempted = true;
    checkPermissions();
  });
  restartBtn.addEventListener('click', () => clarity.restartApp());
  clarity.onPermissionsRefresh?.((payload) => {
    if (payload?.pane === 'screen') screenCheckAttempted = true;
    checkPermissions();
  });

  continueBtn.addEventListener('click', () => {
    if (card.classList.contains('closing')) return;
    card.classList.add('closing');
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) clarity.permissionsContinue();
    else setTimeout(() => clarity.permissionsContinue(), 170);
  });

  quitBtn.addEventListener('click', () => clarity.quit());
  checkPermissions();
})();
