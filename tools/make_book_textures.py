"""Cover and spine textures for Mazen's books, from the downloaded covers.

Covers come from Open Library and Google Books (design/assets/books/*-ol.jpg,
*-g.jpg). Spines are drawn here in each publisher's style: O'Reilly white with the
red O'REILLY mark, Springer and Wiley in the cover's own colour. Writes
design/assets/books/tex/<id>_cover.jpg, <id>_spine.png and books.json (real sizes,
cm) for books.py to build and shelve them.

  /tmp/t16-pw-venv/bin/python web/tools/make_book_textures.py
"""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageStat

DIR = Path(__file__).resolve().parents[2] / 'design/assets/books'
OUT = DIR / 'tex'
OUT.mkdir(exist_ok=True)
FONT = '/System/Library/Fonts/Helvetica.ttc'

# id, title on the spine, author on the spine, publisher, width x height (cm), pages
BOOKS = [
    ('hands-on-ml', 'Hands-On Machine Learning with Scikit-Learn, Keras & TensorFlow', 'Géron', "O'Reilly", 17.8, 23.3, 850),
    ('ai-engineering', 'AI Engineering', 'Huyen', "O'Reilly", 17.8, 23.3, 532),
    ('hands-on-llms', 'Hands-On Large Language Models', 'Alammar & Grootendorst', "O'Reilly", 17.8, 23.3, 428),
    ('practical-nlp', 'Practical Natural Language Processing', 'Vajjala, Majumder, Gupta & Surana', "O'Reilly", 17.8, 23.3, 454),
    ('practical-mlops', 'Practical MLOps', 'Gift & Deza', "O'Reilly", 17.8, 23.3, 461),
    ('llmops', 'LLMOps', 'Aryan', "O'Reilly", 17.8, 23.3, 300),
    ('ddia2', 'Designing Data-Intensive Applications', 'Kleppmann & Riccomini', "O'Reilly", 17.8, 23.3, 650),
    ('database-internals', 'Database Internals', 'Petrov', "O'Reilly", 17.8, 23.3, 373),
    ('storytelling-with-data', 'storytelling with data', 'knaflic', 'Wiley', 18.8, 23.4, 288),
    ('esl', 'The Elements of Statistical Learning', 'Hastie · Tibshirani · Friedman', 'Springer', 15.5, 23.5, 745),
    ('cv-szeliski', 'Computer Vision: Algorithms and Applications', 'Szeliski', 'Springer', 17.8, 25.4, 925),
]
PX = 44                       # texels per cm on the spine


def best_cover(i):
    for f in (DIR / f'{i}-g.jpg', DIR / f'{i}-ol.jpg'):
        try:
            im = Image.open(f).convert('RGB')
        except Exception:
            continue
        # Google's "image not available" placeholder is a flat grey page
        if im.size[0] > 200 and ImageStat.Stat(im.convert('L')).stddev[0] > 12:
            return im
    raise SystemExit(f'no usable cover for {i}')


def fit(draw, text, box_w, box_h, start):
    size = start
    while size > 10:
        f = ImageFont.truetype(FONT, size)
        l, t, r, b = draw.textbbox((0, 0), text, font=f)
        if r - l <= box_w and b - t <= box_h:
            return f
        size -= 2
    return ImageFont.truetype(FONT, 10)


meta = []
for i, title, author, pub, w, h, pages in BOOKS:
    cover = best_cover(i)
    cover = cover.resize((1024, round(1024 * cover.size[1] / cover.size[0])), Image.LANCZOS)
    cover.save(OUT / f'{i}_cover.jpg', quality=92)
    thick = round(0.12 + pages * 0.0052, 2)      # ~0.052 mm per page plus the boards
    sw, sh = max(40, round(thick * PX)), round(h * PX)
    # Spine colour: O'Reilly and Wiley are white; Springer uses the cover's colour.
    if pub == 'Springer':
        # the cover's own colour: the median of its most saturated pixels
        hsv = cover.convert('HSV')
        px = [rgb for rgb, (hh, ss, vv) in zip(cover.getdata(), hsv.getdata()) if ss > 120 and vv > 80]
        px.sort(key=sum)
        bg = px[len(px) // 2] if px else (200, 160, 40)
        ink = (255, 255, 255) if sum(bg) < 420 else (20, 20, 20)
    else:
        bg, ink = (246, 244, 239), (25, 25, 25)
    # Draw the spine lying on its side: x runs from the top of the book to the bottom.
    # Zones: title 4-58%, author 61-79%, publisher 82-96%.
    spine = Image.new('RGB', (sh, sw), bg)
    d = ImageDraw.Draw(spine)
    brand = {"O'Reilly": "O'REILLY", 'Springer': 'Springer', 'Wiley': 'WILEY'}[pub]
    zones = ((title, 0.04, 0.58, 0.62, 64, ink), (author, 0.61, 0.79, 0.42, 34, ink),
             (brand, 0.82, 0.96, 0.5, 40, (213, 31, 38) if pub == "O'Reilly" else ink))
    for text, x0, x1, hfrac, start, col in zones:
        f = fit(d, text, sh * (x1 - x0), sw * hfrac, start)
        d.text((sh * x0, sw / 2), text, font=f, fill=col, anchor='lm')
    if pub == "O'Reilly":                        # the colour band at the top of O'Reilly spines
        accent = tuple(int(v) for v in ImageStat.Stat(cover.crop((0, cover.size[1] // 3, cover.size[0], cover.size[1] * 2 // 3))).median)
        d.rectangle((0, 0, sh * 0.025, sw), fill=accent)
    spine = spine.rotate(-90, expand=True)       # top of the book at the top of the image
    spine.save(OUT / f'{i}_spine.png')
    meta.append({'id': i, 'title': title, 'publisher': pub, 'w_cm': w, 'h_cm': h, 'thick_cm': thick})
    print(i, 'cover', cover.size, 'spine', spine.size, f'{thick} cm')
(OUT / 'books.json').write_text(json.dumps(meta, indent=1))
