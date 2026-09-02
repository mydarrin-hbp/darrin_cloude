/* ════════════════════════════════════════════════════════════════
   MY DARRIN — mesaj partajat „zonă indisponibilă", localizat pe limba
   geo-detectată (1 septembrie 2026, extras din mydarrin-checkout.html
   pentru reutilizare pe mydarrin-produs.html și orice pagină viitoare
   care blochează accesul pe bază de țară — o singură sursă de adevăr
   pentru text, nu copii care pot diverge).

   Folosire: <script src="myd-unavail-msg.js"></script>, apoi
   window.MYD_UNAVAIL.apply(lang) populează elementele cu id-urile
   fixe unavail-title-pre / unavail-body-text / unavail-submit-btn
   (aceleași id-uri, indiferent de pagină).
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var MSGS = {
    ro: { pre: 'Nu suntem încă live în', body: 'Catalogul încă nu este disponibil. În curând Darrin va fi disponibil pentru tine.', btn: 'Anunță-mă la lansare' },
    en: { pre: "We're not live yet in", body: "The catalog isn't available yet. Darrin will be available for you soon.", btn: 'Notify me at launch' },
    de: { pre: 'Wir sind noch nicht live in', body: 'Der Katalog ist noch nicht verfügbar. Darrin wird bald für dich verfügbar sein.', btn: 'Bei Start benachrichtigen' },
    fr: { pre: 'Nous ne sommes pas encore actifs à', body: "Le catalogue n'est pas encore disponible. Darrin sera bientôt disponible pour vous.", btn: 'Prévenez-moi au lancement' },
    bg: { pre: 'Все още не сме активни в', body: 'Каталогът все още не е наличен. Скоро Darrin ще бъде наличен за теб.', btn: 'Уведомете ме при старта' },
    es: { pre: 'Todavía no estamos activos en', body: 'El catálogo aún no está disponible. Darrin estará disponible para ti muy pronto.', btn: 'Avísame en el lanzamiento' },
    el: { pre: 'Δεν είμαστε ακόμη διαθέσιμοι στην', body: 'Ο κατάλογος δεν είναι ακόμη διαθέσιμος. Σύντομα ο Darrin θα είναι διαθέσιμος για εσένα.', btn: 'Ειδοποίησέ με στην κυκλοφορία' },
    tr: { pre: 'Henüz şu bölgede aktif değiliz:', body: 'Katalog henüz kullanılamıyor. Darrin yakında senin için hazır olacak.', btn: 'Başlangıçta bana haber ver' },
    uk: { pre: 'Ми ще не працюємо у', body: 'Каталог ще недоступний. Незабаром Darrin буде доступний для тебе.', btn: 'Повідом мене про запуск' },
    fi: { pre: 'Emme ole vielä käytössä alueella', body: 'Luettelo ei ole vielä saatavilla. Darrin on pian saatavilla sinulle.', btn: 'Ilmoita minulle käynnistyksestä' },
    it: { pre: 'Non siamo ancora attivi in', body: 'Il catalogo non è ancora disponibile. Darrin sarà presto disponibile per te.', btn: 'Avvisami al lancio' },
  };

  function _t(id, val) {
    var el = document.getElementById(id);
    if (el && val !== undefined) el.textContent = val;
  }

  function apply(lang) {
    var m = MSGS[lang] || MSGS.en;
    _t('unavail-title-pre', m.pre);
    _t('unavail-body-text', m.body);
    _t('unavail-submit-btn', m.btn);
  }

  window.MYD_UNAVAIL = { MSGS: MSGS, apply: apply };
})();
