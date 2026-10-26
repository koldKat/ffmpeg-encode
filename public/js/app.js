import { initThemedControls } from './themed-controls.js';
import { createActiveQueueAdder } from './active-queue-add.js';
import { buildQueueSelectionUnits } from './queue-units.js';
import { escapeHtml, formatDate, formatHms, formatPct, formatSize } from './formatters.js';
import { createPathAutocomplete } from './path-autocomplete.js';
import { createCurrentFileView } from './current-file-view.js';
import { createActivityView } from './activity-view.js';

initThemedControls();

const CLIENT_CONFIG = globalThis.FFMPEG_WEBAPP_CLIENT_CONFIG;

const TOKEN_KEY = CLIENT_CONFIG.sessionStorageKey;
const FOOTER_START_YEAR = CLIENT_CONFIG.footerStartYear;

const els = {
  sessionScreen: document.getElementById('session-screen'),
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
  appTitles: document.querySelectorAll('[data-app-name]'),
  blockedUsername: document.getElementById('blocked-username'),
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
  nice: document.getElementById('nice'),
  encThreadsLabel: document.getElementById('enc-threads-label'),
  encThreads: document.getElementById('enc-threads'),
  deleteAllSources: document.getElementById('delete-all-sources'),
  scanBtn: document.getElementById('scan-btn'),
  queueLoadProgress: document.getElementById('queue-load-progress'),
  queueLoadLabel: document.getElementById('queue-load-label'),
  queueLoadCount: document.getElementById('queue-load-count'),
  queueLoadTrack: document.getElementById('queue-load-track'),
  queueLoadBar: document.getElementById('queue-load-bar'),
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
  bulkSaveToList: document.getElementById('path-suggestions-save'),
  applyTuneBtn: document.getElementById('apply-tune-btn'),
  applySaveBtn: document.getElementById('apply-save-btn'),
  applyAudioTrackBtn: document.getElementById('apply-audio-track-btn'),
  recentList: document.getElementById('recent-list'),
  logList: document.getElementById('log-list'),
  footerCopy: document.getElementById('app-footer-copy'),
  footerBrand: document.getElementById('app-footer-brand'),
};

const currentFileView = createCurrentFileView({ els, escapeHtml, formatDate, formatHms, formatPct, formatSize });
const activityView = createActivityView({ els, escapeHtml, formatDate, formatPct, formatSize });

const footerYear = new Date().getFullYear();
els.footerCopy.textContent = footerYear > FOOTER_START_YEAR
  ? `© ${FOOTER_START_YEAR}-${footerYear}`
  : `© ${FOOTER_START_YEAR}`;

let eventSource = null;
let hydratedConfig = false;
let viewer = null;
let fullQueue = [];
let activeQueue = [];
let activeQueueFetchInFlight = false;
let queueScanInFlight = false;
let editableQueueVisibleCount = CLIENT_CONFIG.queue.initialVisibleItems;
let queuePagingGestureConsumed = false;
let queuePagingIntent = false;
let queuePagingGestureTimer = null;
let recentVisibleCount = CLIENT_CONFIG.queue.initialVisibleItems;
let logVisibleCount = CLIENT_CONFIG.queue.initialVisibleItems;
let pagedListsStartedAt = null;
let selectedTargets = new Set();
let lastState = null;
let queueFetchInFlight = false;
let lastQueueRenderKey = '';
let dragState = null;
let activeQueueAdder = null;
let deleteSourceUpdateQueue = Promise.resolve();
const QUEUE_DRAG_SCROLL_EDGE = CLIENT_CONFIG.queue.dragScrollEdgePx;
const QUEUE_DRAG_SCROLL_STEP = CLIENT_CONFIG.queue.dragScrollStepPx;
const LIST_PAGE_SIZE = CLIENT_CONFIG.queue.pageSize;
const ACTIVE_QUEUE_PAGE_SIZE = LIST_PAGE_SIZE;

function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

function setAuthorizedUsername(username) {
  if (els.blockedUsername) els.blockedUsername.textContent = username || 'the authorized user';
}

function showScreen(name) {
  document.documentElement.classList.remove('restoring-session');
  els.sessionScreen.style.display = name === 'session' ? 'flex' : 'none';
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
  els.nice.value = config.nice ?? 15;
  els.encThreads.value = config.encThreads ?? 0;
  els.deleteAllSources.checked = config.deleteSource === true;
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
    nice: els.nice.value === '' ? 15 : Number(els.nice.value),
    encThreads: Number(els.encThreads.value),
    deleteSource: els.deleteAllSources.checked,
  };
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
  if (!els.bulkAudioTrack) return;
  const currentValue = els.bulkAudioTrack.value || '0';
  const optionMap = new Map([['0', 'Track 0 (default)']]);
  for (const item of Array.isArray(queue) ? queue : []) {
    for (const track of Array.isArray(item.audioTracks) ? item.audioTracks : []) {
      if (!track || track.mixed) continue;
      if (track.language) {
        const language = String(track.language).trim().toLowerCase();
        optionMap.set(language, `Language ${String(track.language).trim().toUpperCase()} (per file; fallback track 0)`);
      }
      if (track.index != null) {
        optionMap.set(String(track.index), `Track ${track.index}`);
      }
    }
  }
  const options = [...optionMap.entries()]
    .sort(([a], [b]) => {
      const aNum = /^\d+$/.test(a);
      const bNum = /^\d+$/.test(b);
      if (aNum !== bNum) return aNum ? 1 : -1;
      return a.localeCompare(b, undefined, { numeric: true });
    });
  const optionsKey = JSON.stringify(options);
  if (els.bulkAudioTrack.dataset.optionsKey !== optionsKey) {
    els.bulkAudioTrack.innerHTML = options
      .map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`)
      .join('');
    els.bulkAudioTrack.dataset.optionsKey = optionsKey;
  }
  els.bulkAudioTrack.value = [...els.bulkAudioTrack.options].some(option => option.value === currentValue)
    ? currentValue
    : '0';
}

function getQueueSelectionUnits(queue = fullQueue, state = lastState) {
  return buildQueueSelectionUnits(queue, state?.config?.sourceRoot || '');
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

function reorderFlatQueue(queue, fromPath, toPath) {
  const fromIndex = queue.findIndex(item => item.fullPath === fromPath);
  const toIndex = queue.findIndex(item => item.fullPath === toPath);
  if (fromIndex <= 0 || toIndex <= 0 || fromIndex === toIndex) return null;
  const nextQueue = queue.map(item => ({ ...item }));
  const [movedItem] = nextQueue.splice(fromIndex, 1);
  nextQueue.splice(toIndex, 0, movedItem);
  return nextQueue;
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

async function persistActiveQueueOrder(order) {
  const data = await apiFetch('/api/queue/reorder-active', {
    method: 'POST',
    body: JSON.stringify({ order }),
  });
  if (data.state) render(data.state, { forceQueue: true });
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
    item.deleteSource === true ? '1' : '0',
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
    deleteSource: item.deleteSource === true,
    deleteSourceItems: [{
      fullPath: item.fullPath,
      name: item.name,
      deleteSource: item.deleteSource === true,
    }],
  }));

  els.queueList.innerHTML = renderItems.map((item, itemIndex) => {
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
    const deleteItems = Array.isArray(item.deleteSourceItems) && item.deleteSourceItems.length
      ? item.deleteSourceItems
      : item.filePaths.map((fullPath, index) => ({
          fullPath,
          name: index === 0 ? item.title : fullPath.split('/').pop(),
          deleteSource: item.deleteSource === true,
        }));
    const deleteControl = deleteItems.length === 1
      ? `<label class="meta-chip delete-source-chip"><input type="checkbox" class="delete-source-check" data-delete-source-path="${escapeHtml(deleteItems[0].fullPath)}" ${deleteItems[0].deleteSource ? 'checked' : ''} ${active && itemIndex === 0 ? 'disabled' : ''}> delete source</label>`
      : `<details class="delete-source-group"><summary>delete source ${deleteItems.filter(entry => entry.deleteSource).length}/${deleteItems.length}</summary><div class="delete-source-group-list">${deleteItems.map(entry => `<label><input type="checkbox" class="delete-source-check" data-delete-source-path="${escapeHtml(entry.fullPath)}" ${entry.deleteSource ? 'checked' : ''}> <span title="${escapeHtml(entry.name)}">${escapeHtml(entry.name)}</span></label>`).join('')}</div></details>`;
    const isActivePending = active && itemIndex > 0;
    const isReorderable = isEditable || isActivePending;
    const dragHandle = isReorderable
      ? `<button type="button" class="queue-drag-handle" draggable="true" data-drag-key="${escapeHtml(item.key)}" aria-label="Drag to reorder" title="Drag to reorder">::</button>`
      : '';
    const removeControl = isEditable
      ? `<button type="button" class="queue-remove-btn" data-remove-key="${escapeHtml(item.key)}" aria-label="Remove from queue" title="Remove from queue">X</button>`
      : '';
    const dragClasses = [
      'list-item',
      'queue-item',
      isReorderable ? '' : 'queue-item-static',
      active && itemIndex === 0 ? 'queue-item-current-locked' : '',
      isActivePending ? 'queue-item-active-pending' : '',
    ].filter(Boolean).join(' ');
    const hoverPath = escapeHtml(item.hoverPath || item.subtitle || '');
    return `
      <article class="${dragClasses}" ${isReorderable || active ? `data-unit-key="${escapeHtml(item.key)}"` : ''}>
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
            ${deleteControl}
          </div>
        </div>
        ${removeControl}
      </article>
    `;
  }).join('');
  updateQueueDragMarkers();
}

function sanitizeHeroMessage(message) {
  return String(message || 'Ready.').replace(/\s+\(audio track \d+\)$/i, '');
}

function updateDocumentTitle(state) {
  const baseTitle = state?.app?.name || 'FFmpeg Batch Encode';
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
  els.deleteAllSources.checked = state.config?.deleteSource === true;
  els.deleteAllSources.indeterminate = false;
  updateDocumentTitle(state);
  const machineName = state.app?.machineName || '';
  const cpuCount = Number(state.app?.cpuCount || 0);
  const appName = state.app?.name || 'FFmpeg Batch Encode';
  const dashboardLabel = state.app?.dashboardLabel || 'Client + Server Encode Dashboard';
  const authorizedUsername = state.app?.remoteUsername || '';
  els.appTitles.forEach(title => { title.textContent = appName; });
  if (els.blockedUsername) els.blockedUsername.textContent = authorizedUsername;
  if (els.footerBrand) els.footerBrand.textContent = state.app?.footerBrand || '';
  if (els.appEyebrow) {
    els.appEyebrow.textContent = `${dashboardLabel} - ${state.app?.version || 'N/A'}`;
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
  renderQueueLoadProgress(state.scan);

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
  els.etaSub.textContent = state.progress?.etaIso
    ? `finish time: ${formatDate(state.progress.etaIso)}`
    : (state.active ? 'measuring live progress' : 'N/A');

  const overall = Number(state.progress?.overallPct || 0);
  els.overallProgressLabel.textContent = `${overall.toFixed(2)}%`;
  els.overallProgressBar.style.width = `${Math.max(0, Math.min(100, overall))}%`;

  currentFileView.render(state.currentFile, state.progress || {}, state.status);
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
  activityView.renderRecent(state.recentCompleted || [], recentVisibleCount);
  activityView.renderLog(state.recentEvents || [], logVisibleCount);
  activityView.renderLifetime(state.lifetime || {});

  const active = Boolean(state.active);
  activeQueueAdder?.render(state);
  if (!active && state.status === 'error' && state.message) {
    els.formError.textContent = state.message;
  } else if (active && els.formError.textContent === state.message) {
    els.formError.textContent = '';
  }
  const queueLoading = queueScanInFlight || state.scan?.inProgress === true;
  [
    els.sourceRoot,
    els.outRoot,
    els.tune,
    els.preset,
    els.mbPerMin,
    els.mbStep,
    els.audioKbit,
    els.minVideoKbit,
    els.nice,
    els.encThreads,
    els.deleteAllSources,
  ].forEach(input => {
    input.disabled = active || queueLoading;
  });
  renderQueueLoadingButton(queueLoading);
  els.scanBtn.disabled = active || queueLoading;
  els.startBtn.disabled = active || queueLoading || Number(state.queueInfo?.total || 0) === 0;
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

function renderQueueLoadingButton(loading) {
  els.scanBtn.classList.toggle('is-loading', loading);
  els.scanBtn.textContent = loading ? 'Loading queue...' : 'Load File Queue';
  if (loading) {
    els.scanBtn.setAttribute('aria-busy', 'true');
  } else {
    els.scanBtn.removeAttribute('aria-busy');
  }
}

function renderQueueLoadProgress(scan = null) {
  const serverLoading = scan?.inProgress === true;
  const visible = queueScanInFlight || serverLoading;
  els.queueLoadProgress.hidden = !visible;
  if (!visible) return;

  const total = Math.max(0, Number(scan?.total) || 0);
  const processed = Math.max(0, Math.min(total, Number(scan?.processed) || 0));
  const inspecting = scan?.phase === 'inspecting' && total > 0;
  els.queueLoadLabel.textContent = inspecting ? 'Inspecting media tracks...' : 'Discovering files...';
  els.queueLoadCount.textContent = inspecting
    ? `${processed} / ${total}`
    : (Number(scan?.discovered) > 0 ? `${scan.discovered} found` : '');
  els.queueLoadBar.classList.toggle('is-indeterminate', !inspecting);
  els.queueLoadBar.style.width = inspecting ? `${(processed / total) * 100}%` : '38%';
  els.queueLoadTrack.toggleAttribute('aria-valuemin', inspecting);
  els.queueLoadTrack.toggleAttribute('aria-valuemax', inspecting);
  if (inspecting) {
    els.queueLoadTrack.setAttribute('aria-valuemin', '0');
    els.queueLoadTrack.setAttribute('aria-valuemax', String(total));
    els.queueLoadTrack.setAttribute('aria-valuenow', String(processed));
    els.queueLoadTrack.removeAttribute('aria-valuetext');
  } else {
    els.queueLoadTrack.removeAttribute('aria-valuenow');
    els.queueLoadTrack.setAttribute('aria-valuetext', 'Discovering files');
  }
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

const { wire: wirePathAutocomplete } = createPathAutocomplete({ apiFetch, escapeHtml, timing: CLIENT_CONFIG.pathAutocomplete });

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
  }, CLIENT_CONFIG.queue.bottomScrollDelayMs);
}

function loadQueuePageAtScrollEnd() {
  if (!queuePagingIntent || queuePagingGestureConsumed) return;
  const remaining = els.queueList.scrollHeight - els.queueList.scrollTop - els.queueList.clientHeight;
  if (remaining >= CLIENT_CONFIG.queue.bottomScrollThresholdPx) return;
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
    }, CLIENT_CONFIG.queue.bottomScrollDelayMs);
  };

  const loadAtBottom = () => {
    if (!pagingIntent || gestureConsumed || !hasMore()) return;
    const remaining = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight;
    if (remaining >= CLIENT_CONFIG.queue.bottomScrollThresholdPx) return;
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
    if (!nextState.active && !nextState.scan?.inProgress && (nextState.queueInfo?.total || 0) > 0 && fullQueue.length !== nextState.queueInfo.total) {
      fetchFullQueue().catch(() => {});
    }
    if (!nextState.active && !nextState.scan?.inProgress && (nextState.queueInfo?.total || 0) === 0 && fullQueue.length) {
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
    setAuthorizedUsername(data.allowedUsername);
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
  setAuthorizedUsername(me.allowedUsername);
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
  if (queueScanInFlight) return;
  els.formError.textContent = '';
  queueScanInFlight = true;
  els.scanBtn.disabled = true;
  renderQueueLoadingButton(true);
  els.startBtn.disabled = true;
  renderQueueLoadProgress({ inProgress: true, phase: 'discovering' });
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
  } finally {
    queueScanInFlight = false;
    if (lastState) {
      render(lastState);
    } else {
      renderQueueLoadingButton(false);
      renderQueueLoadProgress();
    }
  }
}

async function startJob() {
  els.formError.textContent = '';
  try {
    await deleteSourceUpdateQueue;
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

async function updateDeleteSource(filePaths, deleteSource, all = false) {
  els.formError.textContent = '';
  const paths = [...new Set(Array.isArray(filePaths) ? filePaths : [])];
  try {
    const data = await apiFetch('/api/queue/delete-source', {
      method: 'POST',
      body: JSON.stringify({ filePaths: paths, deleteSource, all }),
    });
    if (data.state?.active) {
      const wanted = new Set(paths);
      activeQueue = activeQueue.map(item => (
        all || wanted.has(item.fullPath) ? { ...item, deleteSource } : item
      ));
      activeQueue = mergeQueueItems(activeQueue, data.state.queue || []);
    } else {
      setFullQueue(data.queue || []);
    }
    if (data.state) render(data.state, { forceQueue: true });
  } catch (error) {
    els.formError.textContent = error.message;
    if (lastState) render(lastState, { forceQueue: true });
    return false;
  }
  return true;
}

function enqueueDeleteSourceUpdate(filePaths, deleteSource, all = false) {
  deleteSourceUpdateQueue = deleteSourceUpdateQueue
    .catch(() => false)
    .then(() => updateDeleteSource(filePaths, deleteSource, all));
  return deleteSourceUpdateQueue;
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
els.deleteAllSources.addEventListener('change', () => {
  enqueueDeleteSourceUpdate([], els.deleteAllSources.checked, true);
});
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
  if (!(target instanceof HTMLInputElement)) return;
  if (target.classList.contains('delete-source-check')) {
    const filePath = target.dataset.deleteSourcePath;
    if (filePath) enqueueDeleteSourceUpdate([filePath], target.checked);
    return;
  }
  if (!target.classList.contains('queue-check')) return;
  const selectionKey = target.dataset.target;
  if (!selectionKey) return;
  if (target.checked) selectedTargets.add(selectionKey);
  else selectedTargets.delete(selectionKey);
  if (lastState) render(lastState, { forceQueue: true });
});

els.queueList.addEventListener('dragstart', event => {
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
  if (!dragState) return;
  autoScrollQueueDuringDrag(event.clientY);
  const target = event.target instanceof Element ? event.target.closest('[data-unit-key]') : null;
  if (!(target instanceof HTMLElement)) {
    event.preventDefault();
    return;
  }
  event.preventDefault();
  const overKey = target.dataset.unitKey;
  if (lastState?.active && overKey === activeQueue[0]?.fullPath) return;
  if (!overKey || overKey === dragState.overKey) return;
  dragState = { ...dragState, overKey };
  updateQueueDragMarkers();
});

els.queueList.addEventListener('drop', async event => {
  if (!dragState) return;
  event.preventDefault();
  const target = event.target instanceof Element ? event.target.closest('[data-unit-key]') : null;
  const dropKey = target instanceof HTMLElement ? target.dataset.unitKey : dragState.overKey;
  const active = Boolean(lastState?.active);
  const nextQueue = dropKey
    ? (active
        ? reorderFlatQueue(activeQueue, dragState.dragKey, dropKey)
        : reorderQueueUnits(fullQueue, dragState.dragKey, dropKey))
    : null;
  const nextOrder = nextQueue ? nextQueue.map(item => item.fullPath) : null;
  clearQueueDragState();
  if (!nextQueue || !nextOrder) return;
  if (active) activeQueue = nextQueue;
  else setFullQueue(nextQueue);
  if (lastState) render(lastState, { forceQueue: true });
  try {
    if (active) await persistActiveQueueOrder(nextOrder);
    else await persistQueueOrder(nextOrder);
  } catch (error) {
    els.formError.textContent = error.message;
    if (active) {
      const data = await apiFetch(`/api/queue?offset=0&limit=${CLIENT_CONFIG.queue.fetchLimit}`).catch(() => null);
      if (data) {
        resetActiveQueue(data.queue || []);
        if (data.state) render(data.state, { forceQueue: true });
      }
    } else {
      await fetchFullQueue().catch(() => {});
    }
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
    activityView.renderRecent(lastState?.recentCompleted || [], recentVisibleCount);
  },
);

wirePagedList(
  els.logList,
  () => logVisibleCount < (lastState?.recentEvents?.length || 0),
  () => {
    logVisibleCount += LIST_PAGE_SIZE;
    activityView.renderLog(lastState?.recentEvents || [], logVisibleCount);
  },
);

wirePathAutocomplete(els.sourceRoot, els.sourceRootList);
wirePathAutocomplete(els.outRoot, els.outRootList);
wirePathAutocomplete(els.bulkSaveTo, els.bulkSaveToList);

activeQueueAdder = createActiveQueueAdder({
  apiFetch,
  wirePathAutocomplete,
  onState(state) {
    resetActiveQueue(state.queue || []);
    render(state, { forceQueue: true });
  },
});

boot();
