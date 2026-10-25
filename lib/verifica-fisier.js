// lib/verifica-fisier.js
// Verificarea pe server a unui fișier încărcat direct din browser în Storage
// (pasul 11-S, 23 oct. 2026): fișierul nu trece prin funcțiile Vercel, deci
// serverul citește doar primii octeți (cerere cu Range, pe o adresă semnată
// de 60 s) și mărimea totală, apoi decide tipul după conținut, nu după
// extensie sau după ce declară browserul. Fără procesare video.

const OCTETI = 64;

// Tipul după primii octeți: 'image/jpeg' | 'image/png' | 'image/webp' |
// 'video/mp4' | 'video/quicktime' | 'video/webm' | null.
function detecteazaTip(b) {
  if (!b || b.length < 12) return null;
  const ascii = (de, la) => String.fromCharCode.apply(null, Array.from(b.slice(de, la)));
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
  if (b[0] === 0x89 && ascii(1, 4) === 'PNG' && b[4] === 0x0D && b[5] === 0x0A && b[6] === 0x1A && b[7] === 0x0A) return 'image/png';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3) return 'video/webm';
  if (ascii(4, 8) === 'ftyp') return ascii(8, 12) === 'qt  ' ? 'video/quicktime' : 'video/mp4';
  return null;
}

// MP4 și MOV au același container (ISO BMFF): se acceptă unul în locul celuilalt.
function tipPotrivit(declarat, detectat) {
  if (!declarat || !detectat) return false;
  if (declarat === detectat) return true;
  const bmff = ['video/mp4', 'video/quicktime'];
  return bmff.includes(declarat) && bmff.includes(detectat);
}

async function citestePrimii(raspuns) {
  if (raspuns.body && typeof raspuns.body.getReader === 'function') {
    const cititor = raspuns.body.getReader();
    const bucati = [];
    let n = 0;
    while (n < OCTETI) {
      const { done, value } = await cititor.read();
      if (done) break;
      bucati.push(value);
      n += value.length;
    }
    try { await cititor.cancel(); } catch (e) { /* deja închis */ }
    const tot = new Uint8Array(n);
    let p = 0;
    bucati.forEach((x) => { tot.set(x, p); p += x.length; });
    return tot.slice(0, OCTETI);
  }
  return new Uint8Array(await raspuns.arrayBuffer()).slice(0, OCTETI);
}

// { exista, tip, marime } — tipul după conținut și mărimea totală (Content-Range / Content-Length).
async function inspecteaza(supabaseAdmin, bucket, cale) {
  const { data, error } = await supabaseAdmin.storage.from(bucket).createSignedUrl(cale, 60);
  if (error || !data || !data.signedUrl) return { exista: false };
  const r = await fetch(data.signedUrl, { headers: { Range: 'bytes=0-' + (OCTETI - 1) } });
  if (!r.ok) return { exista: false };
  let marime = null;
  const cr = r.headers.get('content-range');
  const m = cr && /\/(\d+)\s*$/.exec(cr);
  if (m) marime = Number(m[1]);
  else if (r.status === 200 && r.headers.get('content-length')) marime = Number(r.headers.get('content-length'));
  const octeti = await citestePrimii(r);
  return { exista: true, tip: detecteazaTip(octeti), marime };
}

module.exports = { detecteazaTip, tipPotrivit, inspecteaza, OCTETI };
