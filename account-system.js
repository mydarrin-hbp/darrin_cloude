/* ════════════════════════════════════════════════════════════════
   MY DARRIN — Sistem Cont Unificat (multi-rol)
   ════════════════════════════════════════════════════════════════
   Un singur cont de bază (email/parolă) la care se pot adăuga,
   independent, orice combinație de roluri:
     client | partner_servicii | partner_materiale | partner_inchirieri
     | partner_curier | partner_asigurari | investor

   Crearea contului NU obligă alegerea unui rol — utilizatorul poate
   naviga liber ca "doar cont" și adaugă roluri când vrea, din meniu.

   Persistență: sessionStorage (simulare — vezi nota din mydarrin-auth-schema.html
   pentru arhitectura reală de backend necesară unei implementări permanente).
   ════════════════════════════════════════════════════════════════ */

const ROLE_META = {
  client:             { icon:'🛍',  title:'Client',                  color:'#003366', bg:'linear-gradient(135deg,#EBF4FB,#DDE6F5)', dashLink:'mydarrin-dashboard-client.html' },
  partner_servicii:   { icon:'🔧',  title:'Furnizor de Servicii',     color:'#FF8C00', bg:'linear-gradient(135deg,#FFF0D6,#FDE8C4)', dashLink:'mydarrin-dashboard-partener.html?type=servicii' },
  partner_materiale:  { icon:'📦',  title:'Furnizor de Materiale',    color:'#003366', bg:'linear-gradient(135deg,#EBF4FB,#DDE6F5)', dashLink:'mydarrin-dashboard-furnizor.html?type=materiale' },
  partner_inchirieri: { icon:'🏗',  title:'Furnizor de Închirieri',   color:'#0E9E99', bg:'linear-gradient(135deg,#E0F5F4,#C5EEEC)', dashLink:'mydarrin-dashboard-furnizor.html?type=inchirieri' },
  partner_curier:     { icon:'🚚',  title:'Curier de Cartier',        color:'#7C3AED', bg:'linear-gradient(135deg,#F3EEFF,#E9D8FD)', dashLink:'mydarrin-dashboard-partener.html?type=curier' },
  partner_asigurari:  { icon:'🛡',  title:'Furnizor de Asigurări',    color:'#1A7A3A', bg:'linear-gradient(135deg,#D4EDDA,#B8DFC5)', dashLink:'mydarrin-dashboard-partener.html?type=asigurari' },
  investor:           { icon:'📈', title:'Investitor',               color:'#CC7000', bg:'linear-gradient(135deg,#FFF3E0,#FFE0B2)', dashLink:'mydarrin-investitori.html' },
};

const ACCOUNT_STORAGE_KEY = 'myd_account';

/* ── Citire / scriere cont ── */
function getAccount() {
  try {
    const raw = sessionStorage.getItem(ACCOUNT_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch(e) { return null; }
}

function saveAccount(account) {
  try { sessionStorage.setItem(ACCOUNT_STORAGE_KEY, JSON.stringify(account)); } catch(e) {}
}

function isAccountCreated() {
  return getAccount() !== null;
}

function hasRole(roleKey) {
  const acc = getAccount();
  return !!(acc && Array.isArray(acc.roles) && acc.roles.includes(roleKey));
}

function addRole(roleKey, extraData) {
  let acc = getAccount();
  if (!acc) return false;
  if (!Array.isArray(acc.roles)) acc.roles = [];
  if (!acc.roles.includes(roleKey)) acc.roles.push(roleKey);
  acc.roleData = acc.roleData || {};
  acc.roleData[roleKey] = extraData || acc.roleData[roleKey] || {};
  saveAccount(acc);
  return true;
}

/* ── Creare cont de bază (apelat din performRegister) — fără rol obligatoriu ── */
function createBaseAccount(email, nume) {
  const acc = {
    account_id: 'acc_' + Date.now().toString(36),
    email: email || '',
    nume: nume || '',
    roles: [],       // gol intenționat — "doar cont", fără rol ales
    roleData: {},
    created_at: new Date().toISOString(),
  };
  saveAccount(acc);
  return acc;
}

/* ── UI: selector de rol — afișat din meniu, oricând, opțional ── */
function openRolePicker() {
  if (!isAccountCreated()) {
    if (typeof toggleAuthModal === 'function') { toggleAuthModal(); if (typeof switchAuthTab === 'function') switchAuthTab('register'); }
    return;
  }
  let modal = document.getElementById('role-picker-modal');
  if (!modal) { injectRolePickerModal(); modal = document.getElementById('role-picker-modal'); }
  renderRolePickerCards();
  modal.classList.remove('hidden');
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeRolePicker() {
  const modal = document.getElementById('role-picker-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.style.display = 'none';
  document.body.style.overflow = '';
}

function renderRolePickerCards() {
  const grid = document.getElementById('role-picker-grid');
  if (!grid) return;
  const acc = getAccount();
  const activeRoles = (acc && acc.roles) || [];
  grid.innerHTML = Object.keys(ROLE_META).map(function(key) {
    const r = ROLE_META[key];
    const active = activeRoles.includes(key);
    return '<div onclick="' + (active ? "window.location.href='" + r.dashLink + "'" : "selectRoleFromPicker('" + key + "')") + '" ' +
      'style="background:' + (active ? r.bg : '#F8FAFC') + ';border:1.5px solid ' + (active ? r.color : '#E2E8F0') + ';border-radius:14px;padding:16px;cursor:pointer;transition:all .15s;position:relative">' +
      (active ? '<span style="position:absolute;top:8px;right:8px;font-size:10px;background:' + r.color + ';color:#fff;padding:2px 8px;border-radius:99px;font-weight:700">ACTIV</span>' : '') +
      '<div style="font-size:28px;margin-bottom:8px">' + r.icon + '</div>' +
      '<div style="font-weight:700;font-size:13px;color:#1A2332">' + r.title + '</div>' +
      '<div style="font-size:11px;color:#5A6B7D;margin-top:4px">' + (active ? 'Mergi la dashboard →' : 'Adaugă acest rol →') + '</div>' +
      '</div>';
  }).join('');
}

function selectRoleFromPicker(roleKey) {
  const r = ROLE_META[roleKey];
  if (!r) return;
  // Rolurile de partener/investitor au flux de onboarding propriu (verificare, KYC etc.)
  // — trimitem utilizatorul către pagina de onboarding corectă, fără să activăm rolul direct.
  if (roleKey === 'client') {
    addRole('client', {});
    closeRolePicker();
    if (typeof showToastMsg === 'function') showToastMsg('✅ Rolul de Client a fost activat pe cont.');
    renderRolePickerCards();
  } else if (roleKey === 'investor') {
    window.location.href = 'mydarrin-investitori.html';
  } else {
    window.location.href = 'mydarrin-devino-partener.html?type=' + roleKey.replace('partner_', '');
  }
}

function injectRolePickerModal() {
  const html = '' +
'<div id="role-picker-modal" class="hidden" style="display:none;position:fixed;inset:0;z-index:9500;align-items:center;justify-content:center;padding:16px">' +
'  <div style="position:absolute;inset:0;background:rgba(0,0,0,.5);backdrop-filter:blur(2px)" onclick="closeRolePicker()"></div>' +
'  <div style="position:relative;background:#fff;border-radius:20px;max-width:560px;width:100%;max-height:85vh;overflow-y:auto;padding:28px">' +
'    <button onclick="closeRolePicker()" style="position:absolute;top:16px;right:16px;width:32px;height:32px;border-radius:9px;border:1px solid #E2E8F0;background:#fff;cursor:pointer;font-size:16px;color:#5A6B7D">×</button>' +
'    <h2 style="font-size:19px;font-weight:800;color:#1A2332;margin-bottom:6px;font-family:\'Syne\',sans-serif">Rolurile tale pe My Darrin</h2>' +
'    <p style="font-size:12.5px;color:#5A6B7D;margin-bottom:18px;line-height:1.6">Poți avea simultan mai multe roluri pe același cont — ex. client <strong>și</strong> furnizor de materiale <strong>și</strong> investitor. Alege ce vrei să activezi:</p>' +
'    <div id="role-picker-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:12px"></div>' +
'  </div>' +
'</div>';
  document.body.insertAdjacentHTML('beforeend', html);
}

/* ── Badge cu rolurile active, pentru afișare în header/sidebar ── */
function renderActiveRolesBadge(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const acc = getAccount();
  if (!acc || !acc.roles || acc.roles.length === 0) { el.innerHTML = ''; return; }
  el.innerHTML = acc.roles.map(function(key) {
    const r = ROLE_META[key];
    if (!r) return '';
    return '<span style="display:inline-flex;align-items:center;gap:3px;font-size:10px;font-weight:700;padding:3px 9px;border-radius:99px;background:' + r.bg + ';color:' + r.color + ';margin-right:4px">' + r.icon + ' ' + r.title + '</span>';
  }).join('');
}
