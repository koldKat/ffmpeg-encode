import { buildQueueSelectionUnits } from './queue-units.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function describeAudioTrack(track) {
  const parts = [`${track.index}`];
  if (track.language) parts.push(String(track.language).toUpperCase());
  if (track.codec) parts.push(track.codec);
  if (track.channels) parts.push(`${track.channels}ch`);
  if (track.title) parts.push(track.title);
  return parts.join(' · ');
}

function audioSummary(item) {
  const selectedTrack = String(item.audioTrack ?? 0);
  const tracks = Array.isArray(item.audioTracks) ? item.audioTracks : [];
  if (tracks.some(track => track?.mixed)) {
    const layouts = tracks.filter(track => track?.mixed).flatMap(track => track.layouts || []);
    const available = layouts.length
      ? layouts.map(layout => `${layout.count} file(s): ${layout.label}`).join(' | ')
      : 'mixed track layouts';
    return {
      selected: selectedTrack,
      available,
      title: available,
    };
  }
  if (!tracks.length) {
    return {
      selected: selectedTrack,
      available: 'tracks unavailable',
      title: 'FFprobe did not return audio-track metadata for this file.',
    };
  }
  const selected = tracks.find(track => String(track.index) === selectedTrack);
  return {
    selected: selected ? describeAudioTrack(selected) : selectedTrack,
    available: tracks.map(describeAudioTrack).join(' | '),
    title: tracks.map(track => `audio ${describeAudioTrack(track)}`).join('\n'),
  };
}

function collectAudioOptions(items) {
  const options = new Map([['0', 'Track 0 (default)']]);
  for (const item of items) {
    for (const track of Array.isArray(item.audioTracks) ? item.audioTracks : []) {
      const language = String(track.language || '').trim().toLowerCase();
      if (language) options.set(language, `Language ${language.toUpperCase()} (per file; fallback track 0)`);
      if (track.index != null) options.set(String(track.index), `Track ${track.index}`);
    }
  }
  return [...options.entries()].sort(([a], [b]) => {
    const aNumeric = /^\d+$/.test(a);
    const bNumeric = /^\d+$/.test(b);
    if (aNumeric !== bNumeric) return aNumeric ? 1 : -1;
    return a.localeCompare(b, undefined, { numeric: true });
  });
}

export function createActiveQueueAdder({ apiFetch, wirePathAutocomplete, onState }) {
  const panel = document.getElementById('active-queue-add');
  const form = document.getElementById('active-queue-inspect-form');
  const pathInput = document.getElementById('active-queue-path');
  const pathSuggestions = document.getElementById('path-suggestions-active-queue');
  const inspectButton = document.getElementById('active-queue-inspect-btn');
  const inspectProgress = document.getElementById('active-queue-inspect-progress');
  const message = document.getElementById('active-queue-add-message');
  const dialog = document.getElementById('active-queue-dialog');
  const list = document.getElementById('active-queue-dialog-list');
  const count = document.getElementById('active-queue-dialog-count');
  const selectionCount = document.getElementById('active-dialog-selection-count');
  const selectAllButton = document.getElementById('active-dialog-select-all');
  const clearButton = document.getElementById('active-dialog-clear');
  const tuneInput = document.getElementById('active-dialog-tune');
  const audioInput = document.getElementById('active-dialog-audio');
  const saveInput = document.getElementById('active-dialog-save');
  const saveSuggestions = document.getElementById('path-suggestions-active-dialog-save');
  const applyTuneButton = document.getElementById('active-dialog-apply-tune');
  const applyAudioButton = document.getElementById('active-dialog-apply-audio');
  const applySaveButton = document.getElementById('active-dialog-apply-save');
  const cancelButton = document.getElementById('active-queue-dialog-cancel');
  const addButton = document.getElementById('active-queue-dialog-add');
  let activeSourceRoot = '';
  let activeTune = 'film';
  let inspectionId = '';
  let items = [];
  let selectedUnitKeys = new Set();
  let busy = false;
  let draggedIndex = null;

  const required = [panel, form, pathInput, inspectButton, inspectProgress, message, dialog, list, count,
    selectionCount, selectAllButton, clearButton, tuneInput, audioInput,
    saveInput, applyTuneButton, applyAudioButton, applySaveButton, cancelButton, addButton];
  if (required.some(element => !element)) return { render() {} };

  wirePathAutocomplete(pathInput, pathSuggestions);
  wirePathAutocomplete(saveInput, saveSuggestions);

  function setMessage(value, isError = false) {
    message.textContent = value;
    message.classList.toggle('is-error', isError);
  }

  function setBusy(value, inspecting = false) {
    busy = value;
    inspectButton.disabled = value;
    inspectButton.textContent = value && inspecting ? 'Inspecting...' : 'Inspect';
    inspectProgress.hidden = !(value && inspecting);
    inspectButton.toggleAttribute('aria-busy', value && inspecting);
    addButton.disabled = value || !selectedUnitKeys.size;
  }

  function closeDialog() {
    if (dialog.open) dialog.close();
  }

  function renderAudioOptions() {
    const currentValue = audioInput.value || '0';
    audioInput.replaceChildren(...collectAudioOptions(items).map(([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      return option;
    }));
    audioInput.value = [...audioInput.options].some(option => option.value === currentValue)
      ? currentValue
      : '0';
  }

  function getSelectionUnits() {
    return buildQueueSelectionUnits(items, activeSourceRoot);
  }

  function getSelectedFilePaths(units = getSelectionUnits()) {
    return new Set(units
      .filter(unit => selectedUnitKeys.has(unit.key))
      .flatMap(unit => unit.filePaths));
  }

  function renderItems() {
    const units = getSelectionUnits();
    const validKeys = new Set(units.map(unit => unit.key));
    selectedUnitKeys = new Set([...selectedUnitKeys].filter(key => validKeys.has(key)));
    const selectedFileCount = getSelectedFilePaths(units).size;
    count.textContent = `${items.length} file${items.length === 1 ? '' : 's'} in ${units.length} queue item${units.length === 1 ? '' : 's'}`;
    selectionCount.textContent = `${selectedUnitKeys.size} of ${units.length} selected`;
    addButton.textContent = selectedFileCount
      ? `Add ${selectedFileCount} to Queue`
      : 'Add to Queue';
    addButton.disabled = busy || !selectedUnitKeys.size;
    [applyTuneButton, applyAudioButton, applySaveButton].forEach(button => {
      button.disabled = busy || !selectedUnitKeys.size;
    });
    list.innerHTML = units.map((unit, index) => {
      const checked = selectedUnitKeys.has(unit.key) ? 'checked' : '';
      const audio = audioSummary(unit);
      const audioTitle = escapeHtml(audio.title);
      const deleteItems = unit.deleteSourceItems || [];
      const deleteControl = deleteItems.length === 1
        ? `<label class="meta-chip delete-source-chip"><input type="checkbox" class="delete-source-check" data-editor-delete-source="${escapeHtml(deleteItems[0].fullPath)}" ${deleteItems[0].deleteSource ? 'checked' : ''}> delete source</label>`
        : `<details class="delete-source-group"><summary>delete source ${deleteItems.filter(item => item.deleteSource).length}/${deleteItems.length}</summary><div class="delete-source-group-list">${deleteItems.map(item => `<label><input type="checkbox" class="delete-source-check" data-editor-delete-source="${escapeHtml(item.fullPath)}" ${item.deleteSource ? 'checked' : ''}> <span title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span></label>`).join('')}</div></details>`;
      return `
        <article class="list-item queue-item" data-editor-index="${index}">
          <input type="checkbox" class="queue-check" data-editor-select="${escapeHtml(unit.key)}" ${checked}>
          <button type="button" class="queue-drag-handle" draggable="true" data-editor-drag="${index}" aria-label="Drag to reorder" title="Drag to reorder">::</button>
          <div class="queue-item-body">
            <div class="list-item-head">
              <div class="list-item-title queue-title-hint" data-name-hint="${escapeHtml(unit.title)}" data-path-hint="${escapeHtml(unit.hoverPath)}"><span class="queue-title-text">${escapeHtml(unit.title)}</span></div>
              <span class="badge pending">pending</span>
            </div>
            <div class="queue-meta">
              <span class="meta-chip">${unit.type} <strong>${unit.filePaths.length}</strong></span>
              <span class="meta-chip">tune <strong>${escapeHtml(unit.tune || activeTune)}</strong></span>
              <span class="meta-chip" title="${audioTitle}">audio <strong>${escapeHtml(audio.selected)}</strong></span>
              <span class="meta-chip audio-track-chip" title="${audioTitle}">available <strong>${escapeHtml(audio.available)}</strong></span>
              <span class="meta-chip">save to <strong>${escapeHtml(unit.saveTo || unit.subtitle)}</strong></span>
              ${deleteControl}
            </div>
          </div>
          <button type="button" class="queue-remove-btn" data-editor-remove="${index}" aria-label="Remove from additions" title="Remove from additions">X</button>
        </article>`;
    }).join('');
  }

  function applyToSelected(field, value, fallback) {
    if (!selectedUnitKeys.size) return;
    const selectedFilePaths = getSelectedFilePaths();
    for (const item of items) {
      if (selectedFilePaths.has(item.fullPath)) item[field] = value || fallback(item);
    }
    renderItems();
  }

  async function inspect(event) {
    event.preventDefault();
    const requestedPath = pathInput.value.trim();
    if (!requestedPath || busy) return;
    setBusy(true, true);
    setMessage('Inspecting files and audio tracks...');
    try {
      const data = await apiFetch('/api/queue/inspect', {
        method: 'POST',
        body: JSON.stringify({ path: requestedPath }),
      });
      if (!data.found) {
        setMessage('No new supported files were found.');
        return;
      }
      inspectionId = data.inspectionId;
      items = data.items.map(item => ({
        ...item,
        tune: item.tune || activeTune,
        audioTrack: String(item.audioTrack ?? 0),
        saveTo: item.saveTo || item.path,
        deleteSource: item.deleteSource === true,
      }));
      selectedUnitKeys = new Set(getSelectionUnits().map(unit => unit.key));
      tuneInput.value = activeTune;
      audioInput.value = '0';
      saveInput.value = '';
      renderAudioOptions();
      renderItems();
      setMessage(`Found ${items.length} new file${items.length === 1 ? '' : 's'}.`);
      const queuePanel = document.querySelector('.queue-panel:not(.queue-editor-dialog)');
      const panelBounds = queuePanel?.getBoundingClientRect();
      dialog.showModal();
      if (panelBounds) {
        const dialogWidth = `${Math.min(panelBounds.width, window.innerWidth - 18)}px`;
        const dialogHeight = `${Math.min(panelBounds.height, window.innerHeight - 18)}px`;
        dialog.style.width = dialogWidth;
        dialog.style.minWidth = dialogWidth;
        dialog.style.maxWidth = dialogWidth;
        dialog.style.height = dialogHeight;
        dialog.style.minHeight = dialogHeight;
        dialog.style.maxHeight = dialogHeight;
      }
    } catch (error) {
      setMessage(error.message, true);
    } finally {
      setBusy(false);
      renderItems();
    }
  }

  async function append() {
    if (!inspectionId || !selectedUnitKeys.size || busy) return;
    setBusy(true);
    try {
      const selectedFilePaths = getSelectedFilePaths();
      const selectedItems = items.filter(item => selectedFilePaths.has(item.fullPath));
      const data = await apiFetch('/api/queue/append', {
        method: 'POST',
        body: JSON.stringify({
          inspectionId,
          items: selectedItems.map(item => ({
            fullPath: item.fullPath,
            tune: item.tune,
            audioTrack: item.audioTrack,
            saveTo: item.saveTo,
            deleteSource: item.deleteSource === true,
          })),
        }),
      });
      closeDialog();
      setMessage(data.added
        ? `Added ${data.added} configured file${data.added === 1 ? '' : 's'} to this batch.`
        : 'Those files are already in the queue.');
      pathInput.value = activeSourceRoot;
      inspectionId = '';
      items = [];
      selectedUnitKeys.clear();
      if (data.state) onState(data.state);
    } catch (error) {
      setMessage(error.message, true);
    } finally {
      setBusy(false);
    }
  }

  form.addEventListener('submit', inspect);
  addButton.addEventListener('click', append);
  cancelButton.addEventListener('click', closeDialog);
  selectAllButton.addEventListener('click', () => {
    selectedUnitKeys = new Set(getSelectionUnits().map(unit => unit.key));
    renderItems();
  });
  clearButton.addEventListener('click', () => {
    selectedUnitKeys.clear();
    renderItems();
  });
  applyTuneButton.addEventListener('click', () => applyToSelected('tune', tuneInput.value.trim(), () => activeTune));
  applyAudioButton.addEventListener('click', () => applyToSelected('audioTrack', audioInput.value.trim(), () => '0'));
  applySaveButton.addEventListener('click', () => applyToSelected('saveTo', saveInput.value.trim(), item => item.path));
  list.addEventListener('change', event => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    if (input.hasAttribute('data-editor-delete-source')) {
      const item = items.find(entry => entry.fullPath === input.dataset.editorDeleteSource);
      if (item) item.deleteSource = input.checked;
      const group = input.closest('.delete-source-group');
      const summary = group?.querySelector('summary');
      if (summary) {
        const checks = [...group.querySelectorAll('[data-editor-delete-source]')];
        summary.textContent = `delete source ${checks.filter(check => check.checked).length}/${checks.length}`;
      }
      return;
    }
    if (!input.hasAttribute('data-editor-select')) return;
    const unitKey = input.dataset.editorSelect;
    if (input.checked) selectedUnitKeys.add(unitKey);
    else selectedUnitKeys.delete(unitKey);
    renderItems();
  });
  list.addEventListener('click', event => {
    const button = event.target instanceof Element ? event.target.closest('[data-editor-remove]') : null;
    if (!(button instanceof HTMLElement)) return;
    const unit = getSelectionUnits()[Number(button.dataset.editorRemove)];
    if (!unit) return;
    const removedPaths = new Set(unit.filePaths);
    items = items.filter(item => !removedPaths.has(item.fullPath));
    selectedUnitKeys.delete(unit.key);
    renderAudioOptions();
    renderItems();
  });

  function updateDragMarkers(overIndex = draggedIndex) {
    list.querySelectorAll('[data-editor-index]').forEach(row => {
      const index = Number(row.dataset.editorIndex);
      row.classList.toggle('queue-item-dragging', index === draggedIndex);
      row.classList.toggle('queue-item-drop-target', index === overIndex && index !== draggedIndex);
    });
  }

  function clearDragMarkers() {
    draggedIndex = null;
    updateDragMarkers();
  }

  list.addEventListener('dragstart', event => {
    const handle = event.target;
    if (!(handle instanceof HTMLElement) || !handle.hasAttribute('data-editor-drag')) return;
    draggedIndex = Number(handle.dataset.editorDrag);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', String(draggedIndex));
    }
    updateDragMarkers();
  });
  list.addEventListener('dragover', event => {
    if (draggedIndex == null) return;
    event.preventDefault();
    const row = event.target instanceof Element ? event.target.closest('[data-editor-index]') : null;
    const overIndex = row instanceof HTMLElement ? Number(row.dataset.editorIndex) : draggedIndex;
    updateDragMarkers(overIndex);
  });
  list.addEventListener('drop', event => {
    if (draggedIndex == null) return;
    event.preventDefault();
    const row = event.target instanceof Element ? event.target.closest('[data-editor-index]') : null;
    const targetIndex = row instanceof HTMLElement ? Number(row.dataset.editorIndex) : draggedIndex;
    if (targetIndex !== draggedIndex) {
      const units = getSelectionUnits();
      const [movedUnit] = units.splice(draggedIndex, 1);
      units.splice(targetIndex, 0, movedUnit);
      const itemsByPath = new Map(items.map(item => [item.fullPath, item]));
      items = units.flatMap(unit => unit.filePaths.map(filePath => itemsByPath.get(filePath)).filter(Boolean));
      renderItems();
    }
    clearDragMarkers();
  });
  list.addEventListener('dragend', () => {
    clearDragMarkers();
  });

  return {
    render(state) {
      const active = Boolean(state?.active);
      panel.hidden = !active;
      if (!active) {
        closeDialog();
        activeSourceRoot = '';
        pathInput.value = '';
        inspectionId = '';
        items = [];
        selectedUnitKeys.clear();
        setMessage('');
        return;
      }
      activeTune = state.config?.tune || 'film';
      const sourceRoot = state.config?.sourceRoot || '';
      if (sourceRoot !== activeSourceRoot) {
        activeSourceRoot = sourceRoot;
        pathInput.value = sourceRoot;
      }
    },
  };
}
