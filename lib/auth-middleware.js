// lib/auth-middleware.js
// Middleware de autentificare + RBAC pentru funcțiile /api.
// FAIL-CLOSED: orice eroare sau lipsă de date => 401/403, niciodată acces implicit.
// (Corectează exact clasa de bug găsită în audit la upload.js — fail-open.)

const { supabaseAdmin } = require('./supabaseAdmin');

/**
 * Extrage și validează utilizatorul din headerul Authorization: Bearer <jwt>.
 * @returns {Promise<{user: object}|null>} null dacă nu e autentificat
 */
async function getAuthenticatedUser(req) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

/**
 * Verifică dacă utilizatorul are unul din rolurile permise.
 * Singura sursă: `profiles.roles`, citit cu service_role (securitate,
 * 14 oct. 2026). user_metadata NU se folosește: utilizatorul și-l poate
 * scrie singur (signUp / auth.updateUser). La orice eroare de citire:
 * refuz (fail-closed).
 */
async function hasRole(user, allowedRoles) {
  if (!user?.id) return false;
  try {
    const { data, error } = await supabaseAdmin.from('profiles').select('roles').eq('id', user.id).single();
    if (error) {
      console.error('[auth-middleware] eroare la citirea profiles.roles:', error);
      return false;
    }
    return Array.isArray(data?.roles) && data.roles.some(r => allowedRoles.includes(r));
  } catch (e) {
    console.error('[auth-middleware] eroare la citirea profiles.roles:', e);
    return false;
  }
}

/**
 * Wrapper pentru handler-ele Vercel — protejează un endpoint cu autentificare + rol.
 *
 * Exemplu de utilizare într-un fișier din /api:
 *   const { requireAuth } = require('../../lib/auth-middleware');
 *   module.exports = requireAuth(['superadmin'], async (req, res, user) => { ... });
 */
function requireAuth(allowedRoles, handler) {
  return async function (req, res) {
    try {
      const user = await getAuthenticatedUser(req);
      if (!user) {
        return res.status(401).json({ error: 'Neautentificat' });
      }
      if (allowedRoles && allowedRoles.length > 0 && !(await hasRole(user, allowedRoles))) {
        return res.status(403).json({ error: 'Nu ai permisiunea necesară pentru acest rol' });
      }
      return handler(req, res, user);
    } catch (err) {
      console.error('[auth-middleware]', err);
      return res.status(500).json({ error: 'Eroare internă de autentificare' });
    }
  };
}

module.exports = { requireAuth, getAuthenticatedUser, hasRole };
