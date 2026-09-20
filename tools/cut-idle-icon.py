"""Cut the app icon out of the sprite atlas.

    python tools/cut-idle-icon.py

Takes the Main/Idle owl from `assets/images/sprites/sprites.png` and writes the
four places the mark appears: `icon.png`, `adaptive-icon.png`, `favicon.png`
and `splash-icon.png`.

The atlas has no alpha. Its transparency is a *painted* checkerboard, and the
owl's own face is (253,253,253) — the same value as the light squares — so no
colour test can separate them. Flooding the outside leaks through a soft spot
in the outline and eats the face.

So the silhouette is sealed first: everything that is not a checker colour is
dilated by a pixel, which closes the gap, and the outside is flooded around
that. What the flood then leaves behind is a pale fringe where the artwork's
own antialiasing blended the owl into the checkerboard — warm enough to fail
the checker test, so nothing else will ever clear it — and the silhouette is
eroded two pixels to take it off. The result is halved, and scaled up with
NEAREST at whole factors only, because a fractional upscale of pixel art gives
you blocks of two different widths.

The check is that re-running this leaves `git status` clean.
"""

from collections import deque

from PIL import Image, ImageFilter

ATLAS = "assets/images/sprites/sprites.png"
CELL = (8, 46, 210, 240)  # the Main/Idle owl, generously boxed
GROUND = (22, 24, 29, 255)  # #16181D, matching adaptiveIcon.backgroundColor

ICON = 1024
BODY = 9  # upscale for icon.png: 86 art pixels -> 774, about 76% of the icon
SAFE = 7  # adaptive-icon.png: Android masks to the middle 66%, so 602 fits
SPLASH = 4  # splash-icon.png renders at imageWidth 140


def checker(pixel: tuple[int, int, int]) -> bool:
    """Is this one of the two greys the painted checkerboard is made of?"""
    r, g, b = pixel
    return (max(r, g, b) - min(r, g, b)) <= 6 and (r + g + b) // 3 >= 228


def cut() -> Image.Image:
    crop = Image.open(ATLAS).convert("RGB").crop(CELL)
    w, h = crop.size
    px = crop.load()

    solid = Image.new("L", (w, h), 0)
    sp = solid.load()
    for y in range(h):
        for x in range(w):
            if not checker(px[x, y]):
                sp[x, y] = 255
    sealed = solid.filter(ImageFilter.MaxFilter(3)).load()

    flood = Image.new("L", (w, h), 0)
    fp = flood.load()
    queue: deque[tuple[int, int]] = deque()

    def push(x: int, y: int) -> None:
        if not sealed[x, y] and not fp[x, y]:
            fp[x, y] = 255
            queue.append((x, y))

    for x in range(w):
        push(x, 0)
        push(x, h - 1)
    for y in range(h):
        push(0, y)
        push(w - 1, y)
    while queue:
        x, y = queue.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h:
                push(nx, ny)

    keep = Image.eval(flood, lambda v: 255 - v).filter(ImageFilter.MinFilter(5))
    kp = keep.load()
    out = crop.convert("RGBA")
    op = out.load()
    for y in range(h):
        for x in range(w):
            if not kp[x, y]:
                op[x, y] = (0, 0, 0, 0)

    out = out.crop(out.getbbox())
    return out.resize((out.size[0] // 2, out.size[1] // 2), Image.BOX)


def place(owl: Image.Image, factor: int, size: int, ground: tuple[int, int, int, int] | None):
    canvas = Image.new("RGBA", (size, size), ground or (0, 0, 0, 0))
    big = owl.resize((owl.size[0] * factor, owl.size[1] * factor), Image.NEAREST)
    canvas.alpha_composite(big, ((size - big.size[0]) // 2, (size - big.size[1]) // 2))
    return canvas


def main() -> None:
    owl = cut()
    print(f"idle owl: {owl.size[0]}x{owl.size[1]} art pixels")

    icon = place(owl, BODY, ICON, GROUND)
    icon.convert("RGB").save("assets/images/icon.png", optimize=True)
    place(owl, SAFE, ICON, None).save("assets/images/adaptive-icon.png", optimize=True)
    icon.convert("RGB").resize((128, 128), Image.LANCZOS).save(
        "assets/images/favicon.png", optimize=True
    )
    place(owl, SPLASH, 420, None).save("assets/images/splash-icon.png", optimize=True)
    print("wrote icon, adaptive-icon, favicon, splash-icon")


if __name__ == "__main__":
    main()
