#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');
const db = require('./server/db');

const PORT = Number(process.env.PORT || 3017);
const ROOT = path.join(__dirname, 'public');
const REMOTE_USERNAME = 'koldKat';
const APP_VERSION_FALLBACK = '1.0.9';
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};
const VIDEO_EXTS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.mpeg', '.mpg', '.m4v']);
const SSE_CLIENTS = new Set();
const QUEUE_PREVIEW_LIMIT = 50;
const MACHINE_NAME = os.hostname();
const MAX_EVENT_MESSAGE_LENGTH = 420;

const DEFAULTS = {
  sourceRoot: '.',
  outRoot: '~/Videos',
  tune: 'film',
  preset: 'slow',
  mbPerMin: 10,
  mbStep: 50,
  audioKbit: 192,
  minVideoKbit: 300,
  overheadPct: 1,
  ffmpegLoglevel: 'error',
  x264Profile: 'high',
  x264Level: '4.1',
  encThreads: 0,
};

let currentChild = null;
let stopRequested = false;
let stopAfterCurrentRequested = false;
let pauseRequested = false;
let runnerPromise = null;
let activeRunId = null;
let activeUserId = null;
let shutdownInProgress = false;
let lastBatchSummary = null;
let lastCpuSample = null;
let lastCpuUsagePct = null;
const PROC_CLK_TCK = Number(process.env.CLK_TCK || 100);

function stopActiveChild(signal = 'SIGINT') {
  if (!currentChild) return false;
  try {
    if (currentChild.pid) {
      process.kill(-currentChild.pid, signal);
    } else {
      currentChild.kill(signal);
    }
    return true;
  } catch {
    try {
      currentChild.kill(signal);
      return true;
    } catch {
      return false;
    }
  }
}

function forceStopActiveChild() {
  if (!currentChild) return;
  stopActiveChild('SIGINT');
  setTimeout(() => {
    if (currentChild) stopActiveChild('SIGKILL');
  }, 1500).unref();
}

function shutdownServer(exitCode = 0) {
  if (shutdownInProgress) return;
  shutdownInProgress = true;
  stopRequested = true;
  stopAfterCurrentRequested = false;
  pauseRequested = false;
  state.stopRequested = true;
  state.stopAfterCurrent = false;
  state.paused = false;
  forceStopActiveChild();
  server.close(() => {
    process.exit(exitCode);
  });
  setTimeout(() => process.exit(exitCode), 2500).unref();
}

function defaultConfig() {
  return { ...DEFAULTS };
}

function normalizeConfig(rawConfig = {}) {
  return {
    ...defaultConfig(),
    ...rawConfig,
    sourceRoot: expandHome(rawConfig.sourceRoot || DEFAULTS.sourceRoot),
    outRoot: expandHome(rawConfig.outRoot || DEFAULTS.outRoot),
    tune: String(rawConfig.tune || DEFAULTS.tune),
    preset: String(rawConfig.preset || DEFAULTS.preset),
    mbPerMin: clampNonNegative(rawConfig.mbPerMin, DEFAULTS.mbPerMin),
    mbStep: clampNonNegative(rawConfig.mbStep, DEFAULTS.mbStep),
    audioKbit: clampNonNegative(rawConfig.audioKbit, DEFAULTS.audioKbit),
    minVideoKbit: clampNonNegative(rawConfig.minVideoKbit, DEFAULTS.minVideoKbit),
    overheadPct: clampNonNegative(rawConfig.overheadPct, DEFAULTS.overheadPct),
    ffmpegLoglevel: String(rawConfig.ffmpegLoglevel || DEFAULTS.ffmpegLoglevel),
    x264Profile: String(rawConfig.x264Profile || DEFAULTS.x264Profile),
    x264Level: String(rawConfig.x264Level || DEFAULTS.x264Level),
    encThreads: clampNonNegative(rawConfig.encThreads, DEFAULTS.encThreads),
  };
}

function getPersistedConfig(userId) {
  const stored = db.getUserSettings(userId, MACHINE_NAME) || {};
  return normalizeConfig(stored);
}

function normalizeAudioTrack(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
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
    en: 'eng',
    eng: 'eng',
    english: 'eng',
    ja: 'jpn',
    jp: 'jpn',
    jpn: 'jpn',
    japanese: 'jpn',
    bg: 'bul',
    bgm: 'bul',
    bul: 'bul',
    bulgarian: 'bul',
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

function serializeQueuePlanItems(queue = []) {
  return (queue || [])
    .filter(item => item && item.fullPath)
    .filter(item => fs.existsSync(item.fullPath))
    .filter(item => !['encoded', 'skipped'].includes(item.status))
    .map(item => ({
      fullPath: expandHome(item.fullPath),
      tune: String(item.tune || DEFAULTS.tune),
      saveTo: expandHome(item.saveTo || path.dirname(item.fullPath)),
      audioTrack: normalizeAudioTrack(item.audioTrack, 0),
      audioTracks: normalizeAudioTracks(item.audioTracks),
      status: item.status === 'failed' ? 'failed' : 'pending',
    }));
}

function saveQueuePlan(userId, config, queue = state.queue) {
  const items = serializeQueuePlanItems(queue);
  if (!items.length) {
    db.clearUserQueuePlan(userId, MACHINE_NAME);
    return [];
  }
  db.saveUserQueuePlan(userId, MACHINE_NAME, config?.sourceRoot || '', items);
  return items;
}

function getPersistedQueuePlan(userId, config = getPersistedConfig(userId)) {
  const plan = db.getUserQueuePlan(userId, MACHINE_NAME);
  if (!plan || !Array.isArray(plan.queue) || !plan.queue.length) return [];
  const sourceRoot = expandHome(plan.sourceRoot || config.sourceRoot || DEFAULTS.sourceRoot);
  const cleaned = plan.queue
    .filter(item => item && item.fullPath)
    .map(item => {
      const fullPath = expandHome(item.fullPath);
      return {
        fullPath,
        tune: String(item.tune || config.tune || DEFAULTS.tune),
        saveTo: expandHome(item.saveTo || path.dirname(fullPath)),
        audioTrack: normalizeAudioTrack(item.audioTrack, 0),
        audioTracks: normalizeAudioTracks(item.audioTracks),
        status: item.status === 'failed' ? 'failed' : 'pending',
      };
    })
    .filter(item => fs.existsSync(item.fullPath));
  if (cleaned.length !== plan.queue.length || sourceRoot !== plan.sourceRoot) {
    if (cleaned.length) db.saveUserQueuePlan(userId, MACHINE_NAME, sourceRoot, cleaned);
    else db.clearUserQueuePlan(userId, MACHINE_NAME);
  }
  return cleaned.map((item, index) => createQueueItem(item.fullPath, index + 1, config, item));
}

function parseProcStat(statText) {
  const endName = statText.lastIndexOf(')');
  if (endName < 0) return null;
  const fields = statText.slice(endName + 2).trim().split(/\s+/);
  return {
    pgrp: Number(fields[2]),
    utimeTicks: Number(fields[11]) || 0,
    stimeTicks: Number(fields[12]) || 0,
  };
}

function activeProcessGroupCpuMicros(pgid) {
  const targetPgid = Number(pgid);
  if (!Number.isFinite(targetPgid) || targetPgid <= 0) return 0;
  let totalTicks = 0;
  let procEntries = [];
  try {
    procEntries = fs.readdirSync('/proc', { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of procEntries) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
    try {
      const stat = parseProcStat(fs.readFileSync(`/proc/${entry.name}/stat`, 'utf8'));
      if (stat && stat.pgrp === targetPgid) {
        totalTicks += stat.utimeTicks + stat.stimeTicks;
      }
    } catch {
      // Processes can exit while /proc is being scanned.
    }
  }
  return totalTicks * (1000000 / PROC_CLK_TCK);
}

function hydrateIdleStateForUser(userId, config = getPersistedConfig(userId)) {
  if (state.active) return;
  resetState(config);
  state.scan.sourceRoot = config.sourceRoot;
  state.scan.outRoot = config.outRoot;
  const queueItems = getPersistedQueuePlan(userId, config);
  if (queueItems.length) {
    state.scan.found = queueItems.length;
    state.counts.total = queueItems.length;
    loadQueueItems(queueItems, config);
  }
  computeDerivedTotals();
}

function mergePersistedQueuePlan(files, persistedQueue, config) {
  const discoveredPaths = files.map(filePath => expandHome(filePath));
  const discoveredSet = new Set(discoveredPaths);
  const persistedItems = (persistedQueue || []).map(item => ({
    ...item,
    fullPath: expandHome(item.fullPath),
  }));
  const persistedMap = new Map(persistedItems.map(item => [item.fullPath, item]));

  const ordered = [];

  for (const item of persistedItems) {
    if (!discoveredSet.has(item.fullPath)) continue;
    ordered.push(createQueueItem(item.fullPath, ordered.length + 1, config, item));
  }

  for (const fullPath of discoveredPaths) {
    if (persistedMap.has(fullPath)) continue;
    ordered.push(createQueueItem(fullPath, ordered.length + 1, config, {}));
  }

  return ordered;
}

function runtimeStats() {
  const memory = process.memoryUsage();
  const cpu = process.cpuUsage();
  const nodeCpuMicros = Number(cpu.user || 0) + Number(cpu.system || 0);
  const childCpuMicros = currentChild?.pid ? activeProcessGroupCpuMicros(currentChild.pid) : 0;
  const cpuTotalMicros = nodeCpuMicros + childCpuMicros;
  const nowMicros = Number(process.hrtime.bigint() / 1000n);
  const elapsedMicros = lastCpuSample ? nowMicros - lastCpuSample.atMicros : 0;
  if (lastCpuSample && elapsedMicros >= 250000) {
    const cpuDeltaMicros = Math.max(0, cpuTotalMicros - lastCpuSample.totalMicros);
    const cpuCapacity = Math.max(1, os.cpus().length);
    lastCpuUsagePct = Math.min(100, (cpuDeltaMicros / (elapsedMicros * cpuCapacity)) * 100);
    lastCpuSample = { atMicros: nowMicros, totalMicros: cpuTotalMicros };
  } else if (!lastCpuSample) {
    lastCpuSample = { atMicros: nowMicros, totalMicros: cpuTotalMicros };
  }
  return {
    memory: {
      heapUsedBytes: Number(memory.heapUsed || 0),
      heapTotalBytes: Number(memory.heapTotal || 0),
      rssBytes: Number(memory.rss || 0),
    },
    cpu: {
      usagePct: lastCpuUsagePct,
      userSeconds: Number(cpu.user || 0) / 1000000,
      systemSeconds: Number(cpu.system || 0) / 1000000,
      childSeconds: childCpuMicros / 1000000,
    },
  };
}

function createState() {
  const runtime = runtimeStats();
  return {
    app: {
      name: 'FFmpeg Batch Encode',
      version: db.getAppVersion(APP_VERSION_FALLBACK),
      remoteUsername: REMOTE_USERNAME,
      machineName: MACHINE_NAME,
      cpuCount: os.cpus().length,
      memory: runtime.memory,
      cpu: runtime.cpu,
    },
    status: 'idle',
    message: 'Ready.',
    config: defaultConfig(),
    startedAt: null,
    finishedAt: null,
    active: false,
    stopRequested: false,
    stopAfterCurrent: false,
    paused: false,
    scan: {
      sourceRoot: '',
      outRoot: '',
      found: 0,
    },
    currentFile: null,
    queue: [],
    queueInfo: { total: 0, visible: 0, hidden: 0 },
    recentCompleted: [],
    recentEvents: [],
    counts: {
      total: 0,
      encoded: 0,
      skipped: 0,
      failed: 0,
      completed: 0,
    },
    totals: {
      sourceBytes: 0,
      outputBytes: 0,
      savingsBytes: 0,
      savingsPct: null,
      averageSavingsBytes: null,
      averageSavingsLabel: 'N/A',
      encodeSeconds: 0,
      videoSeconds: 0,
      completedSpeedX: null,
      currentSpeedX: null,
      averageBitrateKbps: null,
    },
    progress: {
      overallPct: 0,
      remainingSeconds: null,
      etaIso: null,
    },
    lifetime: {
      runsTotal: 0,
      runsDone: 0,
      runsStopped: 0,
      runsError: 0,
      filesTotal: 0,
      encodedTotal: 0,
      skippedTotal: 0,
      failedTotal: 0,
      sourceBytes: 0,
      outputBytes: 0,
      savingsBytes: 0,
      savingsPct: null,
      averageSavingsBytes: null,
      completedSpeedX: null,
      averageBitrateKbps: null,
      averageFilesPerRun: null,
      encodeSeconds: 0,
      videoSeconds: 0,
      firstStartedAt: null,
      lastFinishedAt: null,
    },
    viewer: null,
  };
}

let state = createState();
state.lifetime = db.getLifetimeStats();

function buildQueuePreview(queue) {
  const running = queue.filter(item => item.status === 'running');
  const pendingish = queue.filter(item => item.status !== 'encoded');
  const completedTail = queue.filter(item => item.status === 'encoded').slice(-4);
  const visible = [];
  const seen = new Set();

  for (const item of [...running, ...pendingish, ...completedTail]) {
    if (visible.length >= QUEUE_PREVIEW_LIMIT) break;
    if (seen.has(item.fullPath)) continue;
    visible.push(item);
    seen.add(item.fullPath);
  }

  for (const item of queue) {
    if (visible.length >= QUEUE_PREVIEW_LIMIT) break;
    if (seen.has(item.fullPath)) continue;
    visible.push(item);
    seen.add(item.fullPath);
  }

  return visible;
}

function getPublicQueue() {
  return state.active
    ? (state.queue || []).filter(item => !['encoded', 'skipped', 'failed', 'stopped'].includes(item.status))
    : (state.queue || []);
}

function clonePublicState(configOverride = null) {
  const runtime = runtimeStats();
  const publicQueue = getPublicQueue();
  const queuePreview = buildQueuePreview(publicQueue);
  const summaryOverlay = !state.active && lastBatchSummary
    ? {
        counts: { ...state.counts, ...lastBatchSummary.counts },
        totals: { ...state.totals, ...lastBatchSummary.totals },
        progress: { ...state.progress, ...lastBatchSummary.progress },
        recentCompleted: [...(lastBatchSummary.recentCompleted || [])],
        recentEvents: [...(lastBatchSummary.recentEvents || [])],
      }
    : null;
  return {
    ...state,
    ...(summaryOverlay || {}),
    app: {
      ...(state.app || {}),
      memory: runtime.memory,
      cpu: runtime.cpu,
    },
    config: configOverride || state.config,
    queue: queuePreview,
    queueInfo: {
      total: publicQueue.length,
      visible: queuePreview.length,
      hidden: Math.max(0, publicQueue.length - queuePreview.length),
    },
    lifetime: db.getLifetimeStats(),
  };
}

function resetState(config) {
  state = createState();
  state.config = { ...defaultConfig(), ...config };
  state.lifetime = db.getLifetimeStats();
}

function captureLastBatchSummary() {
  if (!['done', 'stopped', 'error'].includes(state.status)) return;
  if (!Number(state.counts?.completed || 0)) return;
  lastBatchSummary = {
    counts: { ...state.counts },
    totals: { ...state.totals },
    progress: { ...state.progress },
    recentCompleted: [...(state.recentCompleted || [])],
    recentEvents: [...(state.recentEvents || [])],
  };
}

function publish() {
  const payload = `data: ${JSON.stringify(clonePublicState())}\n\n`;
  for (const client of SSE_CLIENTS) {
    if (client.authorized && (!activeUserId || client.userId === activeUserId)) {
      client.res.write(payload);
    }
  }
}

function pushEvent(message, kind = 'info') {
  const safeMessage = summarizeEventMessage(message);
  state.recentEvents.push({
    time: new Date().toISOString(),
    kind,
    message: safeMessage,
  });
  state.message = safeMessage;
  publish();
}

function summarizeEventMessage(message) {
  const raw = String(message || '').replace(/\s+/g, ' ').trim();
  if (raw.length <= MAX_EVENT_MESSAGE_LENGTH) return raw;
  return `${raw.slice(0, MAX_EVENT_MESSAGE_LENGTH - 1).trim()}…`;
}

function summarizeFfmpegError(stderr, fallback = 'ffmpeg failed') {
  const lines = String(stderr || '')
    .split(/\r?\n/)
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const decodeErrors = lines.filter(line => (
    /Invalid data found when processing input/i.test(line)
    || /Invalid NAL unit size/i.test(line)
    || /Error splitting the input into NAL units/i.test(line)
    || /missing picture in access unit/i.test(line)
    || /SEI type .* truncated/i.test(line)
  ));
  if (decodeErrors.length) {
    return 'Input video appears corrupt or malformed: ffmpeg could not decode the H.264 stream.';
  }
  const usefulLine = [...lines].reverse().find(line => !/^Last message repeated \d+ times$/i.test(line));
  return summarizeEventMessage(usefulLine || fallback);
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function serveFile(res, pathname) {
  const cleanPath = pathname === '/' ? '/index.html' : (pathname === '/admin' ? '/admin.html' : pathname);
  const filePath = path.join(ROOT, cleanPath);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}

function isLocalRequest(req) {
  const remote = String(req.socket?.remoteAddress || '');
  return remote === '127.0.0.1'
    || remote === '::1'
    || remote === '::ffff:127.0.0.1';
}

function authorizeLocalAdmin(req, res) {
  if (!isLocalRequest(req)) {
    send(res, 403, { error: 'Localhost only.' });
    return false;
  }
  return true;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'));
      } catch {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

function tokenFromReq(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  const url = new URL(req.url, `http://${req.headers.host}`);
  return url.searchParams.get('token');
}

async function authenticate(req, res) {
  const token = tokenFromReq(req);
  if (!token) {
    send(res, 401, { error: 'Unauthorized' });
    return null;
  }
  const session = db.getSession(token);
  if (!session) {
    send(res, 401, { error: 'Unauthorized' });
    return null;
  }
  return session;
}

function authorizeApp(session, res) {
  if (!session || session.username !== REMOTE_USERNAME) {
    send(res, 403, {
      error: `Access denied. Only ${REMOTE_USERNAME} can use this app right now.`,
      allowedUsername: REMOTE_USERNAME,
    });
    return false;
  }
  return true;
}

function expandHome(input) {
  if (!input || input === '.') return process.cwd();
  if (input.startsWith('~/')) return path.join(os.homedir(), input.slice(2));
  if (input === '~') return os.homedir();
  return path.resolve(input);
}

function toDisplayPath(resolvedPath, rawInput = '') {
  const home = os.homedir();
  if (rawInput.startsWith('~/') || rawInput === '~') {
    if (resolvedPath === home) return '~';
    if (resolvedPath.startsWith(`${home}${path.sep}`)) return `~/${resolvedPath.slice(home.length + 1)}`;
  }
  return resolvedPath;
}

async function listPathSuggestions(rawInput) {
  const raw = String(rawInput || '').trim();
  if (!raw) return [];
  const expanded = expandHome(raw);
  let baseDir = expanded;
  let prefix = '';
  try {
    const stat = await fs.promises.stat(expanded);
    if (!stat.isDirectory()) {
      baseDir = path.dirname(expanded);
      prefix = path.basename(expanded);
    }
  } catch {
    baseDir = path.dirname(expanded);
    prefix = path.basename(expanded);
  }
  if (!baseDir) return [];
  let entries = [];
  try {
    entries = await fs.promises.readdir(baseDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const prefixLower = prefix.toLowerCase();
  return entries
    .filter(entry => entry.isDirectory())
    .filter(entry => !prefixLower || entry.name.toLowerCase().startsWith(prefixLower))
    .map(entry => toDisplayPath(path.join(baseDir, entry.name), raw))
    .sort((a, b) => a.localeCompare(b));
}

function floorInt(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.floor(num) : fallback;
}

function clampNonNegative(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num : fallback;
}

function ceilDiv(n, d) {
  return Math.floor((n + d - 1) / d);
}

function computeTargetSizeMb(durationSeconds, config) {
  const mbPerMin = clampNonNegative(config?.mbPerMin, DEFAULTS.mbPerMin);
  const mbStep = Math.max(1, clampNonNegative(config?.mbStep, DEFAULTS.mbStep));
  const rawTargetMb = (Math.max(0, Number(durationSeconds) || 0) / 60) * mbPerMin;
  const steps = Math.max(1, ceilDiv(Math.ceil(rawTargetMb * 1000), mbStep * 1000));
  return steps * mbStep;
}

function computeVideoKbps(sizeMb, durationSeconds, config) {
  const totalBits = sizeMb * 1000000 * 8;
  const avgTotalBps = Math.floor(totalBits / durationSeconds);
  const audioBps = clampNonNegative(config.audioKbit, 192) * 1000;
  let videoBps = avgTotalBps - audioBps;
  videoBps = Math.floor(videoBps * (100 - clampNonNegative(config.overheadPct, 1)) / 100);
  const kbps = Math.floor(videoBps / 1000);
  return Math.max(kbps, clampNonNegative(config.minVideoKbit, 300));
}

function clampFraction(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function getCurrentFileCompletionFraction(current) {
  if (!current) return 0;
  if (current.phase === 'moving') return 0;
  if (current.phase === 'done') return 1;

  const duration = Math.max(0, Number(current.durationSeconds) || 0);
  const output = Math.max(0, Number(current.outputSeconds) || 0);
  const fractionalPassProgress = duration > 0
    ? clampFraction(output / duration)
    : clampFraction(Number(current.fileProgressPct || 0) / 100);

  const passMatch = String(current.passLabel || '').match(/^(\d+)\/(\d+)$/);
  if (!passMatch) return fractionalPassProgress;

  const passNumber = Math.max(1, Number(passMatch[1]) || 1);
  const totalPasses = Math.max(1, Number(passMatch[2]) || 1);
  const completedPasses = Math.min(totalPasses - 1, Math.max(0, passNumber - 1));
  return clampFraction((completedPasses + fractionalPassProgress) / totalPasses);
}

function estimateCurrentFileRemainingSeconds(current) {
  if (!current || current.fileRemainingSeconds == null) return null;
  const currentPassRemaining = Math.max(0, Math.round(Number(current.fileRemainingSeconds) || 0));
  const passMatch = String(current.passLabel || '').match(/^(\d+)\/(\d+)$/);
  if (!passMatch) return currentPassRemaining;

  const passNumber = Math.max(1, Number(passMatch[1]) || 1);
  const totalPasses = Math.max(1, Number(passMatch[2]) || 1);
  const remainingFullPasses = Math.max(0, totalPasses - passNumber);
  if (!remainingFullPasses) return currentPassRemaining;

  const speedValue = Number(current.smoothedSpeedX) || parseFloat(String(current.speed || '').replace('x', ''));
  const duration = Math.max(0, Number(current.durationSeconds) || 0);
  if (!Number.isFinite(speedValue) || speedValue <= 0 || duration <= 0) return currentPassRemaining;
  return currentPassRemaining + Math.round((duration / speedValue) * remainingFullPasses);
}

function computeDerivedTotals() {
  state.counts.completed = state.counts.encoded + state.counts.skipped + state.counts.failed;
  state.totals.savingsBytes = state.totals.sourceBytes - state.totals.outputBytes;
  state.totals.savingsPct = state.totals.sourceBytes > 0
    ? (state.totals.savingsBytes / state.totals.sourceBytes) * 100
    : null;
  state.totals.averageSavingsBytes = state.counts.encoded > 0
    ? Math.trunc(state.totals.savingsBytes / state.counts.encoded)
    : null;
  if (state.totals.averageSavingsBytes === null) {
    state.totals.averageSavingsLabel = 'N/A';
  } else if (state.totals.averageSavingsBytes >= 0) {
    state.totals.averageSavingsLabel = `average savings/file: ${formatSizeBytes(state.totals.averageSavingsBytes)}`;
  } else {
    state.totals.averageSavingsLabel = `average loss/file: ${formatSizeBytes(Math.abs(state.totals.averageSavingsBytes))}`;
  }
  state.totals.completedSpeedX = state.totals.encodeSeconds > 0
    ? state.totals.videoSeconds / state.totals.encodeSeconds
    : null;
  state.totals.currentSpeedX = state.totals.completedSpeedX;
  state.totals.averageBitrateKbps = state.totals.videoSeconds > 0
    ? (state.totals.outputBytes * 8 / 1000) / state.totals.videoSeconds
    : null;
  const inFlightFraction = getCurrentFileCompletionFraction(state.currentFile);
  const effectiveCompleted = Math.min(state.counts.total, state.counts.completed + inFlightFraction);
  state.progress.overallPct = state.counts.total > 0
    ? (effectiveCompleted / state.counts.total) * 100
    : 0;
  const currentIndex = Number(state.currentFile?.index || 0);
  const currentTotal = Number(state.currentFile?.total || state.counts.total || 0);
  const isFinalFilePhase = state.active && currentTotal > 0 && currentIndex >= currentTotal;
  if (isFinalFilePhase) {
    const etaSeconds = estimateCurrentFileRemainingSeconds(state.currentFile);
    if (etaSeconds != null) {
      state.progress.remainingSeconds = etaSeconds;
      state.progress.etaIso = new Date(Date.now() + etaSeconds * 1000).toISOString();
    } else {
      state.progress.remainingSeconds = null;
      state.progress.etaIso = null;
    }
  } else if (state.counts.encoded > 0 && state.active) {
    const avgPerFile = state.totals.encodeSeconds / state.counts.encoded;
    const remaining = Math.max(0, state.counts.total - effectiveCompleted);
    const etaSeconds = Math.max(0, Math.round(avgPerFile * remaining));
    state.progress.remainingSeconds = etaSeconds;
    state.progress.etaIso = new Date(Date.now() + etaSeconds * 1000).toISOString();
  } else if (!state.active) {
    state.progress.remainingSeconds = 0;
    state.progress.etaIso = new Date().toISOString();
  } else {
    state.progress.remainingSeconds = null;
    state.progress.etaIso = null;
  }
  state.lifetime = db.getLifetimeStats();
}

function formatSizeBytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  const MB = 1000000;
  const GB = 1024 * MB;
  const TB = 1024 * GB;
  if (value >= TB) return `${(value / TB).toFixed(3)} TB`;
  if (value >= GB) return `${(value / GB).toFixed(2)} GB`;
  return `${(value / MB).toFixed(1)} MB`;
}

function createQueueItem(filePath, index, config, overrides = {}) {
  const fullPath = expandHome(overrides.fullPath || filePath);
  return {
    index,
    name: path.basename(fullPath),
    path: path.dirname(fullPath),
    fullPath,
    status: overrides.status || 'pending',
    tune: String(overrides.tune || config.tune || DEFAULTS.tune),
    saveTo: expandHome(overrides.saveTo || path.dirname(fullPath)),
    audioTrack: normalizeAudioTrack(overrides.audioTrack, 0),
    audioTracks: normalizeAudioTracks(overrides.audioTracks),
  };
}

function summarizeQueue(files, config = state.config) {
  state.queue = files.map((filePath, index) => createQueueItem(filePath, index + 1, config));
  state.queueInfo = { total: state.queue.length, visible: Math.min(state.queue.length, QUEUE_PREVIEW_LIMIT), hidden: Math.max(0, state.queue.length - QUEUE_PREVIEW_LIMIT) };
}

function loadQueueItems(items, config = state.config) {
  state.queue = (items || []).map((item, index) => createQueueItem(item.fullPath, index + 1, config, item));
  state.queueInfo = { total: state.queue.length, visible: Math.min(state.queue.length, QUEUE_PREVIEW_LIMIT), hidden: Math.max(0, state.queue.length - QUEUE_PREVIEW_LIMIT) };
}

async function walkFiles(dir) {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...await walkFiles(entryPath));
    } else if (entry.isFile() && VIDEO_EXTS.has(path.extname(entry.name).toLowerCase())) {
      results.push(entryPath);
    }
  }
  return results;
}

function statSize(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

function execFileJson(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (parseError) {
        reject(parseError);
      }
    });
  });
}

async function probeMedia(filePath) {
  const data = await execFileJson('ffprobe', [
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    '--',
    filePath,
  ]);
  const durationFloat = Number(data.format?.duration || 0);
  const durationSeconds = Number.isFinite(durationFloat) ? Math.max(0, Math.round(durationFloat)) : 0;
  const videoStream = (data.streams || []).find(stream => stream.codec_type === 'video') || {};
  const audioTracks = (data.streams || [])
    .filter(stream => stream.codec_type === 'audio')
    .map((stream, index) => ({
      index,
      streamIndex: Number.isFinite(Number(stream.index)) ? Number(stream.index) : null,
      language: String(stream.tags?.language || '').trim(),
      codec: String(stream.codec_name || stream.codec_long_name || '').trim(),
      channels: Number.isFinite(Number(stream.channels)) ? Number(stream.channels) : null,
      title: String(stream.tags?.title || '').trim(),
    }));
  let totalFrames = Number(videoStream.nb_frames || 0);
  if (!Number.isFinite(totalFrames) || totalFrames <= 0) {
    const rate = String(videoStream.avg_frame_rate || '0/1').split('/').map(Number);
    if (rate.length === 2 && rate[1] > 0 && durationFloat > 0) {
      totalFrames = Math.round((rate[0] / rate[1]) * durationFloat);
    } else {
      totalFrames = null;
    }
  }
  return { durationSeconds, totalFrames, audioTracks };
}

async function enrichQueueAudioTracks(items, concurrency = 4) {
  const queue = [...(items || [])];
  async function worker() {
    while (queue.length) {
      const item = queue.shift();
      if (!item || normalizeAudioTracks(item.audioTracks).length) continue;
      try {
        const probe = await probeMedia(item.fullPath);
        item.audioTracks = normalizeAudioTracks(probe.audioTracks);
      } catch {
        item.audioTracks = [];
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, queue.length)) }, () => worker()));
  return items;
}

function updateQueueItem(filePath, status, extra = null) {
  const item = state.queue.find(entry => entry.fullPath === filePath);
  if (!item) return;
  item.status = status;
  if (extra && typeof extra === 'object') Object.assign(item, extra);
}

function markCompletion(filePath, status) {
  updateQueueItem(filePath, status);
  if (status === 'encoded') {
    state.recentCompleted.push(path.basename(filePath));
  }
}

function persistActiveQueuePlan() {
  if (!activeUserId || !state.config?.sourceRoot) return;
  saveQueuePlan(activeUserId, state.config, state.queue);
}

function createCurrentFile(index, total, inputPath, stagePath, srcSize, durationSeconds, totalFrames, sizeMb, vbKbps, tune, saveTo, audioTrack) {
  return {
    index,
    total,
    name: path.basename(inputPath),
    path: path.dirname(inputPath),
    inputPath,
    stagePath,
    passLabel: '1/2',
    durationSeconds,
    outputSeconds: 0,
    phase: 'encoding',
    fileProgressPct: 0,
    speed: 'N/A',
    smoothedSpeedX: null,
    fps: 'N/A',
    frame: 'N/A',
    totalFrames: totalFrames ?? 'N/A',
    fileRemainingSeconds: null,
    finishTimeIso: null,
    srcSizeBytes: srcSize,
    fileSizeBytes: 0,
    savingsBytes: 0,
    savingsPct: null,
    targetSizeMb: sizeMb,
    estimatedSizeMb: sizeMb,
    estimatedSavingsPct: srcSize > 0 ? ((srcSize - sizeMb * 1000000) / srcSize) * 100 : null,
    bitrateKbps: vbKbps,
    tune,
    saveTo,
    audioTrack,
  };
}

function updateCurrentFileProgress() {
  const current = state.currentFile;
  if (!current) return;
  if (current.phase === 'moving') return;
  const duration = Math.max(0, Number(current.durationSeconds) || 0);
  const output = Math.max(0, Number(current.outputSeconds) || 0);
  current.fileProgressPct = duration > 0 ? Math.min(100, (output / duration) * 100) : 0;
  const speedValue = parseFloat(String(current.speed).replace('x', ''));
  current.fileRemainingSeconds = Number.isFinite(speedValue) && speedValue > 0
    ? Math.max(0, Math.round((duration - output) / speedValue))
    : null;
  current.finishTimeIso = current.fileRemainingSeconds !== null
    ? new Date(Date.now() + current.fileRemainingSeconds * 1000).toISOString()
    : null;
  current.fileSizeBytes = statSize(current.stagePath);
  current.savingsBytes = current.srcSizeBytes - current.fileSizeBytes;
  current.savingsPct = current.srcSizeBytes > 0
    ? (current.savingsBytes / current.srcSizeBytes) * 100
    : null;
  current.bitrateKbps = output > 0
    ? (current.fileSizeBytes * 8 / 1000) / output
    : current.bitrateKbps;
}

function updateCurrentFileMoveProgress(copiedBytes, totalBytes) {
  const current = state.currentFile;
  if (!current) return;
  current.phase = 'moving';
  current.outputSeconds = current.durationSeconds;
  current.fileProgressPct = totalBytes > 0 ? Math.min(100, (copiedBytes / totalBytes) * 100) : 0;
  current.fileRemainingSeconds = null;
  current.finishTimeIso = null;
}

function parseProgressChunk(chunk, currentFile) {
  const lines = chunk.split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const key = line.slice(0, idx);
    const val = line.slice(idx + 1);
    switch (key) {
      case 'out_time_ms':
        currentFile.outputSeconds = Math.floor(Number(val || 0) / 1000000);
        break;
      case 'speed': {
        currentFile.speed = val || 'N/A';
        const parsedSpeed = parseFloat(String(val || '').replace('x', ''));
        if (Number.isFinite(parsedSpeed) && parsedSpeed > 0) {
          currentFile.smoothedSpeedX = currentFile.smoothedSpeedX == null
            ? parsedSpeed
            : ((currentFile.smoothedSpeedX * 0.82) + (parsedSpeed * 0.18));
        }
        break;
      }
      case 'fps':
        currentFile.fps = val || 'N/A';
        break;
      case 'frame':
        currentFile.frame = val || 'N/A';
        break;
      default:
        break;
    }
  }
  updateCurrentFileProgress();
  computeDerivedTotals();
  publish();
}

function buildFfmpegArgs({ inputPath, stagePath, vbKbps, config, pass, passlog, audioTrack }) {
  const audioStreamIndex = normalizeAudioTrack(audioTrack, 0);
  const args = [
    '-y',
    '-hide_banner',
    '-v', config.ffmpegLoglevel,
    '-i', inputPath,
    '-map', '0:v:0',
  ];

  if (pass === 2) {
    args.push('-map', `0:a:${audioStreamIndex}?`);
  }

  args.push(
    '-map_metadata', '-1',
    '-map_chapters', '-1',
    '-sn',
    '-c:v', 'libx264',
    '-preset', config.preset,
    '-tune', config.tune,
    '-profile:v', config.x264Profile,
    '-level', config.x264Level,
    '-pix_fmt', 'yuv420p',
    '-b:v', `${vbKbps}k`
  );

  if (Number(config.encThreads) > 0) {
    args.push('-threads', String(Number(config.encThreads)));
  }

  args.push('-pass', String(pass), '-passlogfile', passlog);

  if (pass === 1) {
    args.push('-f', 'mp4', '-an', '/dev/null');
  } else {
    args.push(
      '-movflags', '+faststart',
      '-c:a', 'aac',
      '-b:a', `${config.audioKbit}k`,
      '-ac', '2',
      stagePath,
    );
  }

  args.push('-progress', 'pipe:1', '-nostats');
  return args;
}

function runFfmpegPass(pass, context) {
  return new Promise((resolve, reject) => {
    const { inputPath, stagePath, vbKbps, config, passlog, audioTrack } = context;
    state.currentFile.passLabel = `${pass}/2`;
    publish();

    const args = buildFfmpegArgs({ inputPath, stagePath, vbKbps, config, pass, passlog, audioTrack });
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    currentChild = child;

    let stdoutBuffer = '';
    let stderrBuffer = '';

    child.stdout.on('data', chunk => {
      stdoutBuffer += chunk.toString();
      parseProgressChunk(stdoutBuffer, state.currentFile);
      if (stdoutBuffer.length > 16000) {
        stdoutBuffer = stdoutBuffer.slice(-8000);
      }
    });

    child.stderr.on('data', chunk => {
      stderrBuffer += chunk.toString();
      if (stderrBuffer.length > 12000) {
        stderrBuffer = stderrBuffer.slice(-12000);
      }
    });

    child.on('error', reject);
    child.on('close', code => {
      if (currentChild === child) currentChild = null;
      if (stdoutBuffer.trim()) {
        parseProgressChunk(stdoutBuffer, state.currentFile);
      }
      if (code === 0) {
        resolve();
      } else if (stopRequested && !stopAfterCurrentRequested) {
        reject(new Error('stopped'));
      } else {
        reject(new Error(summarizeFfmpegError(stderrBuffer, `ffmpeg exited with code ${code}`)));
      }
    });
  });
}

async function ensureDir(dirPath) {
  await fs.promises.mkdir(dirPath, { recursive: true });
}

async function removeIfExists(filePath) {
  try {
    await fs.promises.unlink(filePath);
  } catch {}
}

async function cleanupPasslog(base) {
  await Promise.all([
    removeIfExists(`${base}-0.log`),
    removeIfExists(`${base}-0.log.mbtree`),
    removeIfExists(`${base}.log`),
    removeIfExists(`${base}.mbtree`),
  ]);
}

function copyFileWithProgress(sourcePath, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    let copiedBytes = 0;
    let finished = false;
    let lastReportedAt = 0;
    const readStream = fs.createReadStream(sourcePath);
    const writeStream = fs.createWriteStream(destPath);

    function cleanupAndReject(error) {
      if (finished) return;
      finished = true;
      readStream.destroy();
      writeStream.destroy();
      reject(error);
    }

    readStream.on('data', chunk => {
      copiedBytes += chunk.length;
      if (onProgress) {
        const now = Date.now();
        if ((now - lastReportedAt) >= 120) {
          lastReportedAt = now;
          onProgress(copiedBytes);
        }
      }
      if (stopRequested && !stopAfterCurrentRequested) {
        cleanupAndReject(new Error('stopped'));
      }
    });

    readStream.on('error', cleanupAndReject);
    writeStream.on('error', cleanupAndReject);
    writeStream.on('close', () => {
      if (finished) return;
      finished = true;
      if (onProgress) onProgress(copiedBytes, true);
      resolve();
    });

    readStream.pipe(writeStream);
  });
}

async function promoteStageFile(stagePath, finalPath, onProgress = null) {
  try {
    await fs.promises.rename(stagePath, finalPath);
    return;
  } catch (error) {
    if (!error || error.code !== 'EXDEV') throw error;
  }

  const tempPath = `${finalPath}.part-${process.pid}-${Date.now()}`;
  await ensureDir(path.dirname(finalPath));
  const totalBytes = (await fs.promises.stat(stagePath)).size;
  try {
    if (onProgress) onProgress(0, totalBytes);
    await copyFileWithProgress(stagePath, tempPath, copiedBytes => onProgress && onProgress(copiedBytes, totalBytes));
    await fs.promises.rename(tempPath, finalPath);
    await fs.promises.unlink(stagePath);
    if (onProgress) onProgress(totalBytes, totalBytes);
  } catch (error) {
    await removeIfExists(tempPath);
    throw error;
  }
}

async function pruneEmptySourceDirs(startDir, sourceRoot) {
  let currentDir = path.resolve(startDir);
  const rootDir = path.resolve(sourceRoot);

  while (currentDir.startsWith(`${rootDir}${path.sep}`)) {
    try {
      await fs.promises.rmdir(currentDir);
    } catch (error) {
      if (error && (error.code === 'ENOTEMPTY' || error.code === 'ENOENT')) {
        return;
      }
      throw error;
    }
    currentDir = path.dirname(currentDir);
  }
}

function snapshotForDb() {
  return {
    status: state.status,
    sourceRoot: state.scan.sourceRoot || state.config.sourceRoot,
    outRoot: state.scan.outRoot || state.config.outRoot,
    totalFiles: state.counts.total,
    encoded: state.counts.encoded,
    skipped: state.counts.skipped,
    failed: state.counts.failed,
    sourceBytes: state.totals.sourceBytes,
    outputBytes: state.totals.outputBytes,
    savingsBytes: state.totals.savingsBytes,
    encodeSeconds: state.totals.encodeSeconds,
    videoSeconds: state.totals.videoSeconds,
    startedAt: state.startedAt ? Math.floor(new Date(state.startedAt).getTime() / 1000) : Math.floor(Date.now() / 1000),
    finishedAt: state.finishedAt ? Math.floor(new Date(state.finishedAt).getTime() / 1000) : null,
  };
}

function persistRun() {
  if (!activeRunId) return;
  computeDerivedTotals();
  db.updateJobRun(activeRunId, snapshotForDb());
}

async function encodeFile(queueItem, index, total, config) {
  if (stopRequested) throw new Error('stopped');

  const filePath = queueItem.fullPath;
  const effectiveTune = String(queueItem.tune || config.tune || DEFAULTS.tune);
  const destinationDir = expandHome(queueItem.saveTo || path.dirname(filePath));
  const audioTrack = normalizeAudioTrack(queueItem.audioTrack, 0);
  const rel = path.relative(config.sourceRoot, filePath);
  const relNoExt = rel.replace(path.extname(rel), '');
  const outDir = path.join(config.outRoot, path.dirname(rel));
  const stagePath = path.join(config.outRoot, `${relNoExt}.mp4`);
  const srcDir = path.dirname(filePath);
  const baseNoExt = path.basename(relNoExt);
  const finalPath = path.join(destinationDir, `${baseNoExt}.mp4`);

  await ensureDir(outDir);
  await ensureDir(destinationDir);

  if (fs.existsSync(finalPath)) {
    const finalStat = fs.statSync(finalPath);
    const srcStat = fs.statSync(filePath);
    if (finalStat.mtimeMs > srcStat.mtimeMs) {
      state.counts.skipped += 1;
      markCompletion(filePath, 'skipped');
      persistActiveQueuePlan();
      computeDerivedTotals();
      persistRun();
      pushEvent(`Skipped newer destination: ${finalPath}`, 'warn');
      return;
    }
  }

  const srcSize = statSize(filePath);
  let probe;
  try {
    probe = await probeMedia(filePath);
  } catch (error) {
    state.counts.failed += 1;
    updateQueueItem(filePath, 'failed');
    persistActiveQueuePlan();
    computeDerivedTotals();
    persistRun();
    pushEvent(`Failed ${path.basename(filePath)}: ${error.message}`, 'error');
    return;
  }
  if (!probe.durationSeconds || probe.durationSeconds <= 0) {
    state.counts.skipped += 1;
    markCompletion(filePath, 'skipped');
    persistActiveQueuePlan();
    computeDerivedTotals();
    persistRun();
    pushEvent(`Skipped unreadable duration: ${filePath}`, 'warn');
    return;
  }

  const sizeMb = computeTargetSizeMb(probe.durationSeconds, config);
  const vbKbps = computeVideoKbps(sizeMb, probe.durationSeconds, config);
  const passlog = path.join(os.tmpdir(), `ffpass_${Date.now()}_${Math.random().toString(16).slice(2)}`);
  const fileStarted = Date.now();

  state.currentFile = createCurrentFile(index, total, filePath, stagePath, srcSize, probe.durationSeconds, probe.totalFrames, sizeMb, vbKbps, effectiveTune, destinationDir, audioTrack);
  updateQueueItem(filePath, 'running', { tune: effectiveTune, saveTo: destinationDir, audioTrack });
  publish();
  pushEvent(`Processing ${index}/${total}: ${path.basename(filePath)}`);

  try {
    const fileConfig = { ...config, tune: effectiveTune };
    await runFfmpegPass(1, { inputPath: filePath, stagePath, vbKbps, config: fileConfig, passlog, audioTrack });
    if (stopRequested) throw new Error('stopped');
    await runFfmpegPass(2, { inputPath: filePath, stagePath, vbKbps, config: fileConfig, passlog, audioTrack });

    const stageStat = fs.existsSync(stagePath) ? fs.statSync(stagePath) : null;
    if (!stageStat || stageStat.size <= 0) {
      throw new Error(`Staged output missing: ${stagePath}`);
    }

    const newSize = stageStat.size;
    const moveProgress = (copiedBytes, totalBytes) => {
      updateCurrentFileMoveProgress(copiedBytes, totalBytes);
      publish();
    };

    if (path.extname(filePath).toLowerCase() === '.mp4' && finalPath === filePath) {
      await promoteStageFile(stagePath, filePath, moveProgress);
      state.currentFile.stagePath = filePath;
    } else {
      await promoteStageFile(stagePath, finalPath, moveProgress);
      if (finalPath !== filePath) {
        await fs.promises.unlink(filePath);
        await pruneEmptySourceDirs(srcDir, config.sourceRoot);
      }
      state.currentFile.stagePath = finalPath;
    }
    state.currentFile.phase = 'done';
    state.currentFile.fileProgressPct = 100;

    state.totals.sourceBytes += srcSize;
    state.totals.outputBytes += newSize;
    state.totals.encodeSeconds += Math.max(0, Math.round((Date.now() - fileStarted) / 1000));
    state.totals.videoSeconds += probe.durationSeconds;
    state.counts.encoded += 1;
    markCompletion(filePath, 'encoded');
    persistActiveQueuePlan();
    updateCurrentFileProgress();
    updateQueueItem(filePath, 'encoded');
    computeDerivedTotals();
    persistRun();
    pushEvent(`Encoded ${path.basename(filePath)} to ${formatSizeBytes(newSize)}`, 'success');
  } catch (error) {
    if (String(error.message) === 'stopped' || (stopRequested && !stopAfterCurrentRequested)) {
      updateQueueItem(filePath, 'stopped');
      throw error;
    }
    state.counts.failed += 1;
    updateQueueItem(filePath, 'failed');
    persistActiveQueuePlan();
    computeDerivedTotals();
    persistRun();
    pushEvent(`Failed ${path.basename(filePath)}: ${error.message}`, 'error');
  } finally {
    await cleanupPasslog(passlog);
  }
}

async function runJob(rawConfig, session, queueItems = null) {
  const config = normalizeConfig(rawConfig);
  lastBatchSummary = null;

  resetState(config);
  stopRequested = false;
  stopAfterCurrentRequested = false;
  pauseRequested = false;
  activeUserId = session.user_id;
  state.viewer = { username: session.username, canUseApp: true };
  state.active = true;
  state.stopRequested = false;
  state.stopAfterCurrent = false;
  state.paused = false;
  state.status = 'scanning';
  state.startedAt = new Date().toISOString();
  state.scan.sourceRoot = config.sourceRoot;
  state.scan.outRoot = config.outRoot;
  activeRunId = db.createJobRun(session.user_id, snapshotForDb());
  computeDerivedTotals();
  pushEvent(`Scanning ${config.sourceRoot}...`);

  try {
    const queueSeed = Array.isArray(queueItems) && queueItems.length
      ? queueItems.map(item => ({ ...item }))
      : (await walkFiles(config.sourceRoot)).sort((a, b) => a.localeCompare(b)).map((filePath, index) => createQueueItem(filePath, index + 1, config));
    state.scan.found = queueSeed.length;
    state.counts.total = queueSeed.length;
    loadQueueItems(queueSeed, config);
    saveQueuePlan(session.user_id, config, state.queue);
    computeDerivedTotals();
    persistRun();
    publish();

    if (!queueSeed.length) {
      state.status = 'done';
      state.active = false;
      state.finishedAt = new Date().toISOString();
      saveQueuePlan(session.user_id, config, state.queue);
      persistRun();
      pushEvent('No matching video files found.', 'warn');
      return;
    }

    state.status = 'running';
    persistRun();
    pushEvent(`Found ${queueSeed.length} file(s). Starting encode job.`);

    for (let i = 0; i < queueSeed.length; i += 1) {
      if (stopRequested) throw new Error('stopped');
      if (stopAfterCurrentRequested) throw new Error('stopped-after-current');
      await encodeFile(state.queue[i], i + 1, queueSeed.length, config);
      if (stopAfterCurrentRequested) throw new Error('stopped-after-current');
    }

    state.status = 'done';
    state.active = false;
    state.stopRequested = false;
    state.stopAfterCurrent = false;
    state.paused = false;
    state.finishedAt = new Date().toISOString();
    if (state.currentFile) state.currentFile.passLabel = 'Done';
    updateCurrentFileProgress();
    saveQueuePlan(session.user_id, config, state.queue);
    computeDerivedTotals();
    persistRun();
    pushEvent(`Job complete at ${new Date().toLocaleString()}.`, 'success');
    captureLastBatchSummary();
  } catch (error) {
    if (String(error.message) === 'stopped') {
      state.status = 'stopped';
      state.active = false;
      state.stopRequested = false;
      state.stopAfterCurrent = false;
      state.paused = false;
      state.finishedAt = new Date().toISOString();
      saveQueuePlan(session.user_id, config, state.queue);
      computeDerivedTotals();
      persistRun();
      pushEvent('Job stopped by user.', 'warn');
      captureLastBatchSummary();
      return;
    }
    if (String(error.message) === 'stopped-after-current') {
      state.status = 'stopped';
      state.active = false;
      state.stopRequested = false;
      state.stopAfterCurrent = false;
      state.paused = false;
      state.finishedAt = new Date().toISOString();
      saveQueuePlan(session.user_id, config, state.queue);
      computeDerivedTotals();
      persistRun();
      pushEvent('Job stopped after current file completed.', 'warn');
      captureLastBatchSummary();
      return;
    }
    state.status = 'error';
    state.active = false;
    state.stopRequested = false;
    state.stopAfterCurrent = false;
    state.paused = false;
    state.finishedAt = new Date().toISOString();
    saveQueuePlan(session.user_id, config, state.queue);
    computeDerivedTotals();
    persistRun();
    pushEvent(`Job aborted: ${error.message}`, 'error');
    captureLastBatchSummary();
  } finally {
    currentChild = null;
    pauseRequested = false;
    activeRunId = null;
    state.lifetime = db.getLifetimeStats();
    publish();
    activeUserId = null;
  }
}

async function handleRegister(req, res) {
  const { username, password } = await readBody(req);
  const cleanUsername = String(username || '').trim();
  if (!cleanUsername || !password) {
    send(res, 400, { error: 'Username and password required.' });
    return;
  }
  try {
    const user = await db.createUser(cleanUsername, password);
    const token = db.createSession(user.id);
    send(res, 200, {
      token,
      username: user.username,
      canUseApp: user.username === REMOTE_USERNAME,
      allowedUsername: REMOTE_USERNAME,
    });
  } catch (error) {
    send(res, 409, { error: error.message });
  }
}

async function handleLogin(req, res) {
  const { username, password } = await readBody(req);
  if (!username || !password) {
    send(res, 400, { error: 'Username and password required.' });
    return;
  }
  const user = await db.verifyUser(String(username).trim(), password);
  if (!user) {
    send(res, 401, { error: 'Invalid username or password.' });
    return;
  }
  const token = db.createSession(user.id);
  send(res, 200, {
    token,
    username: user.username,
    canUseApp: user.username === REMOTE_USERNAME,
    allowedUsername: REMOTE_USERNAME,
  });
}

async function handleMe(req, res) {
  const session = await authenticate(req, res);
  if (!session) return;
  send(res, 200, {
    username: session.username,
    canUseApp: session.username === REMOTE_USERNAME,
    allowedUsername: REMOTE_USERNAME,
    config: getPersistedConfig(session.user_id),
    queueInfo: { total: getPersistedQueuePlan(session.user_id).length },
  });
}

function handleLogout(req, res) {
  const token = tokenFromReq(req);
  if (token) db.deleteSession(token);
  send(res, 200, { ok: true });
}

async function handleState(req, res) {
  const session = await authenticate(req, res);
  if (!session) return;
  if (!authorizeApp(session, res)) return;
  const config = state.active && activeUserId === session.user_id ? state.config : getPersistedConfig(session.user_id);
  if (!state.active) hydrateIdleStateForUser(session.user_id, config);
  send(res, 200, {
    ...clonePublicState(config),
    viewer: {
      username: session.username,
      canUseApp: true,
    },
  });
}

async function handleScan(req, res) {
  const session = await authenticate(req, res);
  if (!session) return;
  if (!authorizeApp(session, res)) return;
  if (state.active || runnerPromise) {
    send(res, 409, { error: 'Cannot rescan while a job is running.' });
    return;
  }
  const body = await readBody(req);
  const config = normalizeConfig(body);
  try {
    await fs.promises.access(config.sourceRoot);
  } catch {
    send(res, 400, { error: 'Source root does not exist.' });
    return;
  }

  const files = (await walkFiles(config.sourceRoot)).sort((a, b) => a.localeCompare(b));
  const persistedQueue = getPersistedQueuePlan(session.user_id, config).filter(item => item.fullPath.startsWith(`${config.sourceRoot}${path.sep}`) || item.fullPath === config.sourceRoot);
  const mergedQueue = mergePersistedQueuePlan(files, persistedQueue, config);
  await enrichQueueAudioTracks(mergedQueue);
  resetState(config);
  state.scan.sourceRoot = config.sourceRoot;
  state.scan.outRoot = config.outRoot;
  state.scan.found = mergedQueue.length;
  state.counts.total = mergedQueue.length;
  loadQueueItems(mergedQueue, config);
  computeDerivedTotals();
  db.saveUserSettings(session.user_id, MACHINE_NAME, config);
  saveQueuePlan(session.user_id, config, state.queue);
  pushEvent(mergedQueue.length ? `Loaded ${mergedQueue.length} file(s) for editing.` : 'No matching video files found.');
  send(res, 200, { ok: true, queue: state.queue, state: clonePublicState(config) });
}

async function handleQueue(req, res, url = null) {
  const session = await authenticate(req, res);
  if (!session) return;
  if (!authorizeApp(session, res)) return;
  if (!state.active) hydrateIdleStateForUser(session.user_id);
  if (req.method === 'GET') {
    const publicQueue = getPublicQueue();
    const offset = Math.max(0, floorInt(url?.searchParams.get('offset'), 0));
    const hasLimit = Boolean(url?.searchParams.has('limit'));
    const rawLimit = hasLimit
      ? floorInt(url.searchParams.get('limit'), QUEUE_PREVIEW_LIMIT)
      : publicQueue.length;
    const limit = hasLimit ? Math.max(1, Math.min(200, rawLimit)) : publicQueue.length;
    const queue = publicQueue.slice(offset, offset + limit);
    send(res, 200, {
      queue,
      queueInfo: {
        total: publicQueue.length,
        visible: queue.length,
        offset,
        limit,
        hidden: Math.max(0, publicQueue.length - offset - queue.length),
      },
      state: clonePublicState(getPersistedConfig(session.user_id)),
    });
    return;
  }
  if (state.active || runnerPromise) {
    send(res, 409, { error: 'Cannot edit the queue while a job is running.' });
    return;
  }
  const body = await readBody(req);
  const requestedOrder = Array.isArray(body.order) ? body.order.map(String) : [];
  if (requestedOrder.length) {
    if (requestedOrder.length !== state.queue.length) {
      send(res, 400, { error: 'Queue reorder size mismatch.' });
      return;
    }
    const currentPaths = state.queue.map(item => item.fullPath);
    const currentSet = new Set(currentPaths);
    if (new Set(requestedOrder).size !== requestedOrder.length || requestedOrder.some(filePath => !currentSet.has(filePath))) {
      send(res, 400, { error: 'Queue reorder entries do not match the current queue.' });
      return;
    }
    const byPath = new Map(state.queue.map(item => [item.fullPath, item]));
    state.queue = requestedOrder.map((filePath, index) => createQueueItem(filePath, index + 1, state.config, byPath.get(filePath)));
    state.queueInfo = { total: state.queue.length, visible: Math.min(state.queue.length, QUEUE_PREVIEW_LIMIT), hidden: Math.max(0, state.queue.length - QUEUE_PREVIEW_LIMIT) };
    saveQueuePlan(session.user_id, state.config, state.queue);
    publish();
    send(res, 200, { ok: true, queue: state.queue, state: clonePublicState(getPersistedConfig(session.user_id)) });
    return;
  }

  const filePaths = Array.isArray(body.filePaths) ? body.filePaths.map(String) : [];
  if (!filePaths.length) {
    send(res, 400, { error: 'No files were selected.' });
    return;
  }
  const removeSelected = Boolean(body.remove);
  if (removeSelected) {
    const wanted = new Set(filePaths);
    const nextQueue = state.queue.filter(item => !wanted.has(item.fullPath));
    const removed = state.queue.length - nextQueue.length;
    if (!removed) {
      send(res, 404, { error: 'Selected files were not found in the current queue.' });
      return;
    }
    state.queue = nextQueue.map((item, index) => createQueueItem(item.fullPath, index + 1, state.config, item));
    state.queueInfo = { total: state.queue.length, visible: Math.min(state.queue.length, QUEUE_PREVIEW_LIMIT), hidden: Math.max(0, state.queue.length - QUEUE_PREVIEW_LIMIT) };
    state.scan.found = state.queue.length;
    state.counts.total = state.queue.length;
    computeDerivedTotals();
    saveQueuePlan(session.user_id, state.config, state.queue);
    publish();
    send(res, 200, { ok: true, queue: state.queue, state: clonePublicState(getPersistedConfig(session.user_id)) });
    return;
  }
  const hasTune = Object.prototype.hasOwnProperty.call(body, 'tune');
  const hasSaveTo = Object.prototype.hasOwnProperty.call(body, 'saveTo');
  const hasAudioTrack = Object.prototype.hasOwnProperty.call(body, 'audioTrack');
  if (!hasTune && !hasSaveTo && !hasAudioTrack) {
    send(res, 400, { error: 'Nothing to apply.' });
    return;
  }
  const wanted = new Set(filePaths);
  let updated = 0;
  for (const item of state.queue) {
    if (!wanted.has(item.fullPath)) continue;
    if (hasTune) {
      const rawTune = String(body.tune || '').trim();
      item.tune = rawTune || state.config.tune || DEFAULTS.tune;
    }
    if (hasSaveTo) {
      const rawSaveTo = String(body.saveTo || '').trim();
      item.saveTo = rawSaveTo ? expandHome(rawSaveTo) : path.dirname(item.fullPath);
    }
    if (hasAudioTrack) {
      const rawAudioTrack = String(body.audioTrack || '').trim();
      item.audioTrack = /^\d+$/.test(rawAudioTrack)
        ? normalizeAudioTrack(rawAudioTrack, 0)
        : resolveAudioTrackByLanguage(item, rawAudioTrack);
    }
    updated += 1;
  }
  if (!updated) {
    send(res, 404, { error: 'Selected files were not found in the current queue.' });
    return;
  }
  saveQueuePlan(session.user_id, state.config, state.queue);
  publish();
  send(res, 200, { ok: true, queue: state.queue, state: clonePublicState(getPersistedConfig(session.user_id)) });
}

async function handleStart(req, res) {
  const session = await authenticate(req, res);
  if (!session) return;
  if (!authorizeApp(session, res)) return;
  if (state.active || runnerPromise) {
    send(res, 409, { error: 'A job is already running.' });
    return;
  }
  const body = await readBody(req);
  const config = normalizeConfig(body);
  try {
    await fs.promises.access(config.sourceRoot);
  } catch {
    send(res, 400, { error: 'Source root does not exist.' });
    return;
  }
  db.saveUserSettings(session.user_id, MACHINE_NAME, config);
  if (!state.active) hydrateIdleStateForUser(session.user_id, config);
  const persistedQueue = getPersistedQueuePlan(session.user_id, config);
  const queuedItems = persistedQueue.length
    ? persistedQueue.map(item => ({ ...item }))
    : (!state.active && state.queue.length && state.scan.sourceRoot === config.sourceRoot
      ? state.queue.map(item => ({ ...item }))
      : null);
  runnerPromise = runJob(config, session, queuedItems).finally(() => {
    runnerPromise = null;
  });
  send(res, 200, { ok: true, state: clonePublicState(config) });
}

async function handleStop(req, res) {
  const session = await authenticate(req, res);
  if (!session) return;
  if (!authorizeApp(session, res)) return;
  if (!state.active) {
    send(res, 400, { error: 'No job is running.' });
    return;
  }
  stopRequested = true;
  stopAfterCurrentRequested = false;
  pauseRequested = false;
  state.stopRequested = true;
  state.stopAfterCurrent = false;
  state.paused = false;
  state.message = 'Stopping current job...';
  publish();
  stopActiveChild('SIGCONT');
  forceStopActiveChild();
  send(res, 200, { ok: true, state: clonePublicState(state.config) });
}

async function handlePauseToggle(req, res) {
  const session = await authenticate(req, res);
  if (!session) return;
  if (!authorizeApp(session, res)) return;
  if (!state.active) {
    send(res, 400, { error: 'No job is running.' });
    return;
  }
  if (stopRequested) {
    send(res, 409, { error: 'Stop already requested.' });
    return;
  }
  if (!currentChild || !currentChild.pid) {
    send(res, 409, { error: 'No active ffmpeg process is available.' });
    return;
  }
  const body = await readBody(req);
  const enabled = body && Object.prototype.hasOwnProperty.call(body, 'enabled')
    ? Boolean(body.enabled)
    : !pauseRequested;
  const ok = stopActiveChild(enabled ? 'SIGSTOP' : 'SIGCONT');
  if (!ok) {
    send(res, 409, { error: `Unable to ${enabled ? 'pause' : 'resume'} the current job.` });
    return;
  }
  pauseRequested = enabled;
  state.paused = enabled;
  state.status = enabled ? 'paused' : 'running';
  state.message = enabled ? 'Batch paused.' : 'Batch resumed.';
  publish();
  send(res, 200, { ok: true, enabled, state: clonePublicState(state.config) });
}

async function handleStopAfterCurrent(req, res) {
  const session = await authenticate(req, res);
  if (!session) return;
  if (!authorizeApp(session, res)) return;
  if (!state.active) {
    send(res, 400, { error: 'No job is running.' });
    return;
  }
  if (stopRequested) {
    send(res, 409, { error: 'Immediate stop already requested.' });
    return;
  }
  const body = await readBody(req);
  const enabled = body && Object.prototype.hasOwnProperty.call(body, 'enabled')
    ? Boolean(body.enabled)
    : true;
  stopAfterCurrentRequested = enabled;
  state.stopAfterCurrent = enabled;
  state.message = enabled ? 'Will stop after current file completes.' : 'Continuing batch after current file.';
  publish();
  send(res, 200, { ok: true, enabled, state: clonePublicState(state.config) });
}

async function handlePathSuggest(req, res, url) {
  const session = await authenticate(req, res);
  if (!session) return;
  if (!authorizeApp(session, res)) return;
  const suggestions = await listPathSuggestions(url.searchParams.get('q') || '');
  send(res, 200, { suggestions });
}

async function handleVacuum(req, res) {
  const session = await authenticate(req, res);
  if (!session) return;
  if (!authorizeApp(session, res)) return;
  if (state.active || runnerPromise) {
    send(res, 409, { error: 'Cannot vacuum while a job is running.' });
    return;
  }
  db.vacuumDatabase();
  state.lifetime = db.getLifetimeStats();
  publish();
  send(res, 200, { ok: true, lifetime: state.lifetime });
}

function sanitizeAdminVersion(value) {
  const version = String(value || '').trim();
  if (!version) throw new Error('Version is required.');
  if (version.length > 40) throw new Error('Version must be 40 characters or fewer.');
  if (/[\p{C}\r\n]/u.test(version)) throw new Error('Version contains invalid characters.');
  return version;
}

function sanitizeAdminUsername(value) {
  const username = String(value || '').trim();
  if (!username) throw new Error('Username is required.');
  return username;
}

async function handleAdminState(req, res) {
  if (!authorizeLocalAdmin(req, res)) return;
  const runtime = runtimeStats();
  send(res, 200, {
    app: {
      name: state.app?.name || 'FFmpeg Batch Encode',
      version: db.getAppVersion(APP_VERSION_FALLBACK),
      remoteUsername: REMOTE_USERNAME,
      machineName: MACHINE_NAME,
      cpuCount: os.cpus().length,
      memory: runtime.memory,
      cpu: runtime.cpu,
    },
    users: db.listUsers(),
  });
}

async function handleAdminCreateUser(req, res) {
  if (!authorizeLocalAdmin(req, res)) return;
  const body = await readBody(req);
  const username = sanitizeAdminUsername(body.username);
  const password = String(body.password || '');
  if (!password) {
    send(res, 400, { error: 'Password is required.' });
    return;
  }
  try {
    await db.createUser(username, password);
    send(res, 200, { ok: true, users: db.listUsers() });
  } catch (error) {
    send(res, 409, { error: error.message });
  }
}

async function handleAdminSetPassword(req, res) {
  if (!authorizeLocalAdmin(req, res)) return;
  const body = await readBody(req);
  const username = sanitizeAdminUsername(body.username);
  if (username === REMOTE_USERNAME) {
    send(res, 403, { error: `${REMOTE_USERNAME} cannot be modified from admin.` });
    return;
  }
  const password = String(body.password || '');
  if (!password) {
    send(res, 400, { error: 'Password is required.' });
    return;
  }
  try {
    await db.updateUserPassword(username, password);
    send(res, 200, { ok: true, users: db.listUsers() });
  } catch (error) {
    send(res, 404, { error: error.message });
  }
}

async function handleAdminDeleteUser(req, res) {
  if (!authorizeLocalAdmin(req, res)) return;
  const body = await readBody(req);
  const username = sanitizeAdminUsername(body.username);
  if (username === REMOTE_USERNAME) {
    send(res, 403, { error: `${REMOTE_USERNAME} cannot be deleted.` });
    return;
  }
  const changes = db.deleteUserByUsername(username);
  if (!changes) {
    send(res, 404, { error: 'User not found.' });
    return;
  }
  send(res, 200, { ok: true, users: db.listUsers() });
}

async function handleAdminVersion(req, res) {
  if (!authorizeLocalAdmin(req, res)) return;
  const body = await readBody(req);
  try {
    const version = sanitizeAdminVersion(body.version);
    db.setAppVersion(version);
    state.app.version = version;
    publish();
    send(res, 200, { ok: true, version });
  } catch (error) {
    send(res, 400, { error: error.message });
  }
}

async function handleEvents(req, res) {
  const session = await authenticate(req, res);
  if (!session) return;
  const authorized = session.username === REMOTE_USERNAME;
  if (!authorized) {
    send(res, 403, {
      error: `Access denied. Only ${REMOTE_USERNAME} can use this app right now.`,
      allowedUsername: REMOTE_USERNAME,
    });
    return;
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
  const config = state.active && activeUserId === session.user_id ? state.config : getPersistedConfig(session.user_id);
  if (!state.active) hydrateIdleStateForUser(session.user_id, config);
  res.write(`data: ${JSON.stringify({
    ...clonePublicState(config),
    viewer: { username: session.username, canUseApp: true },
  })}\n\n`);
  const client = { res, userId: session.user_id, authorized: true };
  SSE_CLIENTS.add(client);
  req.on('close', () => {
    SSE_CLIENTS.delete(client);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (req.method === 'GET' && url.pathname === '/admin') {
      if (!authorizeLocalAdmin(req, res)) return;
      serveFile(res, '/admin');
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/admin/state') {
      await handleAdminState(req, res);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/users') {
      await handleAdminCreateUser(req, res);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/users/password') {
      await handleAdminSetPassword(req, res);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/users/delete') {
      await handleAdminDeleteUser(req, res);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/version') {
      await handleAdminVersion(req, res);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/register') {
      await handleRegister(req, res);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/login') {
      await handleLogin(req, res);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/logout') {
      handleLogout(req, res);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/me') {
      await handleMe(req, res);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/state') {
      await handleState(req, res);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/scan') {
      await handleScan(req, res);
      return;
    }
    if ((req.method === 'GET' || req.method === 'POST') && url.pathname === '/api/queue') {
      await handleQueue(req, res, url);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/path-suggest') {
      await handlePathSuggest(req, res, url);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/vacuum') {
      await handleVacuum(req, res);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/events') {
      await handleEvents(req, res);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/start') {
      await handleStart(req, res);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/stop') {
      await handleStop(req, res);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/pause-toggle') {
      await handlePauseToggle(req, res);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/stop-after-current') {
      await handleStopAfterCurrent(req, res);
      return;
    }
    if (req.method === 'GET') {
      if (url.pathname === '/admin.html') {
        if (!authorizeLocalAdmin(req, res)) return;
      }
      serveFile(res, decodeURIComponent(url.pathname));
      return;
    }
    send(res, 404, { error: 'Not found' });
  } catch (error) {
    console.error(error);
    send(res, 500, { error: error.message || 'Server error' });
  }
});

process.on('SIGINT', () => shutdownServer(130));
process.on('SIGTERM', () => shutdownServer(143));
process.on('exit', () => {
  forceStopActiveChild();
});

db.purgeExpiredSessions();

server.listen(PORT, () => {
  console.log(`FFmpeg webapp listening on http://localhost:${PORT}`);
});
