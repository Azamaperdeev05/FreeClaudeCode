/**
 * Shared by omni-keys.js and omni-keys-proxy.js. Keeping one copy means the quota
 * reset text is identical in dev and in the packaged exe.
 */
function formatDuration(ms) {
  if (ms == null || Number.isNaN(ms)) return "—";
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}с`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}м ${rs}с`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 48) return `${h}ч ${rm}м`;
  const d = Math.floor(h / 24);
  return `${d}д ${h % 24}ч`;
}

module.exports = formatDuration;
