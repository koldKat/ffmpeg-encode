class ActiveQueueOrderError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'ActiveQueueOrderError';
    this.status = status;
  }
}

function reorderActiveQueue({ queue, publicPaths, activePath, requestedOrder }) {
  const visiblePrefix = publicPaths.slice(0, requestedOrder.length);
  if (requestedOrder.length < 2
    || requestedOrder[0] !== activePath
    || new Set(requestedOrder).size !== requestedOrder.length
    || requestedOrder.some(filePath => !visiblePrefix.includes(filePath))
    || visiblePrefix.some(filePath => !requestedOrder.includes(filePath))) {
    throw new ActiveQueueOrderError('Only pending files after the current encode can be reordered.');
  }

  const currentIndex = queue.findIndex(item => item.fullPath === activePath);
  if (currentIndex < 0) {
    throw new ActiveQueueOrderError('The current encode changed before the queue could be reordered.', 409);
  }
  const byPath = new Map(queue.map(item => [item.fullPath, item]));
  const reorderedPaths = new Set(requestedOrder.slice(1));
  const untouchedSuffix = queue
    .slice(currentIndex + 1)
    .filter(item => !reorderedPaths.has(item.fullPath));
  return [
    ...queue.slice(0, currentIndex + 1),
    ...requestedOrder.slice(1).map(filePath => byPath.get(filePath)),
    ...untouchedSuffix,
  ].map((item, index) => ({ ...item, index: index + 1 }));
}

module.exports = { ActiveQueueOrderError, reorderActiveQueue };
