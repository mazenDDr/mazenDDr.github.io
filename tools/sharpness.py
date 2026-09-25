"""Compare detail between Cycles renders and web screenshots of the same view.

  python web/tools/sharpness.py REF.png WEB.png [...pairs]

Reports, per image: mean gradient magnitude and variance of the Laplacian (higher =
more fine detail) on grayscale, plus the web/ref ratio. Both images are compared at
the same size.
"""
import sys
import numpy as np
from PIL import Image


def detail(path, size=None):
    im = Image.open(path).convert('L')
    if size:
        im = im.resize(size, Image.LANCZOS)
    a = np.asarray(im, np.float32) / 255
    gx, gy = np.diff(a, axis=1)[:-1], np.diff(a, axis=0)[:, :-1]
    lap = a[1:-1, 1:-1] * 4 - a[:-2, 1:-1] - a[2:, 1:-1] - a[1:-1, :-2] - a[1:-1, 2:]
    return float(np.hypot(gx, gy).mean()), float(lap.var()), im.size


args = sys.argv[1:]
print(f'{"view":<28}{"grad ref":>10}{"grad web":>10}{"ratio":>7}{"lapvar ref":>12}{"lapvar web":>12}{"ratio":>7}')
for ref, web in zip(args[::2], args[1::2]):
    g1, l1, size = detail(ref)
    g2, l2, _ = detail(web, size)
    name = web.rsplit('/', 1)[-1]
    print(f'{name:<28}{g1:>10.4f}{g2:>10.4f}{g2 / g1:>7.2f}{l1 * 1e4:>12.2f}{l2 * 1e4:>12.2f}{l2 / l1:>7.2f}')
