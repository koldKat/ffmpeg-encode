const TUNES = new Set(['none', 'animation', 'grain', 'fastdecode', 'zerolatency', 'psnr', 'ssim']);

function normalizeTune(value) {
  const tune = String(value || 'none').trim().toLowerCase();
  // x264's film and stillimage tunes have no x265 equivalent.
  return TUNES.has(tune) ? tune : 'none';
}

module.exports = { normalizeTune };
