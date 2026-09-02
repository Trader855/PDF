from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parent.parent
BUILD_DIR = ROOT / "build"
ICONSET_DIR = BUILD_DIR / "icon.iconset"
CANVAS_SIZE = 1024


def rounded_gradient() -> Image.Image:
    image = Image.new("RGBA", (CANVAS_SIZE, CANVAS_SIZE), (0, 0, 0, 0))

    shadow = Image.new("RGBA", image.size, (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    shadow_draw.rounded_rectangle((108, 126, 916, 934), radius=205, fill=(80, 20, 25, 105))
    shadow = shadow.filter(ImageFilter.GaussianBlur(38))
    image.alpha_composite(shadow)

    gradient = Image.new("RGBA", image.size)
    pixels = gradient.load()
    top = (255, 105, 94)
    bottom = (207, 44, 52)
    for y in range(CANVAS_SIZE):
        ratio = y / (CANVAS_SIZE - 1)
        color = tuple(round(top[index] * (1 - ratio) + bottom[index] * ratio) for index in range(3))
        for x in range(CANVAS_SIZE):
            pixels[x, y] = (*color, 255)

    mask = Image.new("L", image.size, 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.rounded_rectangle((100, 96, 924, 920), radius=205, fill=255)
    gradient.putalpha(mask)
    image.alpha_composite(gradient)

    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((103, 99, 921, 917), radius=202, outline=(255, 255, 255, 80), width=6)

    # Foglio bianco e angolo ripiegato.
    draw.rounded_rectangle((287, 215, 738, 812), radius=62, fill=(255, 255, 255, 248))
    draw.polygon(((603, 215), (738, 350), (603, 350)), fill=(235, 239, 248, 255))
    draw.line((603, 215, 603, 350, 738, 350), fill=(208, 214, 226, 255), width=8, joint="curve")

    # Righe documento.
    for y, width in ((449, 270), (526, 318), (603, 246), (680, 294)):
        draw.rounded_rectangle((365, y, 365 + width, y + 24), radius=12, fill=(84, 102, 133, 205))

    # Segno di modifica blu.
    pencil = Image.new("RGBA", image.size, (0, 0, 0, 0))
    pencil_draw = ImageDraw.Draw(pencil)
    pencil_draw.rounded_rectangle((510, 570, 650, 800), radius=28, fill=(62, 112, 245, 255))
    pencil_draw.polygon(((510, 570), (580, 482), (650, 570)), fill=(118, 157, 255, 255))
    pencil_draw.polygon(((580, 482), (564, 520), (596, 520)), fill=(37, 42, 56, 255))
    pencil = pencil.rotate(-42, resample=Image.Resampling.BICUBIC, center=(580, 650))
    image.alpha_composite(pencil)

    return image


def main() -> None:
    BUILD_DIR.mkdir(parents=True, exist_ok=True)
    ICONSET_DIR.mkdir(parents=True, exist_ok=True)
    icon = rounded_gradient()
    icon.save(BUILD_DIR / "icon_1024.png")

    outputs = {
        "icon_16x16.png": 16,
        "icon_16x16@2x.png": 32,
        "icon_32x32.png": 32,
        "icon_32x32@2x.png": 64,
        "icon_128x128.png": 128,
        "icon_128x128@2x.png": 256,
        "icon_256x256.png": 256,
        "icon_256x256@2x.png": 512,
        "icon_512x512.png": 512,
        "icon_512x512@2x.png": 1024,
    }
    for filename, size in outputs.items():
        icon.resize((size, size), Image.Resampling.LANCZOS).save(ICONSET_DIR / filename)


if __name__ == "__main__":
    main()
