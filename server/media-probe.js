const { APP_CONFIG } = require('./app-config');

function createMediaProbe({
  execFile,
  fs,
  path,
  videoExtensions,
  isPreservedSourceOutput,
  normalizeAudioTracks,
  ffprobeMaxBufferBytes = APP_CONFIG.media.ffprobeMaxBufferBytes,
  defaultConcurrency = APP_CONFIG.queue.audioProbeConcurrency,
}) {
  async function walkFiles(directory, onFile = null) {
    const entries = await fs.promises.readdir(directory, { withFileTypes: true });
    const results = [];
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        results.push(...await walkFiles(entryPath, onFile));
      } else if (entry.isFile()
        && videoExtensions.has(path.extname(entry.name).toLowerCase())
        && !isPreservedSourceOutput(entry.name)) {
        results.push(entryPath);
        onFile?.(entryPath);
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

  function execFileJson(command, args) {
    return new Promise((resolve, reject) => {
      execFile(command, args, { maxBuffer: ffprobeMaxBufferBytes }, (error, stdout) => {
        if (error) return reject(error);
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
      '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', '--', filePath,
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
      totalFrames = rate.length === 2 && rate[1] > 0 && durationFloat > 0
        ? Math.round((rate[0] / rate[1]) * durationFloat)
        : null;
    }
    return { durationSeconds, totalFrames, audioTracks };
  }

  async function enrichQueueAudioTracks(items, concurrency = defaultConcurrency, onProgress = null) {
    const queue = [...(items || [])];
    async function worker() {
      while (queue.length) {
        const item = queue.shift();
        if (!item) continue;
        if (!normalizeAudioTracks(item.audioTracks).length) {
          try {
            item.audioTracks = normalizeAudioTracks((await probeMedia(item.fullPath)).audioTracks);
          } catch {
            item.audioTracks = [];
          }
        }
        onProgress?.(item);
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, queue.length)) }, () => worker()));
    return items;
  }

  return { enrichQueueAudioTracks, probeMedia, statSize, walkFiles };
}

module.exports = { createMediaProbe };
