# Adaugă perechi RO → EN în secțiunea _texte (sau _modele) a unui dicționar i18n,
# păstrând formatul fișierului (indentare 1, CRLF / LF, fără linie goală la final).
# Unealtă locală (pasul 10b). Rulare: python scripts/adauga-traduceri.py <fisier> <_texte|_modele> <perechi.json>
import io, json, sys
def adauga(fisier, perechi, sectiune='_texte'):
    brut = io.open(fisier, encoding='utf-8', newline='').read()
    d = json.loads(brut)
    d.setdefault(sectiune, {})
    for ro, en in perechi.items():
        d[sectiune][ro] = en
    out = json.dumps(d, ensure_ascii=False, indent=1)
    if brut.endswith('\n'): out += '\n'
    if '\r\n' in brut: out = out.replace('\n', '\r\n')
    io.open(fisier, 'w', encoding='utf-8', newline='').write(out)
if __name__ == '__main__':
    adauga(sys.argv[1], json.load(io.open(sys.argv[3], encoding='utf-8')), sys.argv[2])
