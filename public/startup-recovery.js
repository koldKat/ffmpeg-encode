// Independent of the module graph so failed imports can recover during startup.
(() => {
  const panel = document.getElementById('session-screen');
  if (!panel) return;
  const message = document.getElementById('app-startup-message');
  const retry = document.getElementById('app-startup-retry');
  const mount = panel.parentNode;
  const initialMessage = message.textContent;
  const delays = [2000, 5000, 10000];
  const storageKey = `app-startup-retries:${location.pathname}${location.search}`;
  let recovery = { attempts: 0, startedAt: Date.now() };
  let storageAvailable = true;
  try {
    let saved;
    try { saved = JSON.parse(sessionStorage.getItem(storageKey)); } catch (_) {}
    if (saved && Number.isInteger(saved.attempts) && saved.attempts >= 0 &&
        saved.attempts <= delays.length && Number.isFinite(saved.startedAt) &&
        Date.now() - saved.startedAt >= 0 && Date.now() - saved.startedAt < 300000) {
      recovery = saved;
    }
    sessionStorage.setItem(storageKey, JSON.stringify(recovery));
  } catch (_) {
    // Without persistent attempts a reload could loop forever.
    storageAvailable = false;
  }
  let finished = false;
  let failed = false;
  let recoveryTimer = null;
  retry.hidden = true;
  function resetRecovery() {
    try { sessionStorage.removeItem(storageKey); } catch (_) {}
  }
  retry.addEventListener('click', () => {
    if (finished) return;
    clearTimeout(recoveryTimer);
    resetRecovery();
    location.reload();
  });
  const timer = setTimeout(() => {
    message.textContent = navigator.onLine === false
      ? 'You are offline. Loading will retry when you reconnect.'
      : 'Loading is taking longer than usual. Still loading...';
    // Slow loading is not a failure: allow the current startup to finish.
  }, 12000);
  function scheduleRecovery() {
    if (finished || recoveryTimer !== null) return;
    if (navigator.onLine === false) {
      message.textContent = 'You are offline. Loading will retry when you reconnect.';
      return;
    }
    if (!storageAvailable || recovery.attempts >= delays.length) {
      message.textContent = 'The app could not start. Please try again.';
      retry.hidden = false;
      return;
    }
    retry.hidden = true;
    message.textContent = 'The app could not start. Retrying automatically...';
    recoveryTimer = setTimeout(() => {
      recoveryTimer = null;
      if (finished) return;
      if (navigator.onLine === false) { scheduleRecovery(); return; }
      try {
        recovery.attempts++;
        sessionStorage.setItem(storageKey, JSON.stringify(recovery));
      } catch (_) {
        storageAvailable = false;
        scheduleRecovery();
        return;
      }
      location.reload();
    }, delays[recovery.attempts]);
  }
  function fail() {
    if (finished) return;
    failed = true;
    if (!panel.isConnected) mount.append(panel);
    panel.style.display = 'flex';
    clearTimeout(timer);
    scheduleRecovery();
  }
  function onError(event) {
    if (event.target?.tagName === 'SCRIPT' || event.error) fail();
  }
  function onOffline() {
    if (finished) return;
    clearTimeout(recoveryTimer);
    recoveryTimer = null;
    retry.hidden = true;
    message.textContent = 'You are offline. Loading will retry when you reconnect.';
  }
  function onOnline() {
    if (finished) return;
    if (failed) scheduleRecovery();
    else message.textContent = initialMessage;
  }
  window.addEventListener('error', onError, true);
  window.addEventListener('offline', onOffline);
  window.addEventListener('online', onOnline);
  window.appStartup = {
    get pending() { return !finished; },
    fail,
    ready() {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearTimeout(recoveryTimer);
      resetRecovery();
      window.removeEventListener('error', onError, true);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
      panel.remove();
    },
  };
})();
