#!/usr/bin/env python3
"""
Los sprites de Tex para Administración, a partir de su identidad visual (textOS/public/mascot).

El arte original es pixel art reescalado a 600-900 px (3,5 MB). Acá se recupera la grilla real, para
que Tex pese unos KB y se vea nítido a cualquier escala entera con `image-rendering: pixelated`, y
se le borra la cara: la dibuja `components/administracion/tex/tex-face.tsx`, así puede hablar,
parpadear y mirar hacia lo que señala.

Uso: python3 scripts/tex-sprites.py /ruta/a/textOS/public/mascot public/tex
"""
import sys
from pathlib import Path

from PIL import Image

SRC = Path(sys.argv[1])
OUT = Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)

CREAM = (255, 253, 245, 255)
# Lado del pixel del dibujo en cada imagen original.
BLOCKS = {
    'tex.png': 10.6,
    'tex-support.png': 13.4,
    'tex-analytics.png': 13.4,
    'tex-goals.png': 12.6,
    'tex-talk-1.png': 20.8,
}


def to_grid(name: str) -> Image.Image:
    img = Image.open(SRC / name).convert('RGBA')
    block = BLOCKS[name]
    w, h = round(img.width / block), round(img.height / block)
    small = img.convert('RGBa').resize((w, h), Image.BOX).convert('RGBA')
    r, g, b, a = small.split()
    return Image.merge('RGBA', (r, g, b, a.point(lambda v: 255 if v >= 110 else 0)))


def trim(img: Image.Image, margin: int = 0) -> tuple[Image.Image, tuple[int, int]]:
    box = img.getchannel('A').getbbox()
    x0, y0 = max(box[0] - margin, 0), max(box[1] - margin, 0)
    return img.crop((x0, y0, min(box[2] + margin, img.width), min(box[3] + margin, img.height))), (x0, y0)


def is_cream(px) -> bool:
    return px[3] > 128 and px[0] > 225 and px[1] > 225 and px[2] > 205


def blank_face(img: Image.Image, rows: range, x_min: int, x_max: int, solid_from=None) -> None:
    """Pinta de crema la cara, fila por fila, entre su primer y su último pixel crema.

    `solid_from`: desde qué columna es cara aunque no sea crema (el rubor pegado al borde).
    """
    for y in rows:
        xs = [x for x in range(x_min, x_max + 1) if is_cream(img.getpixel((x, y)))]
        if not xs:
            continue
        start = min(xs) if solid_from is None else min(min(xs), solid_from)
        for x in range(start, max(xs) + 1):
            img.putpixel((x, y), CREAM)


def save(img: Image.Image, name: str) -> None:
    img.quantize(colors=48, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).save(
        OUT / f'{name}.png', optimize=True,
    )


def crop(img: Image.Image, box: tuple[int, int, int, int], name: str) -> None:
    piece, _ = trim(img.crop(box))
    save(piece, name)
    print(f'{name:12} {piece.size}')


# El cuerpo saludando: la cara se dibuja aparte.
wave = to_grid('tex.png')
blank_face(wave, range(13, 25), 18, 44)
save(wave, 'wave')
print('wave        ', wave.size)

# Las partes de ese mismo cuerpo, para cuando Tex se agranda y la charla pasa adentro de su cara.
crop(wave, (21, 0, 46, 8), 'cap')
crop(wave, (0, 7, 12, 23), 'hand-left')
crop(wave, (45, 27, 55, 37), 'hand-right')
for y in range(34, 38):
    for x in range(44, 55):
        wave.putpixel((x, y), (0, 0, 0, 0))
crop(wave, (11, 35, 50, 43), 'legs')

support = to_grid('tex-support.png')
blank_face(support, range(17, 28), 17, 45, solid_from=19)
save(support, 'support')
print('support     ', support.size)

goals = to_grid('tex-goals.png')
blank_face(goals, range(20, 34), 16, 46)
save(goals, 'goals')
print('goals       ', goals.size)

# Con anteojos: la cara queda como está (mira los números).
analytics = to_grid('tex-analytics.png')
save(analytics, 'analytics')
print('analytics   ', analytics.size)

head = to_grid('tex-talk-1.png')
blank_face(head, range(5, 18), 8, 36)
head_trim, origin = trim(head)
save(head_trim, 'head')
print('head        ', head_trim.size, 'origen', origin)
crop(head, (8, 24, 22, 29), 'tail')
