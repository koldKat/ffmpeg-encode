globalThis.FFMPEG_WEBAPP_CLIENT_CONFIG = Object.freeze({
  sessionStorageKey: 'ffmpeg_webapp_token',
  footerStartYear: 2026,
  queue: Object.freeze({
    initialVisibleItems: 50,
    pageSize: 50,
    fetchLimit: 200,
    dragScrollEdgePx: 72,
    dragScrollStepPx: 28,
    bottomScrollDelayMs: 350,
    bottomScrollThresholdPx: 120,
  }),
  pathAutocomplete: Object.freeze({
    debounceMs: 150,
    blurCloseDelayMs: 120,
  }),
  admin: Object.freeze({
    refreshIntervalMs: 1_000,
  }),
});
