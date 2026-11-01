const clients = new Map();

export function addClient(userId, res) {
  if (!clients.has(userId)) clients.set(userId, new Set());
  const set = clients.get(userId);
  set.add(res);
  res.write(`event: ready\ndata: ${JSON.stringify({ ok: true, at: new Date().toISOString() })}\n\n`);
  const ping = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      clearInterval(ping);
    }
  }, 25000);
  ping.unref();
  return () => {
    clearInterval(ping);
    set.delete(res);
    if (set.size === 0) clients.delete(userId);
  };
}

export function sendTo(userId, event, data) {
  const set = clients.get(userId);
  if (!set) return 0;
  let sent = 0;
  for (const res of set) {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      sent += 1;
    } catch {
      set.delete(res);
    }
  }
  return sent;
}

export function sendToMany(userIds, event, data) {
  for (const userId of new Set(userIds)) sendTo(userId, event, data);
}

export function onlineUsers() {
  return [...clients.keys()];
}

export function onlineCount() {
  return clients.size;
}
