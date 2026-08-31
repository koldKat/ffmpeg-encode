export function formatPct(value) {
  return value == null || Number.isNaN(Number(value)) ? 'N/A' : `${Number(value).toFixed(1)}%`;
}

export function formatSize(bytes) {
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

export function formatHms(totalSeconds) {
  if (totalSeconds == null || totalSeconds === '') return 'N/A';
  const safe = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const days = Math.floor(safe / 86400);
  const hours = Math.floor((safe % 86400) / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  if (days > 0) return `${days} ${days === 1 ? 'day' : 'days'} ${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function formatDate(iso) {
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

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
