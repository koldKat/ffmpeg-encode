const crypto = require('crypto');

class QueueInspectionStore {
  constructor({ ttlMs = 10 * 60 * 1000, maxEntries = 20 } = {}) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.entries = new Map();
  }

  prune(now = Date.now()) {
    for (const [id, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(id);
    }
    while (this.entries.size >= this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value);
    }
  }

  create(userId, value) {
    this.prune();
    const id = crypto.randomUUID();
    this.entries.set(id, {
      userId,
      value,
      expiresAt: Date.now() + this.ttlMs,
    });
    return id;
  }

  consume(id, userId) {
    this.prune();
    const normalizedId = String(id || '');
    const entry = this.entries.get(normalizedId);
    if (!entry || entry.userId !== userId) return null;
    this.entries.delete(normalizedId);
    return entry.value;
  }
}

module.exports = { QueueInspectionStore };
