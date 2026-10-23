function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const APP_CONFIG = Object.freeze({
  identity: Object.freeze({
    name: 'FFmpeg Batch Encode',
    dashboardLabel: 'Client + Server Encode Dashboard',
    footerBrand: 'koldKat productions',
  }),
  access: Object.freeze({
    authorizedUsername: process.env.FFMPEG_WEBAPP_USERNAME || 'koldKat',
  }),
  runtime: Object.freeze({
    port: positiveInteger(process.env.PORT, 3017),
    processClockTicks: positiveInteger(process.env.CLK_TCK, 100),
  }),
  encodingDefaults: Object.freeze({
    sourceRoot: '.',
    outRoot: '~/Videos',
    tune: 'film',
    preset: 'slow',
    mbPerMin: 10,
    mbStep: 50,
    audioKbit: 192,
    minVideoKbit: 300,
    overheadPct: 1, // Internal size safety margin.
    nice: 15,
    ffmpegLoglevel: 'error',
    x264Profile: 'high',
    x264Level: '4.1',
    encThreads: 0,
    deleteSource: false,
  }),
  session: Object.freeze({
    inactivityTtlSeconds: 7 * 24 * 60 * 60,
  }),
  queue: Object.freeze({
    previewLimit: 50,
    apiPageLimit: 200,
    audioProbeConcurrency: 4,
    inspectionTtlMs: 10 * 60 * 1000,
    inspectionMaxEntries: 20,
  }),
  media: Object.freeze({
    videoExtensions: Object.freeze(['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.mpeg', '.mpg', '.m4v']),
    ffprobeMaxBufferBytes: 10 * 1024 * 1024,
    ffmpegStdoutBufferLimit: 16_000,
    ffmpegStdoutBufferRetain: 8_000,
    ffmpegStderrBufferLimit: 12_000,
    promotionProgressIntervalMs: 120,
  }),
  timing: Object.freeze({
    forceKillDelayMs: 1_500,
    shutdownForceExitDelayMs: 2_500,
    cpuSampleIntervalMs: 250,
  }),
  limits: Object.freeze({
    eventMessageLength: 420,
  }),
  eta: Object.freeze({
    minElapsedSeconds: 20,
    minProgressPoints: 0.002,
  }),
});

module.exports = { APP_CONFIG };
