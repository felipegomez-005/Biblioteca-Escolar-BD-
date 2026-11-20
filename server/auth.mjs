// Operadores, sesiones y permisos.
// Contraseñas: scrypt con sal aleatoria. Sesiones: memoria del proceso + cookie HttpOnly.
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);
export class AuthError extends Error { constructor(message, status = 401) { super(message); this.status = status; } }

export const ROLES = ['admin', 'bibliotecaria', 'consulta'];
export const COOKIE = 'biblioteca_sesion';
const IDLE_MS = 8 * 60 * 60 * 1000;          // 8 horas sin actividad
const MAX_FALLOS = 5, BLOQUEO_MS = 5 * 60 * 1000;

export async function hashPassword(clave) {
  const salt = randomBytes(16);
  const hash = await scrypt(clave, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}
export async function verifyPassword(clave, stored) {
  const [kind, salt, hash] = String(stored).split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(clave, Buffer.from(salt, 'base64'), expected.length);
  return timingSafeEqual(expected, actual);
}
export function validPassword(clave) {
  if (typeof clave !== 'string' || clave.length < 10 || clave.length > 200)
    throw new AuthError('La contraseña debe tener entre 10 y 200 caracteres.', 400);
  return clave;
}
export function validUsername(usuario) {
  const u = typeof usuario === 'string' ? usuario.trim().toLowerCase() : '';
  if (!/^[a-z0-9._-]{3,40}$/.test(u)) throw new AuthError('Usuario: use de 3 a 40 letras minúsculas, números, punto, guion o guion bajo.', 400);
  return u;
}

// Rutas solo para administración. El resto de escrituras: admin y bibliotecaria.
const SOLO_ADMIN = [/^\/api\/operadores/, /^\/api\/auditoria/, /^\/api\/retencion/, /^\/api\/calendario\/configurar$/, /^\/api\/anulaciones$/];
export function authorize(rol, method, pathname) {
  if (SOLO_ADMIN.some(r => r.test(pathname))) {
    if (rol !== 'admin') throw new AuthError('Esta función es solo para administración.', 403);
    return;
  }
  // La previsualización del calendario no guarda cambios.
  if (method !== 'GET' && rol === 'consulta' && pathname !== '/api/calendario/previsualizar')
    throw new AuthError('Su perfil es de solo consulta.', 403);
}

export function createSessions(now = () => Date.now()) {
  const sessions = new Map(), fallos = new Map();
  return {
    create(op) {
      const token = randomBytes(32).toString('base64url');
      sessions.set(token, { id: op.id, usuario: op.usuario, nombre: op.nombre, rol: op.rol, vence: now() + IDLE_MS });
      return token;
    },
    get(token) {
      const s = token && sessions.get(token);
      if (!s) return null;
      if (s.vence < now()) { sessions.delete(token); return null; }
      s.vence = now() + IDLE_MS;
      return s;
    },
    destroy(token) { sessions.delete(token); },
    // Cierra sesiones de un operador desactivado o con cambio de rol/clave.
    dropOperator(id) { for (const [t, s] of sessions) if (s.id === id) sessions.delete(t); },
    checkLock(usuario) {
      const f = fallos.get(usuario);
      if (f && f.hasta > now()) throw new AuthError('Demasiados intentos fallidos. Espere 5 minutos.', 429);
    },
    fail(usuario) {
      const f = fallos.get(usuario) || { n: 0, hasta: 0 };
      f.n++; if (f.n >= MAX_FALLOS) { f.hasta = now() + BLOQUEO_MS; f.n = 0; }
      fallos.set(usuario, f);
    },
    success(usuario) { fallos.delete(usuario); },
  };
}

export function readCookie(header, name = COOKIE) {
  for (const part of String(header || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}
export function sessionCookie(token) {
  return token
    ? `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${IDLE_MS / 1000}`
    : `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
}

// Resumen seguro del formulario para la auditoría: nunca guarda contraseñas.
export function auditDetail(body) {
  const out = {};
  for (const [k, v] of Object.entries(body || {})) {
    if (/clave|password|token|consulta_id/i.test(k)) continue;
    out[k] = typeof v === 'string' && v.length > 300 ? v.slice(0, 300) + '…' : v;
  }
  return out;
}
