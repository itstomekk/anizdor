"""Draws the family board and an ancestor fan as a vector PDF (no watermark) from tools/export_layout.mjs output.
Usage: uv run --with reportlab python tools/make_pdf.py layout.json out.pdf [title]
Page 1: whole-family board, descendant trees packed into bands. Page 2: ancestor fan of the focus person.
"""
import json, math, sys
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

src, out = sys.argv[1], sys.argv[2]
title = sys.argv[3] if len(sys.argv) > 3 else 'Tablica rodziny'
D = json.load(open(src, encoding='utf-8'))
pdfmetrics.registerFont(TTFont('A', 'C:/Windows/Fonts/arial.ttf'))
pdfmetrics.registerFont(TTFont('AB', 'C:/Windows/Fonts/arialbd.ttf'))

BW, BH, GX, GY = 74, 46, 8, 34          # box, gaps
BAND_W = 3300                            # max width of a band (pt)
FILL = {'M': (0.87, 0.92, 0.99), 'F': (0.99, 0.89, 0.93), '': (0.93, 0.93, 0.93), 'U': (0.93, 0.93, 0.93)}
EDGE = {'M': (0.44, 0.58, 0.84), 'F': (0.83, 0.48, 0.60), '': (0.6, 0.6, 0.6), 'U': (0.6, 0.6, 0.6)}


def fit(c, text, font, size, width):
    while size > 4.2 and pdfmetrics.stringWidth(text, font, size) > width:
        size -= 0.3
    if pdfmetrics.stringWidth(text, font, size) > width:
        while text and pdfmetrics.stringWidth(text + '…', font, size) > width:
            text = text[:-1]
        text += '…'
    return text, size


# ---- split nodes into trees
nodes, links = D['nodes'], D['links']
trees, cur = [], []
for i, n in enumerate(nodes):  # layout is post-order: a tree ends with its root (gen 0)
    cur.append(i)
    if n['gen'] == 0:
        trees.append(cur); cur = []
assert not cur
assert len(trees) == D['trees'], (len(trees), D['trees'])
for t in trees:
    rows = [nodes[i]['row'] for i in t]
    t.sort(key=lambda i: i)
# width of each tree in columns = distinct rows span
tinfo = []
for t in trees:
    r = [nodes[i]['row'] for i in t]
    tinfo.append({'idx': t, 'r0': min(r), 'r1': max(r), 'w': (max(r) - min(r) + 1) * (BW + GX), 'g': max(nodes[i]['gen'] for i in t)})
# pack greedily, widest first, into bands
bands = []
for t in sorted(tinfo, key=lambda x: -x['w']):
    for b in bands:
        if b['w'] + t['w'] + 30 <= BAND_W:
            b['trees'].append(t); b['w'] += t['w'] + 30; break
    else:
        bands.append({'trees': [t], 'w': t['w'], 'h': 0})
for b in bands:
    b['trees'].sort(key=lambda t: t['r0'])
    b['h'] = (max(t['g'] for t in b['trees']) + 1) * (BH + GY) - GY
W = max(b['w'] for b in bands) + 80
HEAD = 90
H = HEAD + sum(b['h'] + 50 for b in bands) + 70
# fan page
FAN_R = 780
FW, FH = 1900, 1900

c = canvas.Canvas(out, pagesize=(W, H))
c.setTitle(title); c.setAuthor('Rodzina'); c.setSubject('Tablica rodziny, narysowana od zera z pliku GEDCOM')

# ---- page 1 header
c.setFillColorRGB(0.1, 0.15, 0.2); c.setFont('AB', 30); c.drawString(40, H - 52, title)
c.setFont('A', 13); c.setFillColorRGB(0.35, 0.4, 0.47)
drawn = len(nodes)
c.drawString(40, H - 74, f"{D['total']} osób w pliku, {drawn} narysowanych jako własne ramki, pozostałe widoczne jako partnerzy (∞) przy ramkach. Gałęzi: {D['trees']}. Niebieski = mężczyzna, różowy = kobieta.")

y_top = H - HEAD
pos = {}
for b in bands:
    x = 40
    for t in b['trees']:
        for i in t['idx']:
            n = nodes[i]
            pos[i] = (x + (n['row'] - t['r0']) * (BW + GX), y_top - n['gen'] * (BH + GY) - BH)
        x += t['w'] + 30
    y_top -= b['h'] + 50

# links first (under boxes)
c.setStrokeColorRGB(0.55, 0.6, 0.67); c.setLineWidth(0.9)
for a, bb in links:
    ax, ay = pos[a]; bx, by = pos[bb]
    x1, y1, x2, y2 = ax + BW / 2, ay, bx + BW / 2, by + BH
    my = (y1 + y2) / 2
    p = c.beginPath(); p.moveTo(x1, y1); p.lineTo(x1, my); p.lineTo(x2, my); p.lineTo(x2, y2); c.drawPath(p, stroke=1, fill=0)

for i, n in enumerate(nodes):
    x, y = pos[i]
    sx = n['sex'] if n['sex'] in FILL else ''
    c.setFillColorRGB(*FILL[sx]); c.setStrokeColorRGB(*EDGE[sx]); c.setLineWidth(0.8)
    c.roundRect(x, y, BW, BH, 4, stroke=1, fill=1)
    c.setFillColorRGB(0.07, 0.07, 0.1)
    g, fs = fit(c, n['given'] or '(bez imienia)', 'AB', 8.2, BW - 6); c.setFont('AB', fs); c.drawString(x + 3, y + BH - 10, g)
    s, fs = fit(c, n['surname'], 'AB', 8.2, BW - 6); c.setFont('AB', fs); c.drawString(x + 3, y + BH - 19.5, s)
    c.setFont('A', 7.2); c.setFillColorRGB(0.28, 0.3, 0.35); c.drawString(x + 3, y + BH - 29, n['years'] or '')
    if n['spouses']:
        t, fs = fit(c, '∞ ' + ', '.join(n['spouses']), 'A', 6.6, BW - 6); c.setFillColorRGB(0.48, 0.29, 0.39); c.setFont('A', fs); c.drawString(x + 3, y + 4.5, t)

c.setFont('A', 10); c.setFillColorRGB(0.5, 0.55, 0.6)
c.drawString(40, 28, 'Narysowane z pliku GEDCOM. Dokument zawiera dane osób żyjących, nie publikuj go.')
c.showPage()

# ---- page 2: ancestor fan
c.setPageSize((FW, FH))
cx, cy = FW / 2, FH / 2 - 30
fan = D['fan']; depth = fan['depth']
ring, centre, shrink = 132, 104, 0.94


def radii(g):
    if g == 0: return 0, centre
    r = centre
    for k in range(1, g): r += ring * shrink ** (k - 1)
    return r, r + ring * shrink ** (g - 1)


def hsl(h, s, l):
    import colorsys
    r, g, b = colorsys.hls_to_rgb(h / 360, l, s); return r, g, b


GEN = [215, 200, 170, 140, 95, 55, 35, 15]
c.setFillColorRGB(0.1, 0.15, 0.2); c.setFont('AB', 34); c.drawString(50, FH - 66, 'Wachlarz przodków: ' + (D['focus']['given'] + ' ' + D['focus']['surname']).strip())
c.setFont('A', 14); c.setFillColorRGB(0.35, 0.4, 0.47)
c.drawString(50, FH - 92, f"{depth} pokoleń, {fan['known'] - 1} znanych przodków ({fan['distinct'] - 1} różnych osób). Przerywany obrys = brak rodzica w danych; pomarańczowy = ten sam przodek występuje wielokrotnie.")


def sector(r0, r1, a0, a1, fill, stroke, dash=None, lw=1.2, width_stroke=None):
    # angles clockwise from the top; reportlab path with arcs approximated by polylines
    steps = max(4, int((a1 - a0) * (r1 + 1) / 6))
    p = c.beginPath()
    pts = [(cx + r1 * math.sin(a0 + (a1 - a0) * k / steps), cy + r1 * math.cos(a0 + (a1 - a0) * k / steps)) for k in range(steps + 1)]
    if r0 <= 0:
        p.moveTo(cx, cy)
        for x, y in pts: p.lineTo(x, y)
    else:
        p.moveTo(*pts[0])
        for x, y in pts[1:]: p.lineTo(x, y)
        for k in range(steps, -1, -1):
            a = a0 + (a1 - a0) * k / steps; p.lineTo(cx + r0 * math.sin(a), cy + r0 * math.cos(a))
    p.close()
    if dash: c.setDash(*dash)
    if fill: c.setFillColorRGB(*fill)
    c.setStrokeColorRGB(*stroke); c.setLineWidth(lw)
    c.drawPath(p, stroke=1, fill=1 if fill else 0)
    c.setDash()


for cell in fan['cells']:
    r0, r1 = radii(cell['gen']); a0, a1 = cell['a0'], cell['a1']
    if cell['empty']:
        sector(r0, r1, a0, a1, None, (0.55, 0.6, 0.67), dash=(4, 5), lw=1.5); continue
    if cell['loop']:
        sector(r0, r1, a0, a1, None, (0.75, 0.22, 0.17), dash=(2, 3), lw=1.4); continue
    g = cell['gen']
    fill = (0.55, 0.7, 0.9) if g == 0 else hsl(GEN[(g - 1) % len(GEN)], 0.55, 0.84)
    sector(r0, r1, a0, a1, fill, (1, 1, 1) if not cell['repeat'] else (0.88, 0.54, 0), dash=None if not cell['repeat'] else (6, 3), lw=1.6 if not cell['repeat'] else 2.6)
    p = cell['p']
    if not p: continue
    am = (a0 + a1) / 2; rm = (r0 + r1) / 2; arc = (a1 - a0) * rm; thick = r1 - r0
    x, y = cx + rm * math.sin(am), cy + rm * math.cos(am)
    c.setFillColorRGB(0.07, 0.07, 0.1)
    if g == 0:
        c.setFont('AB', 13); c.drawCentredString(x, y + 2, p['given'][:14]); c.drawCentredString(x, y - 13, p['surname'][:14]); continue
    if g <= 2 and arc > 60:
        c.setFont('AB', 10.5); c.drawCentredString(x, y + 6, p['given'][:16]); c.drawCentredString(x, y - 6, p['surname'][:16]); c.setFont('A', 9); c.drawCentredString(x, y - 18, p['years'])
        continue
    if arc < 9: continue
    deg = math.degrees(am)
    # text runs along the radius; keep it upright
    rot = 90 - deg if math.sin(am) >= 0 else 270 - deg
    fs = max(7, min(13, arc - 3))
    name = ' '.join(t for t in (p['given'], p['surname']) if t) or '(bez nazwy)'
    t, fs2 = fit(c, name, 'A', fs, thick - 8)
    c.saveState(); c.translate(x, y); c.rotate(rot); c.setFont('A', fs2); c.drawCentredString(0, -fs2 * 0.33, t); c.restoreState()

c.setFont('A', 11); c.setFillColorRGB(0.5, 0.55, 0.6)
c.drawString(50, 30, 'Narysowane z pliku GEDCOM. Dokument zawiera dane osób żyjących, nie publikuj go.')
c.showPage(); c.save()
print('written', out, 'page1', round(W), 'x', round(H), 'bands', len(bands), 'trees', len(trees))
