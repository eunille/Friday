"""Cut the opening animation's sprite sheet from the artwork.

    python tools/cut-intro-sheet.py

Reads `assets/images/sprites/app intro.png` (12 labelled frames, 6x2) and
writes `assets/images/sprites/intro-sheet.png`, which is what the app ships.

Two things it fixes, both of which are silent if you crop by hand:

* The frame numbers printed under each drawing are cropped off.
* The flying frames sit about 123px lower in their cells than the standing
  ones, so a uniform crop would make him jump *up* as he lands. Each row is
  cropped from its own feet line onto a shared baseline instead.

It also flattens the artwork's vignetted backdrop onto the app's GROUND colour.
The sheet is bright-on-dark with additive glow, so subtracting its backdrop and
re-adding a flat one leaves no edge where the frame meets the boot screen, and
nothing has to be keyed to transparency.

The check is that re-running this leaves `git status` clean. If it does not,
either the artwork changed or one of the measurements below has gone stale.
"""

from PIL import Image, ImageChops

SRC = "assets/images/sprites/app intro.png"
OUT = "assets/images/sprites/intro-sheet.png"

CELL = (256, 512)  # source cell, the sheet being 1536x1024
FRAME = (256, 290)  # what we keep of it
BASE = 248  # where the feet sit inside the kept frame
FEET = {0: 395, 1: 272}  # measured feet line per source row, in cell pixels
BACKDROP = (18, 19, 27)  # the artwork's own field, vignetted by about 3
GROUND = (22, 24, 29)  # #16181D, the app's dark surface


def main() -> None:
    src = Image.open(SRC).convert("RGB")
    lit = ImageChops.subtract(src, Image.new("RGB", src.size, BACKDROP))
    lit = ImageChops.add(lit, Image.new("RGB", src.size, GROUND))

    out = Image.new("RGB", (FRAME[0] * 6, FRAME[1] * 2), GROUND)
    for index in range(12):
        col, row = index % 6, index // 6
        top = row * CELL[1] + FEET[row] - BASE
        box = (col * CELL[0], top, col * CELL[0] + CELL[0], top + FRAME[1])
        out.paste(lit.crop(box), (col * FRAME[0], row * FRAME[1]))

    out.save(OUT, optimize=True)
    print(f"{OUT}: {out.size[0]}x{out.size[1]}")


if __name__ == "__main__":
    main()
