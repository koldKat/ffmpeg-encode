const TOKEN_KEY = 'ffmpeg_webapp_token';

const els = {
  loginScreen: document.getElementById('login-screen'),
  blockedScreen: document.getElementById('blocked-screen'),
  appScreen: document.getElementById('app-screen'),
  authUsername: document.getElementById('auth-username'),
  authPassword: document.getElementById('auth-password'),
  authError: document.getElementById('auth-error'),
  loginBtn: document.getElementById('login-btn'),
  registerBtn: document.getElementById('register-btn'),
  blockedLogoutBtn: document.getElementById('blocked-logout-btn'),
  logoutBtn: document.getElementById('logout-btn'),
  appEyebrow: document.getElementById('app-eyebrow'),
  machineChip: document.getElementById('machine-chip'),
  viewerChip: document.getElementById('viewer-chip'),
  sourceRoot: document.getElementById('source-root'),
  sourceRootList: document.getElementById('path-suggestions-source'),
  outRoot: document.getElementById('out-root'),
  outRootList: document.getElementById('path-suggestions-out'),
  tune: document.getElementById('tune'),
  preset: document.getElementById('preset'),
  mbPerMin: document.getElementById('mb-per-min'),
  mbStep: document.getElementById('mb-step'),
  audioKbit: document.getElementById('audio-kbit'),
  minVideoKbit: document.getElementById('min-video-kbit'),
  overheadPct: document.getElementById('overhead-pct'),
  encThreadsLabel: document.getElementById('enc-threads-label'),
  encThreads: document.getElementById('enc-threads'),
  scanBtn: document.getElementById('scan-btn'),
  startBtn: document.getElementById('start-btn'),
  pauseLabel: document.getElementById('pause-label'),
  pauseBtn: document.getElementById('pause-btn'),
  stopAfterBtn: document.getElementById('stop-after-btn'),
  stopBtn: document.getElementById('stop-btn'),
  formError: document.getElementById('form-error'),
  statusPill: document.getElementById('status-pill'),
  heroMeta: document.getElementById('hero-meta'),
  heroMetaText: document.getElementById('hero-meta-text'),
  foundLabel: document.getElementById('found-label'),
  countsStat: document.getElementById('counts-stat'),
  countsSub: document.getElementById('counts-sub'),
  savingsStat: document.getElementById('savings-stat'),
  savingsSub: document.getElementById('savings-sub'),
  speedStat: document.getElementById('speed-stat'),
  speedSub: document.getElementById('speed-sub'),
  etaStat: document.getElementById('eta-stat'),
  etaSub: document.getElementById('eta-sub'),
  lifetimeFiles: document.getElementById('lifetime-files'),
  lifetimeFilesSub: document.getElementById('lifetime-files-sub'),
  lifetimeSavings: document.getElementById('lifetime-savings'),
  lifetimeSavingsSub: document.getElementById('lifetime-savings-sub'),
  lifetimeSpeed: document.getElementById('lifetime-speed'),
  lifetimeSpeedSub: document.getElementById('lifetime-speed-sub'),
  lifetimeHealth: document.getElementById('lifetime-health'),
  lifetimeHealthSub: document.getElementById('lifetime-health-sub'),
  vacuumBtn: document.getElementById('vacuum-btn'),
  overallProgressLabel: document.getElementById('overall-progress-label'),
  overallProgressBar: document.getElementById('overall-progress-bar'),
  currentFileKicker: document.getElementById('current-file-kicker'),
  currentNameHint: document.getElementById('current-name-hint'),
  currentName: document.getElementById('current-name'),
  currentPath: document.getElementById('current-path'),
  fileProgressTitle: document.getElementById('file-progress-title'),
  fileProgressLabel: document.getElementById('file-progress-label'),
  fileProgressBar: document.getElementById('file-progress-bar'),
  currentMetrics: document.getElementById('current-metrics'),
  queueList: document.getElementById('queue-list'),
  queueKicker: document.getElementById('queue-kicker'),
  queueTools: document.getElementById('queue-tools'),
  bulkTune: document.getElementById('bulk-tune'),
  bulkSaveTo: document.getElementById('bulk-save-to'),
  bulkAudioTrack: document.getElementById('bulk-audio-track'),
  bulkAudioTrackList: document.getElementById('audio-track-options'),
  bulkSaveToList: document.getElementById('path-suggestions-save'),
  applyTuneBtn: document.getElementById('apply-tune-btn'),
  applySaveBtn: document.getElementById('apply-save-btn'),
  applyAudioTrackBtn: document.getElementById('apply-audio-track-btn'),
  recentList: document.getElementById('recent-list'),
  logList: document.getElementById('log-list'),
};

let eventSource = null;
let hydratedConfig = false;
let viewer = null;
let fullQueue = [];
let activeQueue = [];
let activeQueueFetchInFlight = false;
let editableQueueVisibleCount = 50;
let queuePagingGestureConsumed = false;
let queuePagingIntent = false;
let queuePagingGestureTimer = null;
let recentVisibleCount = 50;
let logVisibleCount = 50;
let pagedListsStartedAt = null;
let selectedTargets = new Set();
let lastState = null;
let queueFetchInFlight = false;
let lastQueueRenderKey = '';
let dragState = null;
const pathSuggestTimers = new Map();
const QUEUE_DRAG_SCROLL_EDGE = 72;
const QUEUE_DRAG_SCROLL_STEP = 28;
const LIST_PAGE_SIZE = 50;
const ACTIVE_QUEUE_PAGE_SIZE = LIST_PAGE_SIZE;

function renderPathSuggestions(menuEl, suggestions, activeIndex = -1) {
  if (!menuEl) return;
  const safeSuggestions = Array.isArray(suggestions) ? suggestions : [];
  if (!safeSuggestions.length) {
    menuEl.innerHTML = '';
    menuEl.hidden = true;
    return;
  }
  menuEl.hidden = false;
  menuEl.innerHTML = safeSuggestions.map((value, index) => `
    <button
      type="button"
      class="path-suggestion-item${index === activeIndex ? ' is-active' : ''}"
      data-path-value="${escapeHtml(value)}"
      title="${escapeHtml(value)}"
    >${escapeHtml(value)}</button>
  `).join('');
}

async function fetchPathSuggestions(query) {
  if (!query || query.trim().length < 1) return [];
  const data = await apiFetch(`/api/path-suggest?q=${encodeURIComponent(query)}`);
  return Array.isArray(data.suggestions) ? data.suggestions : [];
}

function wirePathAutocomplete(inputEl, menuEl) {
  if (!inputEl || !menuEl) return;
  let suggestions = [];
  let activeIndex = -1;
  let requestId = 0;

  const closeMenu = () => {
    activeIndex = -1;
    suggestions = [];
    renderPathSuggestions(menuEl, [], -1);
  };

  const applySuggestion = value => {
    const endsWithSlash = /[\\/]$/.test(value);
    inputEl.value = endsWithSlash ? value : `${value}/`;
    inputEl.focus();
    inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
    loadSuggestions(inputEl.value.trim());
  };

  const revealActiveSuggestion = () => {
    const activeEl = menuEl.querySelector('.path-suggestion-item.is-active');
    if (!(activeEl instanceof HTMLElement)) return;
    activeEl.scrollIntoView({ block: 'nearest' });
  };

  const redraw = () => {
    renderPathSuggestions(menuEl, suggestions, activeIndex);
    revealActiveSuggestion();
  };

  const loadSuggestions = async value => {
    const nextRequestId = requestId + 1;
    requestId = nextRequestId;
    if (!value) {
      closeMenu();
      return;
    }
    try {
      const nextSuggestions = await fetchPathSuggestions(value);
      if (requestId !== nextRequestId) return;
      suggestions = nextSuggestions;
      activeIndex = suggestions.length ? 0 : -1;
      redraw();
    } catch {
      if (requestId !== nextRequestId) return;
      closeMenu();
    }
  };

  const schedule = () => {
    const value = inputEl.value.trim();
    const existing = pathSuggestTimers.get(inputEl);
    if (existing) clearTimeout(existing);
    pathSuggestTimers.set(inputEl, setTimeout(async () => {
      await loadSuggestions(value);
    }, 150));
  };

  menuEl.addEventListener('mousedown', event => {
    event.preventDefault();
  });
  menuEl.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target.closest('[data-path-value]') : null;
    if (!(target instanceof HTMLElement)) return;
    const value = target.dataset.pathValue;
    if (!value) return;
    applySuggestion(value);
  });

  inputEl.addEventListener('input', schedule);
  inputEl.addEventListener('focus', schedule);
  inputEl.addEventListener('blur', () => {
    window.setTimeout(() => closeMenu(), 120);
  });
  inputEl.addEventListener('keydown', event => {
    if (!suggestions.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      activeIndex = Math.min(suggestions.length - 1, activeIndex + 1);
      redraw();
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      activeIndex = Math.max(0, activeIndex - 1);
      redraw();
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      activeIndex = 0;
      redraw();
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      activeIndex = suggestions.length - 1;
      redraw();
      return;
    }
    if (event.key === 'Enter' && activeIndex >= 0 && activeIndex < suggestions.length) {
      event.preventDefault();
      applySuggestion(suggestions[activeIndex]);
      return;
    }
    if (event.key === 'Escape') {
      closeMenu();
    }
  });
}

function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

function formatPct(value) {
  return value == null || Number.isNaN(Number(value)) ? 'N/A' : `${Number(value).toFixed(1)}%`;
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

function formatHms(totalSeconds) {
  if (totalSeconds == null || totalSeconds === '') return 'N/A';
  const safe = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const days = Math.floor(safe / 86400);
  const hours = Math.floor((safe % 86400) / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  if (days > 0) return `${days} ${days === 1 ? 'day' : 'days'} ${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatDate(iso) {
  if (!iso) return 'N/A';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'N/A';
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${day}/${month}/${year}, ${hours}:${minutes}:${seconds}`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showScreen(name) {
  els.loginScreen.style.display = name === 'login' ? 'flex' : 'none';
  els.blockedScreen.style.display = name === 'blocked' ? 'flex' : 'none';
  els.appScreen.style.display = name === 'app' ? 'block' : 'none';
}

function setConfigInputs(config, force = false) {
  if (hydratedConfig && !force) return;
  els.sourceRoot.value = config.sourceRoot || '.';
  els.outRoot.value = config.outRoot || '~/Videos';
  els.tune.value = config.tune || 'film';
  els.preset.value = config.preset || 'slow';
  els.mbPerMin.value = config.mbPerMin ?? 10;
  els.mbStep.value = config.mbStep ?? 50;
  els.audioKbit.value = config.audioKbit ?? 192;
  els.minVideoKbit.value = config.minVideoKbit ?? 300;
  els.overheadPct.value = config.overheadPct ?? 1;
  els.encThreads.value = config.encThreads ?? 0;
  hydratedConfig = true;
}

function configFromForm() {
  return {
    sourceRoot: els.sourceRoot.value.trim(),
    outRoot: els.outRoot.value.trim(),
    tune: els.tune.value.trim(),
    preset: els.preset.value.trim(),
    mbPerMin: Number(els.mbPerMin.value),
    mbStep: Number(els.mbStep.value),
    audioKbit: Number(els.audioKbit.value),
    minVideoKbit: Number(els.minVideoKbit.value),
    overheadPct: Number(els.overheadPct.value),
    encThreads: Number(els.encThreads.value),
  };
}

function metricCard(label, value, wide = false) {
  const cls = wide ? 'metric-card metric-wide' : 'metric-card';
  return `<article class="${cls}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`;
}

function describeAudioTrack(track) {
  const parts = [`${track.index}`];
  if (track.language) parts.push(String(track.language).toUpperCase());
  if (track.codec) parts.push(track.codec);
  if (track.channels) parts.push(`${track.channels}ch`);
  if (track.title) parts.push(track.title);
  return parts.join(' · ');
}

function audioTrackSummary(audioTracks, selectedTrack) {
  const tracks = Array.isArray(audioTracks) ? audioTracks : [];
  if (tracks.some(track => track && track.mixed)) {
    const layouts = tracks.filter(track => track && track.mixed).flatMap(track => track.layouts || []);
    const layoutSummary = layouts.length
      ? layouts.map(layout => `${layout.count} file(s): ${layout.label}`).join(' | ')
      : 'mixed track layouts';
    return {
      selected: String(selectedTrack ?? 'mixed'),
      available: layoutSummary,
      title: layouts.length
        ? layouts.map(layout => `${layout.count} file(s): ${layout.label}`).join('\n')
        : 'Files in this folder do not all have the same audio track layout. Choose a language like eng/jpn to resolve per file, or open/select files individually.',
    };
  }
  if (!tracks.length) {
    return {
      selected: String(selectedTrack ?? 0),
      available: 'tracks unknown',
      title: 'Available audio tracks have not been probed for this file yet.',
    };
  }
  const selected = tracks.find(track => Number(track.index) === Number(selectedTrack));
  const available = tracks.map(track => describeAudioTrack(track)).join(' | ');
  return {
    selected: selected ? describeAudioTrack(selected) : String(selectedTrack ?? 0),
    available,
    title: tracks.map(track => `audio ${describeAudioTrack(track)}`).join('\n'),
  };
}

function updateAudioTrackOptions(queue = fullQueue) {
  if (!els.bulkAudioTrackList) return;
  const optionMap = new Map();
  for (const item of Array.isArray(queue) ? queue : []) {
    for (const track of Array.isArray(item.audioTracks) ? item.audioTracks : []) {
      if (!track || track.mixed) continue;
      if (track.language) {
        const language = String(track.language).trim().toLowerCase();
        optionMap.set(language, `language ${String(track.language).trim().toUpperCase()}`);
      }
      if (track.index != null) {
        optionMap.set(String(track.index), `track ${track.index}`);
      }
    }
  }
  els.bulkAudioTrackList.innerHTML = [...optionMap.entries()]
    .sort(([a], [b]) => {
      const aNum = /^\d+$/.test(a);
      const bNum = /^\d+$/.test(b);
      if (aNum !== bNum) return aNum ? 1 : -1;
      return a.localeCompare(b, undefined, { numeric: true });
    })
    .map(([value, label]) => `<option value="${escapeHtml(value)}" label="${escapeHtml(label)}"></option>`)
    .join('');
}

function audioTrackLayoutKey(audioTracks) {
  const tracks = Array.isArray(audioTracks) ? audioTracks : [];
  if (!tracks.length) return '';
  return tracks
    .map(track => [
      track.index ?? '',
      track.language || '',
      track.codec || '',
      track.channels ?? '',
      track.title || '',
    ].join(':'))
    .join('|');
}

function sharedFolderAudioTracks(audioTrackLists) {
  const lists = (audioTrackLists || []).filter(list => Array.isArray(list) && list.length);
  if (!lists.length) return [];
  const firstKey = audioTrackLayoutKey(lists[0]);
  if (lists.every(list => audioTrackLayoutKey(list) === firstKey)) {
    return lists[0];
  }
  const layoutMap = new Map();
  for (const list of lists) {
    const key = audioTrackLayoutKey(list);
    const label = list.map(track => describeAudioTrack(track)).join(' | ');
    const current = layoutMap.get(key) || { count: 0, label };
    current.count += 1;
    layoutMap.set(key, current);
  }
  return [{ mixed: true, layouts: [...layoutMap.values()] }];
}

function getQueueSelectionUnits(queue = fullQueue, state = lastState) {
  const sourceRoot = state?.config?.sourceRoot || '';
  const units = [];
  const folderMap = new Map();

  for (const item of queue) {
    const relDirRaw = sourceRoot ? (item.path === sourceRoot ? '.' : item.path.startsWith(`${sourceRoot}${'/'}`) ? item.path.slice(sourceRoot.length + 1) : item.path) : item.path;
    const relDir = !relDirRaw || relDirRaw === item.path ? '.' : relDirRaw;
    if (relDir === '.') {
      units.push({
        key: `file:${item.fullPath}`,
        type: 'file',
        title: item.name,
        subtitle: item.path,
        hoverPath: item.path,
        filePaths: [item.fullPath],
        tune: item.tune || 'film',
        saveTo: item.saveTo || item.path,
        audioTrack: item.audioTrack ?? 0,
        audioTracks: item.audioTracks || [],
        status: item.status || 'pending',
      });
      continue;
    }

    let unit = folderMap.get(relDir);
    if (!unit) {
      unit = {
        key: `dir:${relDir}`,
        type: 'folder',
        title: relDir,
        subtitle: item.path,
        hoverPath: item.path,
        filePaths: [],
        tuneValues: new Set(),
        saveValues: new Set(),
        audioTrackValues: new Set(),
        audioTrackLists: [],
        statuses: new Set(),
      };
      folderMap.set(relDir, unit);
      units.push(unit);
    }
    unit.filePaths.push(item.fullPath);
    unit.tuneValues.add(item.tune || 'film');
    unit.saveValues.add(item.saveTo || item.path);
    unit.audioTrackValues.add(item.audioTrack ?? 0);
    unit.audioTrackLists.push(item.audioTracks || []);
    unit.statuses.add(item.status || 'pending');
  }

  return units.map(unit => {
    if (unit.type === 'file') return unit;
    const tune = unit.tuneValues.size === 1 ? [...unit.tuneValues][0] : 'mixed';
    const saveTo = unit.saveValues.size === 1 ? [...unit.saveValues][0] : 'mixed';
    const audioTrack = unit.audioTrackValues.size === 1 ? [...unit.audioTrackValues][0] : 'mixed';
    const status = unit.statuses.size === 1 ? [...unit.statuses][0] : 'mixed';
    return {
      key: unit.key,
      type: unit.type,
      title: unit.title,
      subtitle: `${unit.subtitle} • ${unit.filePaths.length} file(s)`,
      hoverPath: unit.hoverPath,
      filePaths: unit.filePaths,
      tune,
      saveTo,
      audioTrack,
      audioTracks: sharedFolderAudioTracks(unit.audioTrackLists),
      status,
    };
  });
}

function getSelectedQueueFilePaths() {
  const units = getQueueSelectionUnits();
  const selected = [];
  for (const unit of units) {
    if (!selectedTargets.has(unit.key)) continue;
    selected.push(...unit.filePaths);
  }
  return [...new Set(selected)];
}

function getQueueUnitOrder(queue = fullQueue, state = lastState) {
  return getQueueSelectionUnits(queue, state).map(unit => unit.key);
}

function reorderQueueUnits(queue, fromKey, toKey) {
  const units = getQueueSelectionUnits(queue);
  const fromIndex = units.findIndex(unit => unit.key === fromKey);
  const toIndex = units.findIndex(unit => unit.key === toKey);
  if (fromIndex < 0 || toIndex < 0 || fromIndex == toIndex) return null;

  const orderedUnits = [...units];
  const [movedUnit] = orderedUnits.splice(fromIndex, 1);
  orderedUnits.splice(toIndex, 0, movedUnit);

  const itemsByPath = new Map(queue.map(item => [item.fullPath, item]));
  return orderedUnits.flatMap(unit => unit.filePaths.map(filePath => ({ ...itemsByPath.get(filePath) }))).filter(Boolean);
}

async function persistQueueOrder(order) {
  els.formError.textContent = '';
  const data = await apiFetch('/api/queue', {
    method: 'POST',
    body: JSON.stringify({ order }),
  });
  setFullQueue(data.queue || []);
  render(data.state);
}

function updateQueueDragMarkers() {
  const items = els.queueList.querySelectorAll('[data-unit-key]');
  items.forEach(item => {
    const key = item.getAttribute('data-unit-key') || '';
    item.classList.toggle('queue-item-dragging', Boolean(dragState && dragState.dragKey === key));
    item.classList.toggle('queue-item-drop-target', Boolean(dragState && dragState.overKey === key && dragState.dragKey !== key));
  });
}

function clearQueueDragState() {
  dragState = null;
  updateQueueDragMarkers();
}

function autoScrollQueueDuringDrag(clientY) {
  const bounds = els.queueList.getBoundingClientRect();
  if (!bounds.height) return;
  const topDistance = clientY - bounds.top;
  const bottomDistance = bounds.bottom - clientY;
  if (topDistance >= 0 && topDistance < QUEUE_DRAG_SCROLL_EDGE) {
    const intensity = 1 - (topDistance / QUEUE_DRAG_SCROLL_EDGE);
    els.queueList.scrollTop -= Math.max(10, Math.round(QUEUE_DRAG_SCROLL_STEP * intensity));
    return;
  }
  if (bottomDistance >= 0 && bottomDistance < QUEUE_DRAG_SCROLL_EDGE) {
    const intensity = 1 - (bottomDistance / QUEUE_DRAG_SCROLL_EDGE);
    els.queueList.scrollTop += Math.max(10, Math.round(QUEUE_DRAG_SCROLL_STEP * intensity));
  }
}

function setFullQueue(queue) {
  fullQueue = Array.isArray(queue) ? queue.map(item => ({ ...item })) : [];
  editableQueueVisibleCount = ACTIVE_QUEUE_PAGE_SIZE;
  updateAudioTrackOptions(fullQueue);
  const valid = new Set(getQueueSelectionUnits().map(unit => unit.key));
  selectedTargets = new Set([...selectedTargets].filter(key => valid.has(key)));
}

function clearQueueSelection() {
  selectedTargets.clear();
}

function mergeQueueItems(existing, incoming) {
  const merged = Array.isArray(existing) ? existing.map(item => ({ ...item })) : [];
  const indexByPath = new Map(merged.map((item, index) => [item.fullPath, index]));
  for (const item of Array.isArray(incoming) ? incoming : []) {
    if (!item?.fullPath) continue;
    const index = indexByPath.get(item.fullPath);
    if (index == null) {
      indexByPath.set(item.fullPath, merged.length);
      merged.push({ ...item });
    } else {
      merged[index] = { ...merged[index], ...item };
    }
  }
  return merged;
}

function resetActiveQueue(queue = []) {
  activeQueue = Array.isArray(queue) ? queue.map(item => ({ ...item })) : [];
}

function getRenderedQueue(state) {
  if (!state) return [];
  if (state.active && activeQueue.length) return activeQueue;
  if (!state.active && fullQueue.length) return fullQueue;
  return state.queue || [];
}

function getQueueRenderKey(state) {
  const queue = getRenderedQueue(state);
  const active = Boolean(state?.active);
  const queueInfo = state?.queueInfo || {};
  const selectionKey = active ? '' : [...selectedTargets].sort().join('|');
  const dragKey = dragState?.dragKey || '';
  const overKey = dragState?.overKey || '';
  const queueKey = (queue || []).map(item => [
    item.fullPath,
    item.status || '',
    item.tune || '',
    item.saveTo || '',
    item.audioTrack ?? 0,
  ].join('~')).join('||');
  return [
    active ? '1' : '0',
    queueInfo.total || 0,
    queueInfo.hidden || 0,
    active ? '' : editableQueueVisibleCount,
    selectionKey,
    dragKey,
    overKey,
    queueKey,
  ].join('::');
}

function renderCurrentFile(current, progress, status) {
  if (!current) {
    els.currentFileKicker.textContent = 'Waiting for a job';
    els.currentName.textContent = 'No active file';
    els.currentNameHint.setAttribute('data-name-hint', 'No active file');
    els.currentPath.textContent = '';
    els.fileProgressTitle.textContent = 'File progress';
    els.fileProgressLabel.textContent = '0.0%';
    els.fileProgressBar.style.width = '0%';
    els.currentMetrics.innerHTML = [
      metricCard('File', 'N/A'),
      metricCard('Input size | Target size | Length', 'N/A'),
      metricCard('Pass', status === 'done' ? 'Done' : 'N/A'),
      metricCard('Speed / Frame rate', 'N/A'),
      metricCard('Frames', 'N/A'),
      metricCard('File ETA / Finish time', 'N/A'),
      metricCard('File size', 'N/A', true),
    ].join('');
    return;
  }

  const overallPct = Number(progress.overallPct || 0).toFixed(2);
  const fileSizeLine = `${formatSize(current.fileSizeBytes)} (current savings ${formatSize(current.savingsBytes)} / ${formatPct(current.savingsPct)}, estimated ${current.estimatedSizeMb || current.targetSizeMb} MB, estimated savings ${formatPct(current.estimatedSavingsPct)}, bitrate ${current.bitrateKbps ? `${Number(current.bitrateKbps).toFixed(1)} kbps` : 'N/A'})`;
  const isMoving = current.phase === 'moving';

  els.currentFileKicker.textContent = `File ${current.index} / ${current.total} • Pass ${String(current.passLabel || 'N/A').replace('/', ' / ')}`;
  els.currentName.textContent = current.name;
  els.currentNameHint.setAttribute('data-name-hint', current.name);
  els.currentPath.textContent = '';
  els.fileProgressTitle.textContent = isMoving ? 'Move progress' : 'File progress';
  els.fileProgressLabel.textContent = `${Number(current.fileProgressPct || 0).toFixed(1)}%`;
  els.fileProgressBar.style.width = `${Math.max(0, Math.min(100, Number(current.fileProgressPct || 0)))}%`;

  els.currentMetrics.innerHTML = [
    metricCard('File', `${current.index} / ${current.total} (${overallPct}%)`),
    metricCard('Input size | Target size | Length', `${formatSize(current.srcSizeBytes)} | ${current.targetSizeMb} MB | ${formatHms(current.durationSeconds)}`),
    metricCard('Pass', String(current.passLabel || 'N/A').replace('/', ' / ')),
    metricCard('Speed / Frame rate', `${current.speed || 'N/A'} | ${current.fps || 'N/A'} FPS`),
    metricCard('Frames', `${current.frame || 'N/A'} / ${current.totalFrames || 'N/A'}`),
    metricCard('File ETA / Finish time', `${formatHms(current.fileRemainingSeconds)} | ${formatDate(current.finishTimeIso)}`),
    metricCard('File size', fileSizeLine, true),
  ].join('');
}

function renderQueue(queue, info = {}, active = false) {
  const isEditable = !active;
  if (isEditable) updateAudioTrackOptions(Array.isArray(queue) ? queue : []);
  const allEditableUnits = isEditable ? getQueueSelectionUnits(queue) : [];
  const editableUnits = isEditable ? allEditableUnits.slice(0, editableQueueVisibleCount) : [];
  const dragKey = dragState?.dragKey || '';
  const overKey = dragState?.overKey || '';
  const liveCount = Array.isArray(queue) ? queue.length : 0;
  const hidden = isEditable
    ? Math.max(0, allEditableUnits.length - editableUnits.length)
    : Math.max(0, Number(info.hidden || 0));
  const total = isEditable ? allEditableUnits.length : liveCount + hidden;
  const visibleCount = isEditable ? editableUnits.length : liveCount;
  els.queueKicker.textContent = total > 0
    ? `Showing ${visibleCount}${isEditable ? ' selectable item(s)' : ` of ${total}`}${hidden > 0 ? ` • ${hidden} hidden` : ''}`
    : 'Pending and in-flight files';

  els.queueTools.style.display = isEditable ? 'block' : 'none';

  if (!(isEditable ? editableUnits.length : queue.length)) {
    els.queueList.innerHTML = '<div class="empty-state">Load a source folder to build the editable queue before starting the batch.</div>';
    return;
  }

  const renderItems = isEditable ? editableUnits : queue.map(item => ({
    key: item.fullPath,
    type: 'file',
    title: item.name,
    subtitle: item.path,
    hoverPath: item.path,
    filePaths: [item.fullPath],
    tune: item.tune || 'film',
    saveTo: item.saveTo || item.path,
    audioTrack: item.audioTrack ?? 0,
    audioTracks: item.audioTracks || [],
    status: item.status || 'pending',
  }));

  els.queueList.innerHTML = renderItems.map(item => {
    const checked = isEditable && selectedTargets.has(item.key) ? 'checked' : '';
    const status = item.status || 'pending';
    const selectionControl = isEditable
      ? `<input type="checkbox" class="queue-check" data-target="${escapeHtml(item.key)}" ${checked}>`
      : '';
    const metaChips = isEditable
      ? `<span class="meta-chip">${item.type === 'folder' ? 'folder' : 'file'} <strong>${item.filePaths.length}</strong></span>`
      : '';
    const audioSummary = audioTrackSummary(item.audioTracks, item.audioTrack);
    const audioTitle = escapeHtml(audioSummary.title);
    const audioAvailable = item.type === 'file' || (Array.isArray(item.audioTracks) && item.audioTracks.length)
      ? `<span class="meta-chip audio-track-chip" title="${audioTitle}">available <strong>${escapeHtml(audioSummary.available)}</strong></span>`
      : '';
    const dragHandle = isEditable
      ? `<button type="button" class="queue-drag-handle" draggable="true" data-drag-key="${escapeHtml(item.key)}" aria-label="Drag to reorder" title="Drag to reorder">::</button>`
      : '';
    const removeControl = isEditable
      ? `<button type="button" class="queue-remove-btn" data-remove-key="${escapeHtml(item.key)}" aria-label="Remove from queue" title="Remove from queue">X</button>`
      : '';
    const dragClasses = [
      'list-item',
      'queue-item',
      isEditable ? '' : 'queue-item-static',
    ].filter(Boolean).join(' ');
    const hoverPath = escapeHtml(item.hoverPath || item.subtitle || '');
    return `
      <article class="${dragClasses}" ${isEditable ? `data-unit-key="${escapeHtml(item.key)}"` : ''}>
        ${selectionControl}
        ${dragHandle}
        <div class="queue-item-body">
          <div class="list-item-head">
            <div class="list-item-title queue-title-hint" data-name-hint="${escapeHtml(item.title)}" data-path-hint="${hoverPath}"><span class="queue-title-text">${escapeHtml(item.title)}</span></div>
            <span class="badge ${escapeHtml(status)}">${escapeHtml(status)}</span>
          </div>
          <div class="queue-meta">
            ${metaChips}
            <span class="meta-chip">tune <strong>${escapeHtml(item.tune || 'film')}</strong></span>
            <span class="meta-chip" title="${audioTitle}">audio <strong>${escapeHtml(audioSummary.selected)}</strong></span>
            ${audioAvailable}
            <span class="meta-chip">save to <strong>${escapeHtml(item.saveTo || item.subtitle)}</strong></span>
          </div>
        </div>
        ${removeControl}
      </article>
    `;
  }).join('');
  updateQueueDragMarkers();
}

function renderRecent(list) {
  if (!list.length) {
    els.recentList.innerHTML = '<div class="empty-state">Encoded files will collect here in reverse chronological order.</div>';
    return;
  }
  els.recentList.innerHTML = [...list].reverse().slice(0, recentVisibleCount).map(item => `
    <article class="list-item">
      <div class="list-item-head">
        <div class="list-item-title">${escapeHtml(item)}</div>
        <span class="badge encoded">done</span>
      </div>
    </article>
  `).join('');
}

function renderLog(events) {
  if (!events.length) {
    els.logList.innerHTML = '<div class="empty-state">State changes, skips, failures, and completion messages will appear here.</div>';
    return;
  }
  els.logList.innerHTML = [...events].reverse().slice(0, logVisibleCount).map(item => `
    <article class="log-item">
      <div class="log-item-head">
        <strong>${escapeHtml(item.message)}</strong>
        <span class="badge ${escapeHtml(item.kind)}">${escapeHtml(item.kind)}</span>
      </div>
      <div class="log-item-sub">${escapeHtml(formatDate(item.time))}</div>
    </article>
  `).join('');
}

function renderLifetime(lifetime) {
  els.lifetimeFiles.textContent = String(lifetime.encodedTotal || 0);
  els.lifetimeFilesSub.textContent = `encoded: ${lifetime.encodedTotal || 0}, skipped: ${lifetime.skippedTotal || 0}, failed: ${lifetime.failedTotal || 0}`;
  els.lifetimeSavings.textContent = formatSize(lifetime.savingsBytes || 0);
  const averageSavings = lifetime.averageSavingsBytes == null ? 'average savings/file: N/A' : `average savings/file: ${formatSize(lifetime.averageSavingsBytes)}`;
  const totalPct = lifetime.savingsPct == null ? 'total: N/A' : `total: ${formatPct(lifetime.savingsPct)}`;
  els.lifetimeSavingsSub.innerHTML = `${escapeHtml(averageSavings)}<br>${escapeHtml(totalPct)}`;
  els.lifetimeSpeed.textContent = lifetime.completedSpeedX == null ? 'N/A' : `${Number(lifetime.completedSpeedX).toFixed(2)}x`;
  const bitrate = lifetime.averageBitrateKbps == null ? 'average bitrate: N/A' : `average bitrate: ${Number(lifetime.averageBitrateKbps).toFixed(1)} kbps`;
  const filesPerRun = lifetime.averageFilesPerRun == null ? 'average files/run: N/A' : `average files/run: ${Number(lifetime.averageFilesPerRun).toFixed(1)}`;
  els.lifetimeSpeedSub.innerHTML = `${escapeHtml(bitrate)}<br>${escapeHtml(filesPerRun)}`;
  els.lifetimeHealth.textContent = formatSize(lifetime.dbSize || 0);
  const lastActivity = lifetime.lastActivityAt ? formatDate(new Date(lifetime.lastActivityAt * 1000).toISOString()) : 'N/A';
  els.lifetimeHealthSub.textContent = `last activity ${lastActivity}`;
}

function sanitizeHeroMessage(message) {
  return String(message || 'Ready.').replace(/\s+\(audio track \d+\)$/i, '');
}

function updateDocumentTitle(state) {
  const baseTitle = 'FFmpeg Batch Encode';
  if (!state) {
    document.title = baseTitle;
    return;
  }
  const overall = Number(state.progress?.overallPct || 0).toFixed(2);
  if (state.status === 'paused') {
    document.title = `Paused • ${overall}% • ${baseTitle}`;
    return;
  }
  if (state.status === 'running' || state.active) {
    document.title = `${overall}% • ${baseTitle}`;
    return;
  }
  if (state.status === 'error') {
    document.title = `Error • ${baseTitle}`;
    return;
  }
  document.title = baseTitle;
}

function render(state, options = {}) {
  lastState = state;
  viewer = state.viewer || viewer;
  if (state.startedAt && state.startedAt !== pagedListsStartedAt) {
    pagedListsStartedAt = state.startedAt;
    recentVisibleCount = LIST_PAGE_SIZE;
    logVisibleCount = LIST_PAGE_SIZE;
  }
  setConfigInputs(state.config || {});
  updateDocumentTitle(state);
  const machineName = state.app?.machineName || '';
  const cpuCount = Number(state.app?.cpuCount || 0);
  if (els.appEyebrow) {
    els.appEyebrow.textContent = `Client + Server Encode Dashboard - version ${state.app?.version || 'N/A'}`;
  }
  els.machineChip.textContent = machineName;
  els.machineChip.style.display = machineName ? 'inline-flex' : 'none';
  els.viewerChip.textContent = viewer ? `${viewer.username}` : '';
  els.encThreadsLabel.textContent = cpuCount > 0 ? `Threads (${cpuCount} available)` : 'Threads';
  els.statusPill.textContent = state.status;
  els.statusPill.className = `status-pill${state.status === 'running' ? ' running' : ''}${state.status === 'paused' ? ' paused' : ''}`;
  const heroMessage = sanitizeHeroMessage(state.message);
  els.heroMetaText.textContent = heroMessage;
  els.heroMeta.setAttribute('data-full-text', heroMessage);
  els.heroMeta.className = `hero-meta hero-meta-hint${state.message === 'Will stop after current file completes.' ? ' hero-meta-warning' : ''}`;
  els.foundLabel.textContent = state.scan?.found ? `${state.scan.found} file(s) found` : 'No scan yet';

  const total = state.counts?.total || 0;
  const done = state.counts?.completed || 0;
  els.countsStat.textContent = `${done} / ${total}`;
  els.countsSub.textContent = `encoded: ${state.counts?.encoded || 0}, skipped: ${state.counts?.skipped || 0}, failed: ${state.counts?.failed || 0}`;

  els.savingsStat.textContent = formatSize(state.totals?.savingsBytes || 0);
  const totalSavingsPct = state.totals?.savingsPct == null ? 'N/A' : formatPct(state.totals.savingsPct);
  els.savingsSub.innerHTML = `${escapeHtml(state.totals?.averageSavingsLabel || 'average savings/file: N/A')}<br>${escapeHtml(totalSavingsPct === 'N/A' ? 'total: N/A' : `total: ${totalSavingsPct}`)}`;

  els.speedStat.textContent = state.totals?.currentSpeedX == null ? 'N/A' : `${Number(state.totals.currentSpeedX).toFixed(2)}x`;
  els.speedSub.textContent = state.totals?.averageBitrateKbps == null ? 'average bitrate: N/A' : `average bitrate: ${Number(state.totals.averageBitrateKbps).toFixed(1)} kbps`;

  els.etaStat.textContent = state.progress?.remainingSeconds == null ? 'N/A' : formatHms(state.progress.remainingSeconds);
  els.etaSub.textContent = state.progress?.etaIso ? `finish time: ${formatDate(state.progress.etaIso)}` : 'need 1 completed encode';

  const overall = Number(state.progress?.overallPct || 0);
  els.overallProgressLabel.textContent = `${overall.toFixed(2)}%`;
  els.overallProgressBar.style.width = `${Math.max(0, Math.min(100, overall))}%`;

  renderCurrentFile(state.currentFile, state.progress || {}, state.status);
  const renderedQueue = getRenderedQueue(state);
  const renderedQueueInfo = state.active
    ? {
        ...(state.queueInfo || {}),
        visible: renderedQueue.length,
        hidden: Math.max(0, Number(state.queueInfo?.total || renderedQueue.length) - renderedQueue.length),
      }
    : (state.queueInfo || {});
  const queueRenderKey = getQueueRenderKey(state);
  if (options.forceQueue || queueRenderKey !== lastQueueRenderKey) {
    renderQueue(renderedQueue, renderedQueueInfo, Boolean(state.active));
    lastQueueRenderKey = queueRenderKey;
  }
  renderRecent(state.recentCompleted || []);
  renderLog(state.recentEvents || []);
  renderLifetime(state.lifetime || {});

  const active = Boolean(state.active);
  if (!active && state.status === 'error' && state.message) {
    els.formError.textContent = state.message;
  } else if (active && els.formError.textContent === state.message) {
    els.formError.textContent = '';
  }
  [
    els.sourceRoot,
    els.outRoot,
    els.tune,
    els.preset,
    els.mbPerMin,
    els.mbStep,
    els.audioKbit,
    els.minVideoKbit,
    els.overheadPct,
    els.encThreads,
  ].forEach(input => {
    input.disabled = active;
  });
  els.scanBtn.disabled = active;
  els.startBtn.disabled = active;
  const gracefulStopRequested = Boolean(state.stopAfterCurrent);
  const paused = Boolean(state.paused);
  const movingFile = Boolean(state.currentFile && state.currentFile.phase === 'moving');
  els.pauseLabel.textContent = paused ? 'Resume batch' : 'Pause batch';
  els.pauseBtn.disabled = !active || movingFile;
  els.pauseBtn.textContent = paused ? 'Resume' : 'Pause';
  els.pauseBtn.className = `ghost-btn small-btn pause-btn ${paused ? 'pause-resume' : 'pause-pause'}`;
  els.stopAfterBtn.disabled = !active;
  els.stopAfterBtn.textContent = gracefulStopRequested ? 'Disable' : 'Enable';
  els.stopAfterBtn.className = `ghost-btn small-btn stop-after-btn ${gracefulStopRequested ? 'stop-after-disable' : 'stop-after-enable'}`;
  els.stopBtn.disabled = !active;
  els.applyTuneBtn.disabled = active || selectedTargets.size === 0;
  els.applySaveBtn.disabled = active || selectedTargets.size === 0;
  els.applyAudioTrackBtn.disabled = active || selectedTargets.size === 0;
  els.vacuumBtn.disabled = active;
}

async function apiFetch(url, options = {}) {
  const token = getToken();
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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

function closeEvents() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
}

async function fetchFullQueue() {
  if (queueFetchInFlight) return;
  queueFetchInFlight = true;
  try {
    const data = await apiFetch('/api/queue');
    setFullQueue(data.queue || []);
    if (data.state) render(data.state);
  } finally {
    queueFetchInFlight = false;
  }
}

async function fetchNextActiveQueuePage() {
  const total = Number(lastState?.queueInfo?.total || 0);
  if (!lastState?.active || activeQueueFetchInFlight || !total || activeQueue.length >= total) return;
  activeQueueFetchInFlight = true;
  try {
    const data = await apiFetch(`/api/queue?offset=${activeQueue.length}&limit=${ACTIVE_QUEUE_PAGE_SIZE}`);
    activeQueue = mergeQueueItems(activeQueue, data.queue || []);
    if (data.state) {
      lastState = { ...lastState, ...data.state };
    }
    if (lastState) render(lastState, { forceQueue: true });
  } finally {
    activeQueueFetchInFlight = false;
  }
}

function showNextEditableQueuePage() {
  if (lastState?.active) return;
  const total = getQueueSelectionUnits(fullQueue).length;
  if (editableQueueVisibleCount >= total) return;
  editableQueueVisibleCount = Math.min(total, editableQueueVisibleCount + ACTIVE_QUEUE_PAGE_SIZE);
  if (lastState) render(lastState, { forceQueue: true });
}

function beginQueuePagingGesture() {
  if (!queuePagingGestureConsumed) queuePagingIntent = true;
  if (queuePagingGestureTimer) clearTimeout(queuePagingGestureTimer);
  queuePagingGestureTimer = setTimeout(() => {
    queuePagingGestureConsumed = false;
    queuePagingIntent = false;
  }, 350);
}

function loadQueuePageAtScrollEnd() {
  if (!queuePagingIntent || queuePagingGestureConsumed) return;
  const remaining = els.queueList.scrollHeight - els.queueList.scrollTop - els.queueList.clientHeight;
  if (remaining >= 120) return;
  queuePagingGestureConsumed = true;
  queuePagingIntent = false;
  if (lastState?.active) {
    fetchNextActiveQueuePage().catch(error => {
      els.formError.textContent = error.message;
    });
    return;
  }
  showNextEditableQueuePage();
}

function wirePagedList(listEl, hasMore, showNext) {
  let gestureConsumed = false;
  let pagingIntent = false;
  let gestureTimer = null;

  const beginGesture = () => {
    if (!gestureConsumed) pagingIntent = true;
    if (gestureTimer) clearTimeout(gestureTimer);
    gestureTimer = setTimeout(() => {
      gestureConsumed = false;
      pagingIntent = false;
    }, 350);
  };

  const loadAtBottom = () => {
    if (!pagingIntent || gestureConsumed || !hasMore()) return;
    const remaining = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight;
    if (remaining >= 120) return;
    gestureConsumed = true;
    pagingIntent = false;
    showNext();
  };

  listEl.addEventListener('scroll', loadAtBottom);
  listEl.addEventListener('wheel', () => {
    beginGesture();
    setTimeout(loadAtBottom, 0);
  }, { passive: true });
  listEl.addEventListener('pointerdown', beginGesture);
  listEl.addEventListener('touchmove', beginGesture, { passive: true });
}

function openEvents() {
  closeEvents();
  const token = encodeURIComponent(getToken());
  eventSource = new EventSource(`/api/events?token=${token}`);
  eventSource.onmessage = event => {
    const nextState = JSON.parse(event.data);
    if (nextState.active) {
      if (!lastState?.active || !activeQueue.length || Number(nextState.queueInfo?.total || 0) !== Number(lastState?.queueInfo?.total || 0)) {
        resetActiveQueue(nextState.queue || []);
      } else {
        activeQueue = mergeQueueItems(activeQueue, nextState.queue || []);
      }
      fullQueue = [];
      clearQueueSelection();
    } else if (lastState?.active) {
      resetActiveQueue([]);
    }
    render(nextState);
    if (!nextState.active && (nextState.queueInfo?.total || 0) > 0 && fullQueue.length !== nextState.queueInfo.total) {
      fetchFullQueue().catch(() => {});
    }
    if (!nextState.active && (nextState.queueInfo?.total || 0) === 0 && fullQueue.length) {
      setFullQueue([]);
      clearQueueSelection();
      render(nextState);
    }
  };
  eventSource.onerror = () => {
    closeEvents();
    els.heroMetaText.textContent = 'Live updates disconnected. Refresh or log in again.';
    els.heroMeta.setAttribute('data-full-text', 'Live updates disconnected. Refresh or log in again.');
  };
}

async function handleAuth(endpoint) {
  els.authError.textContent = '';
  try {
    const data = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: els.authUsername.value.trim(),
        password: els.authPassword.value,
      }),
    }).then(async response => {
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Request failed');
      return body;
    });
    setToken(data.token);
    viewer = { username: data.username, canUseApp: data.canUseApp };
    if (!data.canUseApp) {
      showScreen('blocked');
      return;
    }
    showScreen('app');
    await hydrateApp();
  } catch (error) {
    els.authError.textContent = error.message;
  }
}

async function logout() {
  try {
    await apiFetch('/api/logout', { method: 'POST' });
  } catch {}
  closeEvents();
  clearToken();
  viewer = null;
  setFullQueue([]);
  resetActiveQueue([]);
  clearQueueSelection();
  showScreen('login');
}

async function hydrateApp() {
  const me = await apiFetch('/api/me');
  viewer = { username: me.username, canUseApp: me.canUseApp };
  if (!me.canUseApp) {
    showScreen('blocked');
    return;
  }
  showScreen('app');
  const state = await apiFetch('/api/state');
  render(state);
  if (!state.active && (state.queueInfo?.total || 0) > 0) {
    await fetchFullQueue();
  } else {
    setFullQueue([]);
    if (!state.active) resetActiveQueue([]);
    clearQueueSelection();
  }
  openEvents();
}

async function boot() {
  const token = getToken();
  if (!token) {
    showScreen('login');
    return;
  }
  try {
    await hydrateApp();
  } catch {
    clearToken();
    showScreen('login');
  }
}

async function scanQueue() {
  els.formError.textContent = '';
  try {
    const data = await apiFetch('/api/scan', {
      method: 'POST',
      body: JSON.stringify(configFromForm()),
    });
    setFullQueue(data.queue || []);
    clearQueueSelection();
    render(data.state);
  } catch (error) {
    els.formError.textContent = error.message;
  }
}

async function startJob() {
  els.formError.textContent = '';
  try {
    const data = await apiFetch('/api/start', {
      method: 'POST',
      body: JSON.stringify(configFromForm()),
    });
    clearQueueSelection();
    if (data.state?.active) resetActiveQueue(data.state.queue || []);
    if (data.state) render(data.state);
  } catch (error) {
    els.formError.textContent = error.message;
  }
}

async function stopJob() {
  els.formError.textContent = '';
  try {
    const data = await apiFetch('/api/stop', { method: 'POST' });
    if (data.state) render(data.state);
  } catch (error) {
    els.formError.textContent = error.message;
  }
}

async function togglePauseJob() {
  els.formError.textContent = '';
  try {
    const data = await apiFetch('/api/pause-toggle', {
      method: 'POST',
      body: JSON.stringify({ enabled: !Boolean(lastState?.paused) }),
    });
    if (data.state) render(data.state);
  } catch (error) {
    els.formError.textContent = error.message;
  }
}

async function stopAfterCurrentFile() {
  els.formError.textContent = '';
  try {
    const data = await apiFetch('/api/stop-after-current', {
      method: 'POST',
      body: JSON.stringify({ enabled: !Boolean(lastState?.stopAfterCurrent) }),
    });
    if (data.state) render(data.state);
  } catch (error) {
    els.formError.textContent = error.message;
  }
}

async function vacuumDatabase() {
  els.formError.textContent = '';
  try {
    await apiFetch('/api/vacuum', { method: 'POST' });
    const state = await apiFetch('/api/state');
    render(state);
  } catch (error) {
    els.formError.textContent = error.message;
  }
}

async function applyQueuePatch(patch) {
  els.formError.textContent = '';
  const selectedFilePaths = getSelectedQueueFilePaths();
  if (!selectedFilePaths.length) {
    els.formError.textContent = 'Select one or more files or folders first.';
    return;
  }
  try {
    const data = await apiFetch('/api/queue', {
      method: 'POST',
      body: JSON.stringify({
        filePaths: selectedFilePaths,
        ...patch,
      }),
    });
    setFullQueue(data.queue || []);
    render(data.state);
  } catch (error) {
    els.formError.textContent = error.message;
  }
}

async function removeQueueFilePaths(filePaths) {
  els.formError.textContent = '';
  const selectedFilePaths = [...new Set(Array.isArray(filePaths) ? filePaths : [])];
  if (!selectedFilePaths.length) {
    els.formError.textContent = 'No queue item was selected.';
    return;
  }
  try {
    const data = await apiFetch('/api/queue', {
      method: 'POST',
      body: JSON.stringify({
        filePaths: selectedFilePaths,
        remove: true,
      }),
    });
    setFullQueue(data.queue || []);
    const removed = new Set(selectedFilePaths);
    selectedTargets = new Set([...selectedTargets].filter(key => {
      const unit = getQueueSelectionUnits().find(entry => entry.key === key);
      return unit && unit.filePaths.some(filePath => !removed.has(filePath));
    }));
    render(data.state, { forceQueue: true });
  } catch (error) {
    els.formError.textContent = error.message;
  }
}

async function removeQueueUnitByKey(key) {
  const unit = getQueueSelectionUnits().find(item => item.key === key);
  if (!unit) {
    els.formError.textContent = 'Queue item was not found.';
    return;
  }
  await removeQueueFilePaths(unit.filePaths);
}

els.loginBtn.addEventListener('click', () => handleAuth('/api/login'));
els.registerBtn.addEventListener('click', () => handleAuth('/api/register'));
els.blockedLogoutBtn.addEventListener('click', logout);
els.logoutBtn.addEventListener('click', logout);
els.scanBtn.addEventListener('click', scanQueue);
els.startBtn.addEventListener('click', startJob);
els.pauseBtn.addEventListener('click', togglePauseJob);
els.stopAfterBtn.addEventListener('click', stopAfterCurrentFile);
els.stopBtn.addEventListener('click', stopJob);
els.applyTuneBtn.addEventListener('click', () => applyQueuePatch({ tune: els.bulkTune.value.trim() }));
els.applySaveBtn.addEventListener('click', () => applyQueuePatch({ saveTo: els.bulkSaveTo.value.trim() }));
els.applyAudioTrackBtn.addEventListener('click', () => applyQueuePatch({ audioTrack: els.bulkAudioTrack.value.trim() }));
els.vacuumBtn.addEventListener('click', vacuumDatabase);
els.queueList.addEventListener('click', event => {
  if (lastState?.active) return;
  const target = event.target instanceof Element ? event.target.closest('[data-remove-key]') : null;
  if (!(target instanceof HTMLElement)) return;
  event.preventDefault();
  event.stopPropagation();
  const removeKey = target.dataset.removeKey;
  if (!removeKey) return;
  removeQueueUnitByKey(removeKey).catch(error => {
    els.formError.textContent = error.message;
  });
});
els.queueList.addEventListener('change', event => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || !target.classList.contains('queue-check')) return;
  const selectionKey = target.dataset.target;
  if (!selectionKey) return;
  if (target.checked) selectedTargets.add(selectionKey);
  else selectedTargets.delete(selectionKey);
  if (lastState) render(lastState, { forceQueue: true });
});

els.queueList.addEventListener('dragstart', event => {
  if (lastState?.active) return;
  const target = event.target;
  if (!(target instanceof HTMLElement) || !target.classList.contains('queue-drag-handle')) return;
  const dragKey = target.dataset.dragKey;
  if (!dragKey) return;
  dragState = { dragKey, overKey: dragKey };
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', dragKey);
  }
  updateQueueDragMarkers();
});

els.queueList.addEventListener('dragover', event => {
  if (!dragState || lastState?.active) return;
  autoScrollQueueDuringDrag(event.clientY);
  const target = event.target instanceof Element ? event.target.closest('[data-unit-key]') : null;
  if (!(target instanceof HTMLElement)) {
    event.preventDefault();
    return;
  }
  event.preventDefault();
  const overKey = target.dataset.unitKey;
  if (!overKey || overKey === dragState.overKey) return;
  dragState = { ...dragState, overKey };
  updateQueueDragMarkers();
});

els.queueList.addEventListener('drop', async event => {
  if (!dragState || lastState?.active) return;
  event.preventDefault();
  const target = event.target instanceof Element ? event.target.closest('[data-unit-key]') : null;
  const dropKey = target instanceof HTMLElement ? target.dataset.unitKey : dragState.overKey;
  const nextQueue = dropKey ? reorderQueueUnits(fullQueue, dragState.dragKey, dropKey) : null;
  const nextOrder = nextQueue ? nextQueue.map(item => item.fullPath) : null;
  clearQueueDragState();
  if (!nextQueue || !nextOrder) return;
  setFullQueue(nextQueue);
  if (lastState) render(lastState, { forceQueue: true });
  try {
    await persistQueueOrder(nextOrder);
  } catch (error) {
    els.formError.textContent = error.message;
    await fetchFullQueue().catch(() => {});
  }
});

els.queueList.addEventListener('dragend', () => {
  if (!dragState) return;
  clearQueueDragState();
});

els.queueList.addEventListener('scroll', () => {
  loadQueuePageAtScrollEnd();
});

els.queueList.addEventListener('wheel', () => {
  beginQueuePagingGesture();
  setTimeout(loadQueuePageAtScrollEnd, 0);
}, { passive: true });

els.queueList.addEventListener('pointerdown', beginQueuePagingGesture);
els.queueList.addEventListener('touchmove', beginQueuePagingGesture, { passive: true });

wirePagedList(
  els.recentList,
  () => recentVisibleCount < (lastState?.recentCompleted?.length || 0),
  () => {
    recentVisibleCount += LIST_PAGE_SIZE;
    renderRecent(lastState?.recentCompleted || []);
  },
);

wirePagedList(
  els.logList,
  () => logVisibleCount < (lastState?.recentEvents?.length || 0),
  () => {
    logVisibleCount += LIST_PAGE_SIZE;
    renderLog(lastState?.recentEvents || []);
  },
);

wirePathAutocomplete(els.sourceRoot, els.sourceRootList);
wirePathAutocomplete(els.outRoot, els.outRootList);
wirePathAutocomplete(els.bulkSaveTo, els.bulkSaveToList);

boot();
