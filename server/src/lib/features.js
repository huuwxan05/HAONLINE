import { get } from '../db.js';
import { forbidden } from './errors.js';

export function featureEnabled(key, fallback = true) {
  const row = get('SELECT value FROM app_settings WHERE key = ?', key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) !== false;
  } catch {
    return fallback;
  }
}

export function requireFeature(key) {
  if (!featureEnabled(key)) throw forbidden('Tính năng này đang tạm đóng');
}
