#!/usr/bin/env python3
"""Generates the synthetic screenshots used by the tests.

Every fixture is drawn from scratch here: no real or private screenshots are
used anywhere in the test suite. Run from the project root:

    python3 scripts/make-fixtures.py

Outputs tests/fixtures/*.png|jpg and tests/fixtures/gray32.json (32x32
grayscale versions, used to unit-test the perceptual hash against the same
pixels the browser would produce).
"""
import io
import json
import os

from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(__file__), '..', 'tests', 'fixtures')
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
W, H = 390, 844


def font(size, bold=False):
    return ImageFont.truetype(BOLD if bold else FONT, size)


def status_bar(d, time='9:41', battery=0.8):
    d.text((24, 14), time, fill='#111', font=font(16, True))
    d.rounded_rectangle((330, 18, 360, 30), 3, outline='#111', width=2)
    d.rectangle((333, 21, 333 + int(24 * battery), 27), fill='#111')


def chat(time='9:41', battery=0.8):
    im = Image.new('RGB', (W, H), '#ece5dd')
    d = ImageDraw.Draw(im)
    d.rectangle((0, 0, W, 100), fill='#f7f7f7')
    status_bar(d, time, battery)
    d.text((70, 58), 'Arta', fill='#111', font=font(18, True))
    d.text((70, 80), 'online', fill='#666', font=font(12))
    d.ellipse((20, 54, 56, 90), fill='#25d366')
    msgs = [
        ('in', 'A e ke faturën e rrymës?'),
        ('out', 'Po, ta dërgoj tani'),
        ('in', 'Faleminderit shumë!'),
        ('out', 'S’ka problem 👍'.replace('👍', ':)')),
        ('in', 'Takimi nesër në ora 10'),
    ]
    y = 130
    for side, text in msgs:
        f = font(16)
        tw = d.textlength(text, font=f)
        if side == 'in':
            d.rounded_rectangle((16, y, 16 + tw + 28, y + 42), 12, fill='#ffffff')
            d.text((30, y + 11), text, fill='#111', font=f)
        else:
            d.rounded_rectangle((W - 16 - tw - 28, y, W - 16, y + 42), 12, fill='#dcf8c6')
            d.text((W - 16 - tw - 14, y + 11), text, fill='#111', font=f)
        y += 58
    d.rectangle((0, H - 70, W, H), fill='#f7f7f7')
    d.text((20, H - 50), 'WhatsApp — Shkruaj një mesazh', fill='#888', font=font(14))
    return im


def receipt():
    im = Image.new('RGB', (W, H), '#ffffff')
    d = ImageDraw.Draw(im)
    status_bar(d)
    d.text((30, 70), 'FATURË', fill='#111', font=font(30, True))
    d.text((30, 112), 'KEDS — Energjia elektrike', fill='#333', font=font(16))
    d.text((30, 136), 'Nr. i faturës: 2026-0418', fill='#555', font=font(14))
    rows = [('Konsumi', '31,20 €'), ('Taksa fikse', '4,10 €'), ('TVSH 8%', '6,80 €')]
    y = 200
    for a, b in rows:
        d.text((30, y), a, fill='#222', font=font(17))
        d.text((W - 30 - d.textlength(b, font=font(17)), y), b, fill='#222', font=font(17))
        y += 40
    d.line((30, y + 6, W - 30, y + 6), fill='#999', width=2)
    d.text((30, y + 20), 'Totali', fill='#111', font=font(22, True))
    d.text((W - 30 - d.textlength('42,10 €', font=font(22, True)), y + 20), '42,10 €', fill='#111', font=font(22, True))
    for i in range(10):
        d.rectangle((30 + i * 33, 560, 30 + i * 33 + (12 if i % 3 else 22), 640), fill='#111')
    return im


def notes():
    im = Image.new('RGB', (W, H), '#fffbea')
    d = ImageDraw.Draw(im)
    status_bar(d)
    d.text((24, 70), 'Ide për projektin', fill='#111', font=font(26, True))
    items = ['Logo e re', 'Takim me klientin', 'Faqja kryesore', 'Afati: e premte']
    y = 140
    for it in items:
        d.rounded_rectangle((24, y + 2, 44, y + 22), 5, outline='#c49a00', width=2)
        d.text((58, y), it, fill='#222', font=font(19))
        y += 46
    return im


def settings_screen():
    im = Image.new('RGB', (W, H), '#f2f2f7')
    d = ImageDraw.Draw(im)
    status_bar(d)
    d.text((20, 70), 'Settings', fill='#111', font=font(30, True))
    colors = ['#ff9500', '#007aff', '#34c759', '#ff3b30', '#5856d6', '#8e8e93']
    labels = ['Airplane Mode', 'Wi-Fi', 'Bluetooth', 'Notifications', 'Focus', 'General']
    y = 140
    for c, l in zip(colors, labels):
        d.rectangle((16, y, W - 16, y + 50), fill='#ffffff')
        d.rounded_rectangle((28, y + 11, 56, y + 39), 7, fill=c)
        d.text((70, y + 15), l, fill='#111', font=font(17))
        y += 51
    return im


def gray32(im):
    return list(im.convert('L').resize((32, 32), Image.BILINEAR).tobytes())


def main():
    os.makedirs(OUT, exist_ok=True)
    shots = {
        'chat.png': chat(),
        'receipt.png': receipt(),
        'notes.png': notes(),
        'settings.png': settings_screen(),
    }
    for name, im in shots.items():
        im.save(os.path.join(OUT, name), optimize=True)
    # A visually identical chat saved as JPEG (different bytes, same picture).
    shots['chat.png'].save(os.path.join(OUT, 'chat-copy.jpg'), quality=85)

    # Variants for the perceptual-hash unit test.
    buf = io.BytesIO()
    shots['chat.png'].save(buf, 'JPEG', quality=60)
    jpeg60 = Image.open(io.BytesIO(buf.getvalue()))
    resized = shots['chat.png'].resize((int(W * 0.7), int(H * 0.7)), Image.LANCZOS)
    other_status = chat(time='14:07', battery=0.35)
    gray = {
        'chat': gray32(shots['chat.png']),
        'chat_jpeg60': gray32(jpeg60),
        'chat_resized70': gray32(resized),
        'chat_status_changed': gray32(other_status),
        'receipt': gray32(shots['receipt.png']),
        'notes': gray32(shots['notes.png']),
        'settings': gray32(shots['settings.png']),
    }
    with open(os.path.join(OUT, 'gray32.json'), 'w') as f:
        json.dump(gray, f)
    print('fixtures written to', os.path.normpath(OUT))


if __name__ == '__main__':
    main()
