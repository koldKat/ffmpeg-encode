export function createCurrentFileView({ els, escapeHtml, formatDate, formatHms, formatPct, formatSize }) {
  const metricCard = (label, value, wide = false) => {
    const className = wide ? 'metric-card metric-wide' : 'metric-card';
    return `<article class="${className}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`;
  };

  function render(current, progress, status) {
    if (!current) {
      els.currentFileKicker.textContent = 'Waiting for a job';
      els.currentName.textContent = 'No active file';
      els.currentNameHint.setAttribute('data-name-hint', 'No active file');
      els.currentPath.textContent = '';
      els.fileProgressTitle.textContent = 'File progress';
      els.fileProgressLabel.textContent = '0.0%';
      els.fileProgressBar.style.width = '0%';
      els.currentMetrics.innerHTML = [
        metricCard('File', 'N/A'), metricCard('Input size | Target size | Length', 'N/A'),
        metricCard('Pass', status === 'done' ? 'Done' : 'N/A'), metricCard('Speed / Frame rate', 'N/A'),
        metricCard('Frames', 'N/A'), metricCard('File ETA / Finish time', 'N/A'), metricCard('File size', 'N/A', true),
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

  return { render };
}
