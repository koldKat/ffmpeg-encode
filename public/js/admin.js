const els = {
  machineChip: document.getElementById('admin-machine-chip'),
  versionInput: document.getElementById('admin-version'),
  versionStat: document.getElementById('admin-version-stat'),
  versionSub: document.getElementById('admin-version-sub'),
  machineStat: document.getElementById('admin-machine-stat'),
  machineSub: document.getElementById('admin-machine-sub'),
  usersCardStat: document.getElementById('admin-users-card-stat'),
  usersCardSub: document.getElementById('admin-users-card-sub'),
  rssStat: document.getElementById('admin-rss-stat'),
  rssSub: document.getElementById('admin-rss-sub'),
  memoryStat: document.getElementById('admin-memory-stat'),
  memorySub: document.getElementById('admin-memory-sub'),
  cpuStat: document.getElementById('admin-cpu-stat'),
  cpuSub: document.getElementById('admin-cpu-sub'),
  saveVersionBtn: document.getElementById('save-version-btn'),
  versionMsg: document.getElementById('admin-version-msg'),
  newUsername: document.getElementById('admin-new-username'),
  newPassword: document.getElementById('admin-new-password'),
  createUserBtn: document.getElementById('create-user-btn'),
  userMsg: document.getElementById('admin-user-msg'),
  usersList: document.getElementById('admin-users-list'),
};

let adminState = null;
let refreshInFlight = false;
let versionDirty = false;

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function findPasswordInput(username) {
  return Array.from(document.querySelectorAll('[data-user-password]'))
    .find(input => input.getAttribute('data-user-password') === username) || null;
}

function formatDate(epochSeconds) {
  if (!epochSeconds) return 'N/A';
  const date = new Date(Number(epochSeconds) * 1000);
  if (Number.isNaN(date.getTime())) return 'N/A';
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${day}/${month}/${year}, ${hours}:${minutes}:${seconds}`;
}

function formatSize(bytes) {
  const rawValue = Number(bytes || 0);
  const sign = rawValue < 0 ? '-' : '';
  const value = Math.abs(rawValue);
  const KB = 1000;
  const MB = 1000000;
  const GB = 1024 * MB;
  const TB = 1024 * GB;
  if (value >= TB) return `${sign}${(value / TB).toFixed(3)} TB`;
  if (value >= GB) return `${sign}${(value / GB).toFixed(2)} GB`;
  if (value >= MB) return `${sign}${(value / MB).toFixed(1)} MB`;
  if (value >= KB) return `${sign}${(value / KB).toFixed(1)} KB`;
  return `${sign}${Math.round(value)} B`;
}

function setText(el, value) {
  if (el) el.textContent = value;
}

async function apiFetch(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

function renderUsers(users, remoteUsername) {
  if (!els.usersList) return;
  const activePasswordInput = document.activeElement?.matches?.('[data-user-password]')
    ? document.activeElement
    : null;
  const activePasswordUsername = activePasswordInput?.getAttribute('data-user-password') || '';
  const activePasswordValue = activePasswordInput?.value || '';
  if (!Array.isArray(users) || !users.length) {
    els.usersList.innerHTML = '<div class="empty-state">No users found.</div>';
    return;
  }
  els.usersList.innerHTML = users.map(user => {
    const locked = user.username === remoteUsername;
    return `
      <article class="admin-user-card">
        <div class="admin-user-main">
          <div class="admin-user-title-row">
            <strong>${escapeHtml(user.username)}</strong>
            <span class="badge ${locked ? 'running' : 'pending'}">${locked ? 'protected' : 'managed'}</span>
          </div>
          <div class="admin-user-sub">created: ${escapeHtml(formatDate(user.createdAt))}</div>
          <div class="admin-user-sub">active sessions: ${escapeHtml(user.sessionsCount || 0)}</div>
        </div>
        <div class="admin-user-actions">
          <input type="password" class="admin-password-input" data-user-password="${escapeHtml(user.username)}" placeholder="New password" ${locked ? 'disabled' : ''}>
          <button class="ghost-btn small-btn ${locked ? '' : 'pause-btn pause-resume'}" data-reset-user="${escapeHtml(user.username)}" ${locked ? 'disabled' : ''}>Reset Password</button>
          <button class="ghost-btn small-btn stop-btn" data-delete-user="${escapeHtml(user.username)}" ${locked ? 'disabled' : ''}>Delete User</button>
        </div>
      </article>
    `;
  }).join('');
  if (activePasswordUsername) {
    const restoredInput = findPasswordInput(activePasswordUsername);
    if (restoredInput && !restoredInput.disabled) {
      restoredInput.value = activePasswordValue;
      restoredInput.focus();
      restoredInput.setSelectionRange(restoredInput.value.length, restoredInput.value.length);
    }
  }
}

function render(state) {
  adminState = state;
  const users = Array.isArray(state.users) ? state.users : [];
  const totalSessions = users.reduce((sum, user) => sum + Number(user.sessionsCount || 0), 0);
  const machineName = state.app?.machineName || 'localhost';
  const version = state.app?.version || 'N/A';
  const protectedUser = state.app?.remoteUsername || 'koldKat';

  setText(els.machineChip, machineName);
  if (!versionDirty && document.activeElement !== els.versionInput) {
    els.versionInput.value = state.app?.version || '';
  }
  setText(els.versionStat, version);
  setText(els.versionSub, `protected user: ${protectedUser}`);
  setText(els.machineStat, machineName);
  setText(els.machineSub, 'localhost admin only');
  setText(els.usersCardStat, `${users.length} | ${totalSessions}`);
  setText(els.usersCardSub, 'users | active sessions');
  setText(els.rssStat, formatSize(state.app?.memory?.rssBytes || 0));
  setText(els.rssSub, 'resident set size');
  setText(els.memoryStat, [
    formatSize(state.app?.memory?.heapUsedBytes || 0),
    formatSize(state.app?.memory?.heapTotalBytes || 0),
  ].join(' | '));
  setText(els.memorySub, 'heap used | total');
  setText(els.cpuStat, state.app?.cpu?.usagePct == null ? 'N/A' : `${Math.round(Number(state.app.cpu.usagePct))}%`);
  setText(els.cpuSub, `node ${Number(state.app?.cpu?.userSeconds || 0).toFixed(1)}s | ffmpeg ${Number(state.app?.cpu?.childSeconds || 0).toFixed(1)}s`);
  renderUsers(users, protectedUser);
}

async function refresh() {
  if (refreshInFlight) return;
  refreshInFlight = true;
  try {
    render(await apiFetch('/api/admin/state'));
  } finally {
    refreshInFlight = false;
  }
}

function startStatsRefresh() {
  refresh().catch(error => {
    els.userMsg.textContent = error.message;
  });
  window.setInterval(() => {
    refresh().catch(error => {
      els.userMsg.textContent = error.message;
    });
  }, 1000);
}

async function saveVersion() {
  els.versionMsg.textContent = '';
  try {
    const nextVersion = els.versionInput.value.trim();
    const data = await apiFetch('/api/admin/settings', {
      method: 'POST',
      body: JSON.stringify({ key: 'app_version', value: nextVersion }),
    });
    versionDirty = false;
    els.versionInput.value = data.version || nextVersion;
    els.versionMsg.textContent = `Saved version: ${data.version}`;
    await refresh();
  } catch (error) {
    els.versionMsg.textContent = error.message;
  }
}

async function createUser() {
  els.userMsg.textContent = '';
  try {
    const data = await apiFetch('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify({
        username: els.newUsername.value.trim(),
        password: els.newPassword.value,
      }),
    });
    els.newUsername.value = '';
    els.newPassword.value = '';
    els.userMsg.textContent = 'User created.';
    render({ ...adminState, users: data.users || [] });
  } catch (error) {
    els.userMsg.textContent = error.message;
  }
}

async function resetPassword(username) {
  els.userMsg.textContent = '';
  const input = findPasswordInput(username);
  const password = input ? input.value : '';
  try {
    const data = await apiFetch('/api/admin/users/password', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    if (input) input.value = '';
    els.userMsg.textContent = `Password updated for ${username}.`;
    render({ ...adminState, users: data.users || [] });
  } catch (error) {
    els.userMsg.textContent = error.message;
  }
}

async function deleteUser(username) {
  els.userMsg.textContent = '';
  try {
    const data = await apiFetch('/api/admin/users/delete', {
      method: 'POST',
      body: JSON.stringify({ username }),
    });
    els.userMsg.textContent = `Deleted ${username}.`;
    render({ ...adminState, users: data.users || [] });
  } catch (error) {
    els.userMsg.textContent = error.message;
  }
}

els.versionInput.addEventListener('input', () => {
  versionDirty = true;
});
els.saveVersionBtn.addEventListener('click', saveVersion);
els.createUserBtn.addEventListener('click', createUser);
els.usersList.addEventListener('click', event => {
  const resetUser = event.target.closest('[data-reset-user]')?.getAttribute('data-reset-user');
  if (resetUser) {
    resetPassword(resetUser);
    return;
  }
  const deleteUserName = event.target.closest('[data-delete-user]')?.getAttribute('data-delete-user');
  if (deleteUserName) {
    deleteUser(deleteUserName);
  }
});

startStatsRefresh();
