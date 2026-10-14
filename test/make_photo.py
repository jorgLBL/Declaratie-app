# Makes a "phone photo" of a thermal receipt: skewed, on a table, uneven light, noise and slight blur.
import sys, random
from PIL import Image, ImageDraw, ImageFont, ImageFilter
random.seed(4)
lines = sys.argv[2].split('|')
W, H = 520, 80 + 44 * len(lines)
r = Image.new('L', (W, H), 246); d = ImageDraw.Draw(r)
f = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf', 25)
for i, l in enumerate(lines):
    d.text((36, 40 + 44 * i), l, fill=random.randint(25, 70), font=f)
r = r.filter(ImageFilter.GaussianBlur(0.8))
bg = Image.new('RGB', (900, H + 300), (120, 98, 76))
rc = Image.merge('RGB', (r, r, r.point(lambda v: max(0, v - 8))))
rc = rc.rotate(-4, expand=True, fillcolor=(120, 98, 76), resample=Image.BICUBIC)
bg.paste(rc, (180, 140))
# uneven light + noise
shade = Image.linear_gradient('L').resize(bg.size).point(lambda v: 150 + v // 3)
bg = Image.composite(bg, Image.new('RGB', bg.size, (40, 40, 40)), shade)
px = bg.load()
for _ in range(60000):
    x, y = random.randrange(bg.width), random.randrange(bg.height); v = random.randint(-25, 25)
    p = px[x, y]; px[x, y] = tuple(max(0, min(255, c + v)) for c in p)
bg = bg.filter(ImageFilter.GaussianBlur(0.6))
bg.save(sys.argv[1], quality=82)
