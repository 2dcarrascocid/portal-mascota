// Hash de contraseñas con scrypt (incluido en Node, sin dependencias nativas).
// Formato guardado: scrypt$N$r$p$salt$hash (base64url).
const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);
const N = 16384;
const R = 8;
const P = 1;
const LARGO = 64;

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password.normalize('NFKC'), salt, LARGO, { N, r: R, p: P });
  return ['scrypt', N, R, P, salt.toString('base64url'), hash.toString('base64url')].join('$');
}

async function verificarPassword(password, guardado) {
  const [alg, n, r, p, salt, hash] = (guardado || '').split('$');
  if (alg !== 'scrypt') return false;
  const esperado = Buffer.from(hash, 'base64url');
  const calculado = await scrypt(password.normalize('NFKC'), Buffer.from(salt, 'base64url'), esperado.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return crypto.timingSafeEqual(calculado, esperado);
}

// Hash de relleno: cuando el email no existe se verifica igual contra él para
// que la respuesta tarde lo mismo y no revele qué emails están registrados.
let hashRelleno;
async function verificarRelleno(password) {
  hashRelleno ??= await hashPassword(crypto.randomBytes(16).toString('hex'));
  await verificarPassword(password, hashRelleno);
  return false;
}

module.exports = { hashPassword, verificarPassword, verificarRelleno };
