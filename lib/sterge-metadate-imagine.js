// lib/sterge-metadate-imagine.js
// Pasul 12-D2 (18 nov. 2026): ștergerea metadatelor dintr-o imagine, pe server,
// fără dependențe. Funcție pură: primește un Buffer și întoarce un Buffer nou.
//   - JPEG: se scot segmentele APP1 (EXIF / XMP) și APP13 (IPTC / Photoshop);
//   - PNG: se scot blocurile eXIf, tEXt, iTXt, zTXt;
//   - WebP: se scot blocurile EXIF și „XMP ”, iar în VP8X se șterg indicatorii lor.
// Pixelii nu se ating. Pentru un fișier care nu are structura formatului
// declarat, funcția întoarce { ok: false } și serverul refuză fișierul.

const SEGMENTE_JPEG_SCOASE = new Set([0xe1, 0xed]); // APP1, APP13
const BLOCURI_PNG_SCOASE = new Set(['eXIf', 'tEXt', 'iTXt', 'zTXt']);
const BLOCURI_WEBP_SCOASE = new Set(['EXIF', 'XMP ']);
const SEMNATURA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function curataJpeg(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  const parti = [buf.subarray(0, 2)];
  let i = 2;
  let scoase = 0;
  while (i < buf.length) {
    if (buf[i] !== 0xff) return null;
    // Octeți de umplere (FF FF …) înaintea markerului.
    let j = i;
    while (j < buf.length && buf[j] === 0xff) j++;
    if (j >= buf.length) return null;
    const marker = buf[j];
    const inceput = j - 1;
    // Markere fără lungime: RSTn, TEM.
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      parti.push(buf.subarray(inceput, j + 1));
      i = j + 1;
      continue;
    }
    if (marker === 0xd9) { parti.push(buf.subarray(inceput, j + 1)); i = j + 1; break; } // EOI
    if (j + 2 >= buf.length) return null;
    const lungime = buf.readUInt16BE(j + 1);
    if (lungime < 2 || j + 1 + lungime > buf.length) return null;
    const sfarsit = j + 1 + lungime;
    if (marker === 0xda) {
      // SOS: de aici urmează datele imaginii, copiate neschimbate până la final.
      parti.push(buf.subarray(inceput));
      i = buf.length;
      break;
    }
    if (SEGMENTE_JPEG_SCOASE.has(marker)) scoase++;
    else parti.push(buf.subarray(inceput, sfarsit));
    i = sfarsit;
  }
  return { buffer: Buffer.concat(parti), scoase };
}

function curataPng(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SEMNATURA_PNG)) return null;
  const parti = [buf.subarray(0, 8)];
  let i = 8;
  let scoase = 0;
  let iend = false;
  while (i + 12 <= buf.length) {
    const lungime = buf.readUInt32BE(i);
    const tip = buf.toString('latin1', i + 4, i + 8);
    const sfarsit = i + 12 + lungime;
    if (sfarsit > buf.length) return null;
    if (BLOCURI_PNG_SCOASE.has(tip)) scoase++;
    else parti.push(buf.subarray(i, sfarsit));
    i = sfarsit;
    if (tip === 'IEND') { iend = true; break; }
  }
  if (!iend) return null;
  return { buffer: Buffer.concat(parti), scoase };
}

function curataWebp(buf) {
  if (buf.length < 12 || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP') return null;
  const parti = [];
  let i = 12;
  let scoase = 0;
  let vp8x = null;
  const capat = Math.min(buf.length, 8 + buf.readUInt32LE(4));
  while (i + 8 <= capat) {
    const tip = buf.toString('latin1', i, i + 4);
    const lungime = buf.readUInt32LE(i + 4);
    const sfarsit = i + 8 + lungime + (lungime % 2);
    if (i + 8 + lungime > capat) return null;
    if (BLOCURI_WEBP_SCOASE.has(tip)) scoase++;
    else {
      const bloc = Buffer.from(buf.subarray(i, Math.min(sfarsit, capat)));
      if (tip === 'VP8X') vp8x = bloc;
      parti.push(bloc);
    }
    i = sfarsit;
  }
  if (!parti.length) return null;
  // VP8X: bitul 3 = EXIF, bitul 2 = XMP.
  if (vp8x && vp8x.length > 8) vp8x[8] &= ~(0x08 | 0x04);
  const corp = Buffer.concat(parti);
  const antet = Buffer.alloc(12);
  antet.write('RIFF', 0, 'latin1');
  antet.writeUInt32LE(corp.length + 4, 4);
  antet.write('WEBP', 8, 'latin1');
  return { buffer: Buffer.concat([antet, corp]), scoase };
}

/**
 * @param {Buffer} buf conținutul imaginii
 * @param {string} mime image/jpeg | image/png | image/webp
 * @returns {{ ok: true, buffer: Buffer, scoase: number } | { ok: false }}
 */
function stergeMetadateImagine(buf, mime) {
  if (!Buffer.isBuffer(buf)) return { ok: false };
  let r = null;
  try {
    if (mime === 'image/jpeg') r = curataJpeg(buf);
    else if (mime === 'image/png') r = curataPng(buf);
    else if (mime === 'image/webp') r = curataWebp(buf);
  } catch (e) {
    r = null;
  }
  return r ? { ok: true, buffer: r.buffer, scoase: r.scoase } : { ok: false };
}

module.exports = { stergeMetadateImagine };
