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

async function getUserRoles(user) {
  if (!user) return [];
  const set = new Set();

  // Sursa metadata (JWT) — utilă pentru admini invitați prin assign-role,
  // dar poate fi desincronizată față de baza de date (nu se actualizează
  // automat la fiecare schimbare din tabelul profiles).
  const metaRole = user.user_metadata?.role;
  const metaRoles = user.user_metadata?.roles;
  if (metaRole) set.add(metaRole);
  if (Array.isArray(metaRoles)) metaRoles.forEach(r => set.add(r));

  // Sursa reală, autoritativă: tabelul profiles (aceeași sursă pe care
  // o folosesc și politicile RLS din Supabase) — mereu prioritară.
  // Coloana e `roles` (array) — vezi schema.sql; nu există `role` singular
  // (corectat în audit 2026-07-11, dezalinia complet verificarea de rol).
  try {
    const { data } = await sb().from('profiles').select('roles').eq('id', user.id).single();
    if (Array.isArray(data?.roles)) data.roles.forEach(r => set.add(r));
  } catch (e) {
    console.error('Eroare la citirea rolurilor din profiles:', e);
  }

  return Array.from(set);
}

async function hasRole(roleKey) {
  const user = await getCurrentUser();
  const roles = await getUserRoles(user);
  return roles.includes(roleKey);
}

/* ── Înregistrare — Pasul 1 (Etapa 3.2) ── */
// gdprAcceptat: bifa checkbox-ului GDPR din formularul de înregistrare —
// trimisă acum efectiv la Supabase; handle_new_user() din schema.sql o
// citește și setează profiles.gdpr_consimtamant_at (fix audit 2026-07-11,
// coloana era scrisă în schemă dar nu era populată niciodată de niciun cod).
// Parametru opțional, cu fallback la `false`, ca să nu rupem apelurile
// existente din paginile care încă nu au checkbox-ul în UI.
async function performRegister(email, parola, nume, gdprAcceptat) {
  const { data, error } = await sb().auth.signUp({
    email, password: parola,
    options: { data: { nume, roles: [], gdpr_acceptat: !!gdprAcceptat } },
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
  window.location.href = 'https://mydarrin.homebestpal.com';
}

/* ── Recuperare parolă (Etapa 1, audit 2026-07-12) ──
   Folosit atât de link-ul static "Ai uitat parola?" din modalul de login,
   cât și de link-ul injectat dinamic când înregistrarea eșuează pentru că
   emailul există deja (vezi emailDejaInregistrat/injecteazaLinkRecuperareParola). */
async function resetPasswordForEmail(email) {
  const { error } = await sb().auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '/reset-password.html',
  });
  if (error) throw error;
}

// Mesajul exact variază după versiunea GoTrue ("User already registered",
// "A user with this email address has already been registered" etc.) —
// verificăm o substring stabilă, nu un match exact.
function emailDejaInregistrat(err) {
  const msg = ((err && err.message) || '').toLowerCase();
  return msg.includes('already registered') || msg.includes('already been registered') || msg.includes('already exists');
}

// Injectează, sub formularul de înregistrare, un link de recuperare parolă
// legat de emailul introdus — apare doar când Supabase confirmă că emailul
// are deja un cont (nu presupunem asta doar din faptul că signUp a eșuat).
function injecteazaLinkRecuperareParola(container, email) {
  if (!container || !email) return;
  container.innerHTML = '';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.style.cssText = 'display:block;width:100%;text-align:center;margin-top:10px;background:none;border:none;color:#003366;font-size:12.5px;font-weight:700;text-decoration:underline;cursor:pointer;font-family:inherit';
  btn.textContent = 'Acest email are deja un cont — Recuperare parolă';
  btn.onclick = async function () {
    btn.disabled = true;
    btn.style.textDecoration = 'none';
    btn.style.cursor = 'default';
    btn.textContent = 'Se trimite emailul de recuperare...';
    try {
      await resetPasswordForEmail(email);
      btn.textContent = '✓ Email de recuperare trimis — verifică inboxul (și Spam).';
    } catch (e) {
      btn.disabled = false;
      btn.style.textDecoration = 'underline';
      btn.style.cursor = 'pointer';
      btn.textContent = 'Nu am putut trimite recuperarea — încearcă din nou';
    }
  };
  container.appendChild(btn);
}

/* ── Toggle vizibilitate parolă ("eye", Etapa 1, audit 2026-07-12) ──
   btnEl e butonul apăsat (event.currentTarget din onclick inline) —
   evită să mai căutăm un al doilea id doar pentru buton. */
const ICON_EYE_ON  = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>';
const ICON_EYE_OFF = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a18.5 18.5 0 0 1 5.06-5.94M9.9 4.24A10.4 10.4 0 0 1 12 4c7 0 11 7 11 7a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
function togglePasswordVisibility(inputId, btnEl) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const willShow = input.type === 'password';
  input.type = willShow ? 'text' : 'password';
  if (btnEl) {
    btnEl.innerHTML = willShow ? ICON_EYE_OFF : ICON_EYE_ON;
    btnEl.setAttribute('aria-label', willShow ? 'Ascunde parola' : 'Arată parola');
  }
}

/* ════════════════════════════════════════════════════════════════
   BARIERĂ DE SECURITATE — pagini de admin (Etapa 2.1)
   Se apelează la încărcarea mydarrin-superadmin.html /
   mydarrin-backoffice-serviciu.html.
   ════════════════════════════════════════════════════════════════ */
async function enforceSuperadminBarrier() {
  const user = await getCurrentUser();
  const roles = await getUserRoles(user);
  if (!user || !roles.includes('superadmin')) {
    window.location.href = 'https://mydarrin.homebestpal.com';
    return false;
  }
  return true;
}

async function enforceAdminBarrier() {
  const user = await getCurrentUser();
  const roles = await getUserRoles(user);
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
  const roles = await getUserRoles(user);
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
  const roles = await getUserRoles(user);
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
  resetPasswordForEmail, emailDejaInregistrat, injecteazaLinkRecuperareParola,
  togglePasswordVisibility,
};
