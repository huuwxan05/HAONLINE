const buckets = new Map();

export function rateLimit({ windowMs = 60000, max = 60, key = (req) => req.ip, message } = {}) {
  return (req, res, next) => {
    const bucketKey = key(req);
    const nowMs = Date.now();
    let bucket = buckets.get(bucketKey);
    if (!bucket || bucket.resetAt < nowMs) {
      bucket = { count: 0, resetAt: nowMs + windowMs };
      buckets.set(bucketKey, bucket);
    }
    bucket.count += 1;
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(max - bucket.count, 0)));
    if (bucket.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - nowMs) / 1000)));
      return res.status(429).json({ error: { code: 'rate_limited', message: message || 'Quá nhiều yêu cầu, vui lòng thử lại sau' } });
    }
    next();
  };
}

setInterval(() => {
  const nowMs = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt < nowMs) buckets.delete(key);
  }
}, 300000).unref();
