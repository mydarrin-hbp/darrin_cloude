# My Darrin — Platformă hibrid clasic & AI
### Servicii integrate la cerere · Multi-țară · Multi-actor · ERP Marketplace

**Live:** https://darrin-cloude.vercel.app  
**GitHub:** https://github.com/mydarrin-hbp/darrin_cloude  
**Versiune:** v2026.06 · Build 18.06.2026  

---

## 🗂 Structura platformei (22 fișiere)

| Fișier | Rol | Dimensiune |
|--------|-----|-----------|
| `mydarrin-v3.html` | Homepage · Hero 3 CTA · Counter animation · Zone check | 141 KB |
| `mydarrin-catalog.html` | Catalog 26 servicii · Filtru urgent · goToService fix | 314 KB |
| `mydarrin-produs.html` | Pagina produs · Flux 6 pași · Safari iOS fix · Modal nivele | 210 KB |
| `mydarrin-checkout.html` | Checkout · Escrow · ETA meșter · Guest save · Edit adresă | 131 KB |
| `mydarrin-dashboard-client.html` | Dashboard client · Guest order tracking | 141 KB |
| `mydarrin-dashboard-partener.html` | Dashboard partener · 3 tipuri: Servicii/Curier/Asigurări | 131 KB |
| `mydarrin-dashboard-furnizor.html` | Dashboard furnizor · 2 tipuri: Materiale/Închirieri | 95 KB |
| `mydarrin-devino-partener.html` | Wizard 5 pași dinamic · 5 tipuri parteneri | 188 KB |
| `mydarrin-investitori.html` | Modul Fintech · KYC/MIFID · Motor evaluare live · Dashboard portofoliu | 133 KB |
| `mydarrin-marketplace.html` | Marketplace materiale & echipamente | 166 KB |
| `mydarrin-backoffice-serviciu.html` | Backoffice Admin | 151 KB |
| `mydarrin-superadmin.html` | Super Admin · RBAC global | 80 KB |
| `mydarrin-deviz-engine.html` | Motor deviz AI | 208 KB |
| `mydarrin-serviciu.html` | Pagina serviciu individual | 144 KB |
| `mydarrin-cum-functioneaza.html` | Flux operațional · 10 actori | 129 KB |
| `mydarrin-sync-architecture.html` | Arhitectură sync | 61 KB |
| `mydarrin-business-model.html` | Model business | 69 KB |
| `mydarrin-design-system.html` | Design system · Tailwind tokens | 79 KB |
| `mydarrin-app-mobile.html` | Landing app mobile | 71 KB |
| `index.html` | Redirect → v3 | 0 KB |
| `vercel.json` | Routing Vercel | 0 KB |
| `README.md` | Documentație | 2 KB |

---

## ⚡ Fix-uri majore în acest commit

### 🔴 Buguri critice rezolvate (B1–B5, BC1–BC7, FT1–FT7)

**Homepage & Navigare**
- `B1` — 6 linkuri navbar cu `href=URL"` (ghilimea lipsă deschidere) → ERR_FILE_NOT_FOUND fixat
- `B2` — Contoare hero blocate la `0` → `animateCounter()` cu IntersectionObserver
- `B3` — Banner „Zonă inactivă" apărea pentru București → `hideInactiveZoneBanner()` cu ACTIVE_ZONES
- `B4` — Guest checkout → dashboard cere login → `saveGuestOrder()` + Guest tracking banner
- `B5` — Safari iOS redirect eșuează din URL cu query string → `navTo()` cu base URL calculat

**Dashboard Partener — Curier & Asigurări**
- `BC1` — Filtru vehicul tehnic: sarcini >10kg/50L → EXCLUSIV Utilitară (`VEHICLE_RULES + canAcceptCursa`)
- `BC2` — Status ocupat în cursă: `CURIER_STARE.is_active_in_ride` + coadă FIFO
- `BC3` — Cross-reference daune: ID unic `CLAIM-YYYY-CMDxxxx-TIP` vizibil la ambii actori
- `BC4` — Sandbox API asigurări: `ASIG_API_CONFIG` + `toggleSandboxMode()` + widget în wizard
- `BC5` — Licență ARR obligatorie + Cazier obligatoriu în wizard curier
- `BC6` — CMR digital la pickup: `generareCMR()` + `confirmPickupCuCMR()` cu hash + eIDAS
- `BC7` — Nr. poliță ASF `RO-ASF-YYYY-xxxxx` + perioadă în factura asigurări

**Modul Investitori (nou)**
- `FT1` — KYC/AML/MIFID complet: upload CI + OCR, chestionar risc, checkbox PEP
- `FT2` — Motor evaluare dinamic: `calcEvaluare(GTV, ARR, Multiplicatori)` + sliders live
- `FT3` — Dashboard portofoliu post-subscriere: acțiuni, ROI, dividende
- `FT4` — Alocare acțiuni în Pasul 4: `calcAlocare()` + eIDAS Shareholders Agreement
- `FT5` — Contract eIDAS menționat explicit în wizard și dashboard
- `FT6` — Exit: Share Buyback (−10%) + Piață Secundară P2P
- `FT7` — Navbar Investitori → `mydarrin-investitori.html` (era `#`)

### 🟠 Îmbunătățiri operaționale
- `IO1` — Buton Pauză rapidă curier (15/30/45/60/90 min) în topbar
- `IO2` — GDPR notice la câmpul CNP în wizard onboarding
- `IO4` — Nr. contract parteneriat `MP-BCU-2026-xxx` în facturile generate

### 🟡 Funcționalități noi
- Hero homepage restructurat: 3 CTA (⚡ Urgentă / 📅 Programată / Devino Partener GRATUIT)
- Modul financiar complet: `FINANCIAL_STATE` per tip, `calcDatorie()`, `openInvoiceModal()` cu TVA
- Facturi fiscale: Nr. Comandă Darrin AI + Cantitate + U.M. + Preț/U.M. + TVA backoffice + Total cu TVA
- Darrin AI 3 trepte progresive: Bronz (gratuit) → Argint (50 Lei) → Aur (100 Lei)

---

## 🎨 Design Tokens

```
Primary:  #003366    Accent:  #FF8C00    AI Teal: #0E9E99
Surface:  #F0F4F8    Nav:     #16202E    Error:   #C0392B
Font:     'Syne' (headings) + 'Inter' (body)
```

---

## 💰 Formula Motor Deviz

```
COST_BAZA = max(COST_BRUT, VMC_tara)
PRET_FINAL = COST_BAZA × (1 + indirect 10% + marketing 3% + platform 3%)
           × mydarrin_pct (7–20%) × zone_coef × urgency_coef × (1 + TVA)

VMC: RO=100Lei · MD=400MDL · DE/FR=25EUR · BG=40BGN
```

---

## 📊 Formula Motor Evaluare Investitori

```
ARR        = GTV_lunar × comision_mediu × 12
eval_GTV   = GTV_anual × multiplicator_piata × 40%
eval_ARR   = ARR × multiplicator_SaaS × 60%
Evaluare   = (eval_GTV + eval_ARR) × factor_geo_scalare

Benchmarks: mult_piata=4.2× · mult_SaaS=8.5× · factor_geo=+0.3 per țară
```

---

## 🚀 Deploy

```bash
# Upload pe GitHub → Vercel redeploy automat în 30 secunde
git add .
git commit -m "feat: BC1-BC7 + FT1-FT7 + financial module v2026.06"
git push origin main
```

---

## 🏛 Entitate legală

**Home Best Pal SRL** · CUI RO45678901  
Antreprenor General · București · România  
© 2026 My Darrin · Toate drepturile rezervate
