// lib/destinatie-rol.js
// Harta unică rol → dashboard (pasul 10b, 16 oct. 2026), pentru server
// (api/public/destinatie-post-login.js, api/cont/profil.js) și browser
// (ui-comun.js). Copia din ui-comun.js se generează din acest fișier:
//   node scripts/genereaza-destinatie-rol.js
// iar scripts/test-destinatie-rol.js verifică faptul că sunt identice.
//
// Reguli pentru destinația după login (alegeDestinatie):
//   superadmin                         → /mydarrin-superadmin
//   admin cu drept de catalog          → /mydarrin-admin-catalog
//   un singur rol cu dashboard         → dashboard-ul lui
//   mai multe roluri cu dashboard      → alegerea rolului (PAGINA_ALEGERE)
//   admin fără drept de catalog și fără alt rol → /mydarrin-superadmin (ca înainte)
//   niciun rol                         → null (serverul răspunde 403)
// „client” e rolul pus implicit la orice înregistrare: lângă un rol de
// partener sau de investitor nu mai contează ca rol separat (partenerul
// ajunge direct în dashboard-ul lui; clientul rămâne în „Rolurile mele”).
//
// Doar pentru afișare și navigare. Accesul real îl decide serverul, din
// profiles.roles (lib/auth-middleware.js).

// <destinatie-rol:inceput>
(function (radacina, fabrica) {
  var api = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else radacina.MYD_DESTINATIE_ROL = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Ordinea contează: e ordinea din „Rolurile mele” și din alegerea rolului.
  // tip = parametrul ?type= al dashboard-ului; formular = ?type= din „Devino partener”.
  var ROLURI = [
    { rol: 'client', titlu: 'Client', insigna: 'Client', pagina: '/mydarrin-dashboard-client.html', culoare: '#003366', fundal: 'linear-gradient(135deg,#EBF4FB,#DDE6F5)' },
    { rol: 'partener_servicii', titlu: 'Furnizor de Servicii', insigna: 'Partener servicii', pagina: '/mydarrin-dashboard-partener.html', tip: 'servicii', formular: 'servicii', culoare: '#FF8C00', fundal: 'linear-gradient(135deg,#FFF0D6,#FDE8C4)' },
    { rol: 'partener_materiale', titlu: 'Furnizor de Materiale', insigna: 'Furnizor de materiale', pagina: '/mydarrin-dashboard-furnizor.html', tip: 'materiale', formular: 'materiale', culoare: '#003366', fundal: 'linear-gradient(135deg,#EBF4FB,#DDE6F5)' },
    { rol: 'partener_inchirieri', titlu: 'Furnizor de Închirieri', insigna: 'Furnizor de închirieri', pagina: '/mydarrin-dashboard-furnizor.html', tip: 'inchirieri', formular: 'inchirieri', culoare: '#0E9E99', fundal: 'linear-gradient(135deg,#E0F5F4,#C5EEEC)' },
    { rol: 'partener_curier', titlu: 'Curier de Cartier', insigna: 'Curier', pagina: '/mydarrin-dashboard-partener.html', tip: 'curier', formular: 'curier', culoare: '#7C3AED', fundal: 'linear-gradient(135deg,#F3EEFF,#E9D8FD)' },
    { rol: 'partener_asigurari', titlu: 'Furnizor de Asigurări', insigna: 'Asigurător', pagina: '/mydarrin-dashboard-partener.html', tip: 'asigurari', formular: 'asigurator', culoare: '#1A7A3A', fundal: 'linear-gradient(135deg,#D4EDDA,#B8DFC5)' },
    { rol: 'investor', titlu: 'Investitor', insigna: 'Investitor', pagina: '/mydarrin-investitori.html', culoare: '#CC7000', fundal: 'linear-gradient(135deg,#FFF3E0,#FFE0B2)' },
  ];
  var PAGINA_SUPERADMIN = '/mydarrin-superadmin';
  var PAGINA_ADMIN_CATALOG = '/mydarrin-admin-catalog';
  var PAGINA_ALEGERE = '/?alege_rol=1';

  function definitie(rol) {
    for (var i = 0; i < ROLURI.length; i++) if (ROLURI[i].rol === rol) return ROLURI[i];
    return null;
  }

  function dashboardPentruRol(rol) {
    var d = definitie(rol);
    if (!d) return null;
    return d.tip ? d.pagina + '?type=' + d.tip : d.pagina;
  }

  // Rolul căruia îi aparține o pagină de dashboard (pagina + ?type=).
  // mydarrin-dashboard-partener.html fără type → orice rol de partener de acolo.
  function roluriPentruPagina(cale, type) {
    var p = '/' + String(cale || '').replace(/^\//, '').replace(/\.html$/, '') + '.html';
    var lista = [];
    for (var i = 0; i < ROLURI.length; i++) {
      var r = ROLURI[i];
      if (r.pagina !== p) continue;
      if (type && r.tip && r.tip !== type) continue;
      lista.push(r.rol);
    }
    return lista;
  }

  // Rolurile care duc într-un dashboard, în ordinea din ROLURI; „client” nu
  // contează lângă alt rol cu dashboard.
  function roluriCuDashboard(roles) {
    var lista = Array.isArray(roles) ? roles : [];
    var cu = ROLURI.filter(function (r) { return lista.indexOf(r.rol) !== -1; }).map(function (r) { return r.rol; });
    return cu.length > 1 ? cu.filter(function (r) { return r !== 'client'; }) : cu;
  }

  // { tip, destinatie, rol?, roluri? } sau null (niciun rol).
  function alegeDestinatie(roles, optiuni) {
    var lista = Array.isArray(roles) ? roles : [];
    var opt = optiuni || {};
    if (lista.indexOf('superadmin') !== -1) return { tip: 'superadmin', destinatie: PAGINA_SUPERADMIN };
    var admin = lista.indexOf('admin') !== -1;
    if (admin && opt.adminCatalog) return { tip: 'admin_catalog', destinatie: PAGINA_ADMIN_CATALOG };
    var cu = roluriCuDashboard(lista);
    if (cu.length === 1) return { tip: 'rol', rol: cu[0], destinatie: dashboardPentruRol(cu[0]) };
    if (cu.length > 1) return { tip: 'alegere', destinatie: PAGINA_ALEGERE, roluri: cu };
    if (admin) return { tip: 'admin', destinatie: PAGINA_SUPERADMIN };
    return null;
  }

  return {
    ROLURI: ROLURI,
    PAGINA_SUPERADMIN: PAGINA_SUPERADMIN,
    PAGINA_ADMIN_CATALOG: PAGINA_ADMIN_CATALOG,
    PAGINA_ALEGERE: PAGINA_ALEGERE,
    definitie: definitie,
    dashboardPentruRol: dashboardPentruRol,
    roluriPentruPagina: roluriPentruPagina,
    roluriCuDashboard: roluriCuDashboard,
    alegeDestinatie: alegeDestinatie,
  };
});
// <destinatie-rol:sfarsit>
