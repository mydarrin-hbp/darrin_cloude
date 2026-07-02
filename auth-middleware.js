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
 * Rolul e citit din user_metadata.role (conform cerinței din PDF, Etapa 2).
 */
function hasRole(user, allowedRoles) {
  const role = user?.user_metadata?.role;
  const roles = user?.user_metadata?.roles; // suport și pentru multi-rol (array)
  if (allowedRoles.includes(role)) return true;
  if (Array.isArray(roles) && roles.some(r => allowedRoles.includes(r))) return true;
  return false;
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
      if (allowedRoles && allowedRoles.length > 0 && !hasRole(user, allowedRoles)) {
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
