/* ════════════════════════════════════════════════════════════════
   MY DARRIN — Sistem Cont Unificat (v2) — Supabase Auth real
   ════════════════════════════════════════════════════════════════
   Înlocuiește versiunea veche bazată pe sessionStorage. Sesiunea e
   acum gestionată de Supabase (JWT în localStorage, gestionat de
   supabase-js — vezi lib/supabaseClient.js, care trebuie inclus
   ÎNAINTEA acestui fișier în fiecare pagină HTML).
   ════════════════════════════════════════════════════════════════ */

const ROLE_META = {
  client:             { icon:'🛍',  title:'Client',                  dashLink:'mydarrin-dashboard-client.html' },
  partener_servicii:  { icon:'🔧',  title:'Furnizor de Servicii',     dashLink:'mydarrin-dashboard-partener.html?type=servicii' },
  partener_materiale: { icon:'📦',  title:'Furnizor de Materiale',    dashLink:'mydarrin-dashboard-furnizor.html?type=materiale' },
  partener_inchirieri:{ icon:'🏗',  title:'Furnizor de Închirieri',   dashLink:'mydarrin-dashboard-furnizor.html?type=inchirieri' },
  partener_curier:    { icon:'🚚',  title:'Curier de Cartier',        dashLink:'mydarrin-dashboard-partener.html?type=curier' },
  partener_asigurari: { icon:'🛡',  title:'Furnizor de Asigurări',    dashLink:'mydarrin-dashboard-partener.html?type=asigurari' },
  investor:           { icon:'📈', title:'Investitor',               dashLink:'mydarrin-investitori.html' },
  admin:              { icon:'🛠',  title:'Admin',                    dashLink:'mydarrin-backoffice-serviciu.html' },
  superadmin:         { icon:'👑', title:'Super Admin',               dashLink:'mydarrin-superadmin.html' },
};

function sb() {
  if (!window.supabaseClient) throw new Error('Supabase client neinițializat — include lib/supabaseClient.js înaintea account-system.js');
  return window.supabaseClient;
}

/* ── Sesiune curentă ── */
async function getCurrentUser() {
  const { data, error } = await sb().auth.getUser();
  if (error || !data?.user) return null;
  return data.user;
}

function getUserRoles(user) {
  if (!user) return [];
  const role = user.user_metadata?.role;
  const roles = user.user_metadata?.roles;
  const set = new Set();
  if (role) set.add(role);
  if (Array.isArray(roles)) roles.forEach(r => set.add(r));
  return Array.from(set);
}

async function hasRole(roleKey) {
  const user = await getCurrentUser();
  return getUserRoles(user).includes(roleKey);
}

/* ── Înregistrare — Pasul 1 (Etapa 3.2) ── */
async function performRegister(email, parola, nume) {
  const { data, error } = await sb().auth.signUp({
    email, password: parola,
    options: { data: { nume, roles: [] } },
  });
  if (error) throw error;
  return data.user; // status: pending_otp până la verificarea telefonului (pasul 2)
}

/* ── Pasul 2 — OTP telefon (apelează /api/auth/verify-otp) ── */
async function verifyPhoneOtp(telefon, cod) {
  const session = (await sb().auth.getSession()).data.session;
  const res = await fetch('/api/auth/verify-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
    body: JSON.stringify({ telefon, cod }),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Verificare OTP eșuată');
  return res.json();
}

/* ── Login ── */
async function performLogin(email, parola) {
  const { data, error } = await sb().auth.signInWithPassword({ email, password: parola });
  if (error) throw error;
  return data.user;
}

async function performLogout() {
  await sb().auth.signOut();
  window.location.href = 'mydarrin-v3.html';
}

/* ════════════════════════════════════════════════════════════════
   BARIERĂ DE SECURITATE — pagini de admin (Etapa 2.1)
   Se apelează la încărcarea mydarrin-superadmin.html /
   mydarrin-backoffice-serviciu.html.
   ════════════════════════════════════════════════════════════════ */
async function enforceSuperadminBarrier() {
  const user = await getCurrentUser();
  const roles = getUserRoles(user);
  if (!user || !roles.includes('superadmin')) {
    window.location.href = 'https://mydarrin.homebestpal.com';
    return false;
  }
  return true;
}

async function enforceAdminBarrier() {
  const user = await getCurrentUser();
  const roles = getUserRoles(user);
  if (!user || !(roles.includes('admin') || roles.includes('superadmin'))) {
    window.location.href = 'https://mydarrin.homebestpal.com';
    return false;
  }
  return true;
}

/* ── Verifică o permisiune granulară pentru secțiuni sensibile ──
   Superadmin trece mereu. Un admin obișnuit trece DOAR dacă are
   o înregistrare în admin_permissions pentru acea secțiune, cu
   poate_scrie = true (acordată explicit de un superadmin din RBAC). */
async function enforceSuperadminOrPermission(sectiune) {
  const user = await getCurrentUser();
  const roles = getUserRoles(user);
  if (!user) {
    window.location.href = 'https://mydarrin.homebestpal.com';
    return false;
  }
  if (roles.includes('superadmin')) return true;

  if (roles.includes('admin')) {
    try {
      const { data, error } = await sb()
        .from('admin_permissions')
        .select('poate_scrie')
        .eq('admin_id', user.id)
        .eq('sectiune', sectiune)
        .maybeSingle();
      if (!error && data && data.poate_scrie) return true;
    } catch (e) {
      console.error('Eroare la verificarea permisiunii:', e);
    }
  }

  window.location.href = 'https://mydarrin.homebestpal.com';
  return false;
}

/* ════════════════════════════════════════════════════════════════
   ADMINISTRARE — invitare admini secundari + roluri (Etapa 2.2/2.3)
   Apelurile reale către supabase.auth.admin.* rulează DOAR server-side
   (necesită service_role key) — vezi /api/admin/invite-admin.js.
   ════════════════════════════════════════════════════════════════ */
async function inviteSecondaryAdmin(email, permisiuni) {
  const session = (await sb().auth.getSession()).data.session;
  const res = await fetch('/api/admin/invite-admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
    body: JSON.stringify({ email, permisiuni }),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Invitație eșuată');
  return res.json();
}

/* ── UI helpers (păstrate din varianta veche, adaptate la sesiune reală) ── */
async function renderActiveRolesBadge(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const user = await getCurrentUser();
  const roles = getUserRoles(user);
  if (roles.length === 0) { el.innerHTML = ''; return; }
  el.innerHTML = roles.map(function (key) {
    const r = ROLE_META[key];
    if (!r) return '';
    return '<span style="display:inline-flex;align-items:center;gap:3px;font-size:10px;font-weight:700;padding:3px 9px;border-radius:99px;background:#EBF4FB;color:#003366;margin-right:4px">' + r.icon + ' ' + r.title + '</span>';
  }).join('');
}

window.MyDarrinAuth = {
  getCurrentUser, getUserRoles, hasRole,
  performRegister, verifyPhoneOtp, performLogin, performLogout,
  enforceSuperadminBarrier, enforceAdminBarrier, enforceSuperadminOrPermission,
  inviteSecondaryAdmin, renderActiveRolesBadge,
};
