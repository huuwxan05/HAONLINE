export function wrap(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

export function ok(res, data = {}, status = 200) {
  res.status(status).json(data);
}

export function created(res, data = {}) {
  res.status(201).json(data);
}

export function noContent(res) {
  res.status(204).end();
}
