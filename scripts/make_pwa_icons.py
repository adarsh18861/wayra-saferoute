"""Render the WAYRA mark (same design as components/ui/Logo.tsx) to PWA PNG icons.

Usage: backend\.venv\Scripts\python.exe scripts/make_pwa_icons.py frontend/public
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def mark(size: int, maskable: bool) -> Image.Image:
    S = size * 4  # supersample
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    # diagonal gradient #7550b8 -> #2a1450
    grad = Image.new("RGB", (S, S))
    gp = grad.load()
    c1, c2 = (0x75, 0x50, 0xB8), (0x2A, 0x14, 0x50)
    for y in range(S):
        for x in range(0, S, 1):
            gp[x, y] = lerp(c1, c2, (x + y) / (2 * S))
    mask = Image.new("L", (S, S), 0)
    md = ImageDraw.Draw(mask)
    if maskable:
        md.rectangle([0, 0, S, S], fill=255)
    else:
        md.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 9 / 32), fill=255)
    img.paste(grad, (0, 0), mask)
    d = ImageDraw.Draw(img)
    # content scale: maskable icons keep the art inside the 80% safe zone
    k = (0.72 if maskable else 1.0) * S / 32
    off = (S - 32 * k) / 2

    def P(x, y):
        return (off + x * k, off + y * k)

    # path "M9.5 22.5 c0-6 4-6.5 6.5-6.5 s6.5-.5 6.5-6.5" approximated by two cubic beziers
    def cubic(p0, p1, p2, p3, n=600):
        pts = []
        for i in range(n + 1):
            t = i / n
            mt = 1 - t
            x = mt**3 * p0[0] + 3 * mt * mt * t * p1[0] + 3 * mt * t * t * p2[0] + t**3 * p3[0]
            y = mt**3 * p0[1] + 3 * mt * mt * t * p1[1] + 3 * mt * t * t * p2[1] + t**3 * p3[1]
            pts.append(P(x, y))
        return pts

    pts = cubic((9.5, 22.5), (9.5, 16.5), (13.5, 16), (16, 16)) + cubic((16, 16), (18.5, 16), (22.5, 15.5), (22.5, 9.5))[1:]
    w = int(3 * k)
    for x, y in pts:
        d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=(0x5E, 0xEA, 0xD4))
    r = 2.6 * k
    x, y = P(9.5, 22.5)
    d.ellipse([x - r, y - r, x + r, y + r], fill="white")
    x, y = P(22.5, 9.5)
    rr = r + 1.2 * k / 2
    d.ellipse([x - rr, y - rr, x + rr, y + rr], fill="white")
    d.ellipse([x - r + 0.6 * k, y - r + 0.6 * k, x + r - 0.6 * k, y + r - 0.6 * k], fill=(0x14, 0xB8, 0xA6))
    return img.resize((size, size), Image.LANCZOS)


mark(192, False).save(out / "pwa-192.png")
mark(512, False).save(out / "pwa-512.png")
mark(512, True).save(out / "pwa-maskable-512.png")
apple = Image.new("RGBA", (180, 180), (0x3B, 0x1F, 0x6B, 255))
apple.paste(mark(180, True), (0, 0))
apple.convert("RGB").save(out / "apple-touch-icon.png")
print("icons written to", out)
