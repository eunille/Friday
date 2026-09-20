"""Cut everything the app uses out of the sprite atlas.

    python tools/cut-sprites.py

From `assets/images/sprites/sprites.png`:

* the Main/Idle owl, to the four places the mark appears — `icon.png`,
  `adaptive-icon.png`, `favicon.png` and `splash-icon.png`;
* the Cooking row, to `sprites/cook-sheet.png`, the five frame loop the warm
  start plays under the changing word;
* Typing and Focus, to `sprites/work-sheet.png`, which plays while a model
  downloads.

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

# The two loops. Frames are cropped at their own left edge and a shared
# vertical window, so the owl stays put while the pan, the egg and the sparks
# move — which is the whole point of the row. The cell is wider than any frame
# on purpose: art flush against a cell edge bleeds into the neighbouring cell
# as soon as the window lands on a fractional pixel, which it does on the web.
FRAME = (120, 134)
GUTTER = 6  # clear space inside each cell, so a cell edge never cuts the art
WINDOW = (290, 424)  # the shared y band, in atlas pixels
COOK = [(28, 125), (141, 246), (253, 341), (347, 433), (470, 561)]
WORK = [(812, 912), (922, 1016)]
LOOP_SCALE = 4  # after halving: a net 2x, so a 110dp box is not a 3x upscale

# One pose per screen, so the badge in a header says what that screen is for.
# Same gutter rule as the loops: nothing touches a cell edge, or it shows up
# down the side of its neighbour when the window lands on a fractional pixel.
# Whole sprites rather than head crops: cropping to the face would make every
# pose the same owl, which is the one thing this is not for.
FACE = 112
POSES = {
    "hero": (695, 900, 775, 982),
    "stretch": (918, 722, 1020, 828),
    "reading": (556, 900, 625, 982),
    "glasses": (632, 900, 695, 982),
    "earn": (26, 507, 128, 639),
    "savings": (148, 507, 244, 639),
    "rich": (246, 507, 347, 639),
    "happy": (349, 507, 469, 639),
}



ICON = 1024
BODY = 9  # upscale for icon.png: 86 art pixels -> 774, about 76% of the icon
SAFE = 7  # adaptive-icon.png: Android masks to the middle 66%, so 602 fits
SPLASH = 4  # splash-icon.png renders at imageWidth 140


def checker(pixel: tuple[int, int, int]) -> bool:
    """Is this one of the two greys the painted checkerboard is made of?"""
    r, g, b = pixel
    return (max(r, g, b) - min(r, g, b)) <= 6 and (r + g + b) // 3 >= 228


def keyed(box: tuple[int, int, int, int]) -> Image.Image:
    """Lift one region off the painted checkerboard."""
    crop = Image.open(ATLAS).convert("RGB").crop(box)
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

    return out


def cut() -> Image.Image:
    out = keyed(CELL)
    out = out.crop(out.getbbox())
    return out.resize((out.size[0] // 2, out.size[1] // 2), Image.BOX)


def sheet(frames: list[tuple[int, int]], centred: bool) -> Image.Image:
    """Lay a row of the atlas out as one strip of equal cells."""
    strip = Image.new("RGBA", (FRAME[0] * len(frames), FRAME[1]), (0, 0, 0, 0))
    for column, (left, right) in enumerate(frames):
        cell = keyed((left, WINDOW[0], right, WINDOW[1]))
        # Trim to what actually survived the key before aligning: the column
        # scan's edge is wherever the frame got thick enough to detect, which
        # is not the owl, and lining up on it makes him slide about.
        box = cell.getbbox()
        cell = cell.crop((box[0], 0, box[2], FRAME[1]))
        inset = (FRAME[0] - cell.size[0]) // 2 if centred else GUTTER
        x = column * FRAME[0] + inset
        strip.alpha_composite(cell, (x, 0))
    half = strip.resize((strip.size[0] // 2, strip.size[1] // 2), Image.BOX)
    return half.resize(
        (half.size[0] * LOOP_SCALE, half.size[1] * LOOP_SCALE), Image.NEAREST
    )


def place(owl: Image.Image, factor: int, size: int, ground: tuple[int, int, int, int] | None):
    canvas = Image.new("RGBA", (size, size), ground or (0, 0, 0, 0))
    big = owl.resize((owl.size[0] * factor, owl.size[1] * factor), Image.NEAREST)
    canvas.alpha_composite(big, ((size - big.size[0]) // 2, (size - big.size[1]) // 2))
    return canvas


def faces() -> Image.Image:
    """Every avatar pose, on one strip, centred in square cells."""
    strip = Image.new("RGBA", (FACE * len(POSES), FACE), (0, 0, 0, 0))
    for column, box in enumerate(POSES.values()):
        cell = keyed(box)
        cell = cell.crop(cell.getbbox())
        # To one height, not one bounding box: the atlas draws these at
        # different scales, and a badge that changes size between screens reads
        # as a mistake rather than a different pose.
        scale = min((FACE - GUTTER * 3) / cell.size[1], (FACE - GUTTER * 3) / cell.size[0])
        cell = cell.resize((round(cell.size[0] * scale), round(cell.size[1] * scale)), Image.BOX)
        strip.alpha_composite(
            cell,
            (column * FACE + (FACE - cell.size[0]) // 2, (FACE - cell.size[1]) // 2),
        )
    return strip.resize((strip.size[0] * 2, strip.size[1] * 2), Image.NEAREST)


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

    for name, frames, centred in (("cook", COOK, False), ("work", WORK, True)):
        strip = sheet(frames, centred)
        strip.save(f"assets/images/sprites/{name}-sheet.png", optimize=True)
        print(f"{name}-sheet: {strip.size[0]}x{strip.size[1]}, {len(frames)} frames")

    poses = faces()
    poses.save("assets/images/sprites/faces-sheet.png", optimize=True)
    print(f"faces-sheet: {poses.size[0]}x{poses.size[1]}, {', '.join(POSES)}")




if __name__ == "__main__":
    main()
