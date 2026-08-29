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
  let selectedPaths = new Set();
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
    addButton.disabled = value || !selectedPaths.size;
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

  function renderItems() {
    count.textContent = `${items.length} file${items.length === 1 ? '' : 's'} ready to add`;
    selectionCount.textContent = `${selectedPaths.size} of ${items.length} selected`;
    addButton.textContent = selectedPaths.size
      ? `Add ${selectedPaths.size} to Queue`
      : 'Add to Queue';
    addButton.disabled = busy || !selectedPaths.size;
    [applyTuneButton, applyAudioButton, applySaveButton].forEach(button => {
      button.disabled = busy || !selectedPaths.size;
    });
    list.innerHTML = items.map((item, index) => {
      const checked = selectedPaths.has(item.fullPath) ? 'checked' : '';
      const audio = audioSummary(item);
      const audioTitle = escapeHtml(audio.title);
      return `
        <article class="list-item queue-item" data-editor-index="${index}">
          <input type="checkbox" class="queue-check" data-editor-select="${escapeHtml(item.fullPath)}" ${checked}>
          <button type="button" class="queue-drag-handle" draggable="true" data-editor-drag="${index}" aria-label="Drag to reorder" title="Drag to reorder">::</button>
          <div class="queue-item-body">
            <div class="list-item-head">
              <div class="list-item-title queue-title-hint" data-name-hint="${escapeHtml(item.name)}" data-path-hint="${escapeHtml(item.path)}"><span class="queue-title-text">${escapeHtml(item.name)}</span></div>
              <span class="badge pending">pending</span>
            </div>
            <div class="queue-meta">
              <span class="meta-chip">file <strong>1</strong></span>
              <span class="meta-chip">tune <strong>${escapeHtml(item.tune || activeTune)}</strong></span>
              <span class="meta-chip" title="${audioTitle}">audio <strong>${escapeHtml(audio.selected)}</strong></span>
              <span class="meta-chip audio-track-chip" title="${audioTitle}">available <strong>${escapeHtml(audio.available)}</strong></span>
              <span class="meta-chip">save to <strong>${escapeHtml(item.saveTo || item.path)}</strong></span>
              <label class="meta-chip delete-source-chip"><input type="checkbox" class="delete-source-check" data-editor-delete-source="${escapeHtml(item.fullPath)}" ${item.deleteSource ? 'checked' : ''}> delete source</label>
            </div>
          </div>
          <button type="button" class="queue-remove-btn" data-editor-remove="${index}" aria-label="Remove from additions" title="Remove from additions">X</button>
        </article>`;
    }).join('');
  }

  function applyToSelected(field, value, fallback) {
    if (!selectedPaths.size) return;
    for (const item of items) {
      if (selectedPaths.has(item.fullPath)) item[field] = value || fallback(item);
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
      selectedPaths = new Set(items.map(item => item.fullPath));
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
    if (!inspectionId || !selectedPaths.size || busy) return;
    setBusy(true);
    try {
      const selectedItems = items.filter(item => selectedPaths.has(item.fullPath));
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
      selectedPaths.clear();
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
    selectedPaths = new Set(items.map(item => item.fullPath));
    renderItems();
  });
  clearButton.addEventListener('click', () => {
    selectedPaths.clear();
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
      renderItems();
      return;
    }
    if (!input.hasAttribute('data-editor-select')) return;
    const fullPath = input.dataset.editorSelect;
    if (input.checked) selectedPaths.add(fullPath);
    else selectedPaths.delete(fullPath);
    renderItems();
  });
  list.addEventListener('click', event => {
    const button = event.target instanceof Element ? event.target.closest('[data-editor-remove]') : null;
    if (!(button instanceof HTMLElement)) return;
    const [removed] = items.splice(Number(button.dataset.editorRemove), 1);
    if (removed) selectedPaths.delete(removed.fullPath);
    renderAudioOptions();
    renderItems();
  });
  list.addEventListener('dragstart', event => {
    const handle = event.target;
    if (!(handle instanceof HTMLElement) || !handle.hasAttribute('data-editor-drag')) return;
    draggedIndex = Number(handle.dataset.editorDrag);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  });
  list.addEventListener('dragover', event => {
    if (draggedIndex != null) event.preventDefault();
  });
  list.addEventListener('drop', event => {
    if (draggedIndex == null) return;
    event.preventDefault();
    const row = event.target instanceof Element ? event.target.closest('[data-editor-index]') : null;
    const targetIndex = row instanceof HTMLElement ? Number(row.dataset.editorIndex) : draggedIndex;
    if (targetIndex !== draggedIndex) {
      const [movedItem] = items.splice(draggedIndex, 1);
      items.splice(targetIndex, 0, movedItem);
      renderItems();
    }
    draggedIndex = null;
  });
  list.addEventListener('dragend', () => {
    draggedIndex = null;
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
        selectedPaths.clear();
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
