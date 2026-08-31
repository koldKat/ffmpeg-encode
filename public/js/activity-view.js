export function createActivityView({ els, escapeHtml, formatDate, formatPct, formatSize }) {
  function renderRecent(list, visibleCount) {
    if (!list.length) {
      els.recentList.innerHTML = '<div class="empty-state">Encoded files will collect here in reverse chronological order.</div>';
      return;
    }
    els.recentList.innerHTML = [...list].reverse().slice(0, visibleCount).map(item => `
      <article class="list-item"><div class="list-item-head"><div class="list-item-title">${escapeHtml(item)}</div><span class="badge encoded">done</span></div></article>
    `).join('');
  }

  function renderLog(events, visibleCount) {
    if (!events.length) {
      els.logList.innerHTML = '<div class="empty-state">State changes, skips, failures, and completion messages will appear here.</div>';
      return;
    }
    els.logList.innerHTML = [...events].reverse().slice(0, visibleCount).map(item => `
      <article class="log-item"><div class="log-item-head"><strong>${escapeHtml(item.message)}</strong><span class="badge ${escapeHtml(item.kind)}">${escapeHtml(item.kind)}</span></div><div class="log-item-sub">${escapeHtml(formatDate(item.time))}</div></article>
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

  return { renderLifetime, renderLog, renderRecent };
}
