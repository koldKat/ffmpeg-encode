const crypto = require('crypto');
const { APP_CONFIG } = require('./app-config');

class QueueInspectionStore {
  constructor({
    ttlMs = APP_CONFIG.queue.inspectionTtlMs,
    maxEntries = APP_CONFIG.queue.inspectionMaxEntries,
  } = {}) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.entries = new Map();
  }

  prune(now = Date.now()) {
    for (const [id, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(id);
    }
  }

  create(userId, value) {
    this.prune();
    while (this.entries.size >= this.maxEntries) this.entries.delete(this.entries.keys().next().value);
    const id = crypto.randomUUID();
    this.entries.set(id, {
      userId,
      value,
      expiresAt: Date.now() + this.ttlMs,
    });
    return id;
  }

  get(id, userId, runId) {
    this.prune();
    const normalizedId = String(id || '');
    const entry = this.entries.get(normalizedId);
    if (!entry || entry.userId !== userId || (runId !== undefined && entry.value.runId !== runId)) return null;
    return entry.value;
  }

  consume(id, userId, runId) {
    const value = this.get(id, userId, runId);
    if (value) this.entries.delete(String(id));
    return value;
  }
}

module.exports = { QueueInspectionStore };
