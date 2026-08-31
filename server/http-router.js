function createHttpRouter({ authorizeLocalAdmin, handlers, send, serveFile }) {
  const routes = new Map([
    ['GET /api/admin/state', handlers.adminState],
    ['POST /api/admin/users', handlers.adminCreateUser],
    ['POST /api/admin/users/password', handlers.adminSetPassword],
    ['POST /api/admin/users/delete', handlers.adminDeleteUser],
    ['POST /api/admin/version', handlers.adminVersion],
    ['POST /api/admin/settings', handlers.adminSettings],
    ['POST /api/register', handlers.register],
    ['POST /api/login', handlers.login],
    ['POST /api/logout', handlers.logout],
    ['GET /api/me', handlers.me],
    ['GET /api/state', handlers.state],
    ['POST /api/scan', handlers.scan],
    ['GET /api/queue', handlers.queue],
    ['POST /api/queue', handlers.queue],
    ['POST /api/queue/delete-source', handlers.queueDeleteSource],
    ['POST /api/queue/append', handlers.queueAppend],
    ['POST /api/queue/inspect', handlers.queueInspect],
    ['POST /api/queue/reorder-active', handlers.activeQueueOrder],
    ['GET /api/path-suggest', handlers.pathSuggest],
    ['POST /api/vacuum', handlers.vacuum],
    ['GET /api/events', handlers.events],
    ['POST /api/start', handlers.start],
    ['POST /api/stop', handlers.stop],
    ['POST /api/pause-toggle', handlers.pauseToggle],
    ['POST /api/stop-after-current', handlers.stopAfterCurrent],
  ]);

  return async function dispatch(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/admin') {
      if (authorizeLocalAdmin(req, res)) serveFile(req, res, '/admin');
      return;
    }

    const handler = routes.get(`${req.method} ${url.pathname}`);
    if (handler) {
      await handler(req, res, url);
      return;
    }

    if (req.method === 'GET') {
      if (url.pathname === '/admin.html' && !authorizeLocalAdmin(req, res)) return;
      serveFile(req, res, decodeURIComponent(url.pathname));
      return;
    }
    send(res, 404, { error: 'Not found' });
  };
}

module.exports = { createHttpRouter };
