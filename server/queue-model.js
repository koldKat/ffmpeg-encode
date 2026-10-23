const { normalizeNice } = require('./encoder-process');

function clampNonNegative(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function normalizeAudioTrack(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeAudioTracks(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(track => ({
      index: normalizeAudioTrack(track?.index, 0),
      streamIndex: Number.isFinite(Number(track?.streamIndex)) ? Number(track.streamIndex) : null,
      language: String(track?.language || '').trim(),
      codec: String(track?.codec || '').trim(),
      channels: Number.isFinite(Number(track?.channels)) ? Number(track.channels) : null,
      title: String(track?.title || '').trim(),
    }))
    .filter((track, index, tracks) => tracks.findIndex(candidate => candidate.index === track.index) === index)
    .sort((a, b) => a.index - b.index);
}

function normalizeLanguageCode(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  const compact = raw.replace(/[^a-z]/g, '');
  const aliases = {
    en: 'eng', eng: 'eng', english: 'eng',
    ja: 'jpn', jp: 'jpn', jpn: 'jpn', japanese: 'jpn',
    bg: 'bul', bgm: 'bul', bul: 'bul', bulgarian: 'bul',
  };
  return aliases[compact] || compact.slice(0, 3);
}

function resolveAudioTrackByLanguage(item, requestedLanguage) {
  const language = normalizeLanguageCode(requestedLanguage);
  if (!language) return normalizeAudioTrack(item?.audioTrack, 0);
  const tracks = normalizeAudioTracks(item?.audioTracks);
  const match = tracks.find(track => normalizeLanguageCode(track.language) === language)
    || tracks.find(track => normalizeLanguageCode(track.title).includes(language));
  return match ? normalizeAudioTrack(match.index, 0) : 0;
}

function createQueueModel({ defaults, expandHome, fs, path, resolveDeleteSource }) {
  function defaultConfig() {
    return { ...defaults };
  }

  function normalizeConfig(rawConfig = {}) {
    return {
      ...defaultConfig(),
      ...rawConfig,
      sourceRoot: expandHome(rawConfig.sourceRoot || defaults.sourceRoot),
      outRoot: expandHome(rawConfig.outRoot || defaults.outRoot),
      tune: String(rawConfig.tune || defaults.tune),
      preset: String(rawConfig.preset || defaults.preset),
      mbPerMin: clampNonNegative(rawConfig.mbPerMin, defaults.mbPerMin),
      mbStep: clampNonNegative(rawConfig.mbStep, defaults.mbStep),
      audioKbit: clampNonNegative(rawConfig.audioKbit, defaults.audioKbit),
      minVideoKbit: clampNonNegative(rawConfig.minVideoKbit, defaults.minVideoKbit),
      overheadPct: defaults.overheadPct,
      nice: normalizeNice(rawConfig.nice, defaults.nice),
      ffmpegLoglevel: String(rawConfig.ffmpegLoglevel || defaults.ffmpegLoglevel),
      x264Profile: String(rawConfig.x264Profile || defaults.x264Profile),
      x264Level: String(rawConfig.x264Level || defaults.x264Level),
      encThreads: clampNonNegative(rawConfig.encThreads, defaults.encThreads),
      deleteSource: rawConfig.deleteSource === true,
    };
  }

  function createQueueItem(filePath, index, config, overrides = {}) {
    const fullPath = expandHome(overrides.fullPath || filePath);
    return {
      index,
      name: path.basename(fullPath),
      path: path.dirname(fullPath),
      fullPath,
      status: overrides.status || 'pending',
      tune: String(overrides.tune || config.tune || defaults.tune),
      saveTo: expandHome(overrides.saveTo || path.dirname(fullPath)),
      audioTrack: normalizeAudioTrack(overrides.audioTrack, 0),
      audioTracks: normalizeAudioTracks(overrides.audioTracks),
      deleteSource: resolveDeleteSource(overrides, config),
    };
  }

  function serializeQueuePlanItems(queue = []) {
    return (queue || [])
      .filter(item => item?.fullPath && fs.existsSync(item.fullPath))
      .filter(item => !['encoded', 'skipped'].includes(item.status))
      .map(item => ({
        fullPath: expandHome(item.fullPath),
        tune: String(item.tune || defaults.tune),
        saveTo: expandHome(item.saveTo || path.dirname(item.fullPath)),
        audioTrack: normalizeAudioTrack(item.audioTrack, 0),
        audioTracks: normalizeAudioTracks(item.audioTracks),
        deleteSource: item.deleteSource === true,
        status: item.status === 'failed' ? 'failed' : 'pending',
      }));
  }

  function mergePersistedQueuePlan(files, persistedQueue, config) {
    const discoveredPaths = files.map(filePath => expandHome(filePath));
    const discoveredSet = new Set(discoveredPaths);
    const persistedItems = (persistedQueue || []).map(item => ({ ...item, fullPath: expandHome(item.fullPath) }));
    const persistedMap = new Map(persistedItems.map(item => [item.fullPath, item]));
    const ordered = [];

    for (const item of persistedItems) {
      if (discoveredSet.has(item.fullPath)) ordered.push(createQueueItem(item.fullPath, ordered.length + 1, config, item));
    }
    for (const fullPath of discoveredPaths) {
      if (!persistedMap.has(fullPath)) ordered.push(createQueueItem(fullPath, ordered.length + 1, config));
    }
    return ordered;
  }

  return {
    clampNonNegative,
    createQueueItem,
    defaultConfig,
    mergePersistedQueuePlan,
    normalizeAudioTrack,
    normalizeAudioTracks,
    normalizeConfig,
    normalizeLanguageCode,
    resolveAudioTrackByLanguage,
    serializeQueuePlanItems,
  };
}

module.exports = { createQueueModel };
