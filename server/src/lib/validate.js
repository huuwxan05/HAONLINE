import { badRequest } from './errors.js';

export function str(value, { field = 'field', min = 0, max = 10000, required = true } = {}) {
  if (value === undefined || value === null) {
    if (required) throw badRequest(`Thiếu ${field}`);
    return '';
  }
  if (typeof value !== 'string') throw badRequest(`${field} phải là chuỗi`);
  const v = value.trim();
  if (v.length < min) throw badRequest(`${field} quá ngắn`);
  if (v.length > max) throw badRequest(`${field} quá dài`);
  return v;
}

export function optionalStr(value, opts = {}) {
  if (value === undefined || value === null || value === '') return null;
  return str(value, { ...opts, required: false });
}

export function email(value) {
  const v = str(value, { field: 'email', max: 255 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw badRequest('Email không hợp lệ');
  return v;
}

export function username(value) {
  const v = str(value, { field: 'username', min: 3, max: 32 }).toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9._]{1,30})[a-z0-9]$/.test(v)) {
    throw badRequest('Username chỉ gồm chữ thường, số, dấu chấm, gạch dưới');
  }
  return v;
}

export function password(value) {
  const v = str(value, { field: 'password', min: 8, max: 200 });
  if (!/[A-Za-z]/.test(v) || !/[0-9]/.test(v)) throw badRequest('Mật khẩu phải có chữ và số');
  return v;
}

export function oneOf(value, allowed, field = 'field', fallback = null) {
  if ((value === undefined || value === null || value === '') && fallback !== null) return fallback;
  const v = str(value, { field });
  if (!allowed.includes(v)) throw badRequest(`${field} không hợp lệ`);
  return v;
}

export function int(value, { field = 'field', min = -Infinity, max = Infinity, fallback = 0 } = {}) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n)) throw badRequest(`${field} phải là số nguyên`);
  if (n < min || n > max) throw badRequest(`${field} ngoài phạm vi`);
  return n;
}

export function date(value, field = 'date', required = true) {
  if (!value) {
    if (required) throw badRequest(`Thiếu ${field}`);
    return null;
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw badRequest(`${field} không hợp lệ`);
  return d.toISOString();
}

export function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return value === 'true' || value === '1' || value === 1;
}

export function object(value, field = 'body') {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw badRequest(`${field} không hợp lệ`);
  return value;
}
