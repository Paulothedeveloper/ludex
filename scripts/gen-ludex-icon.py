"""
Gera o icone Ludex (Android + Windows) a partir do scratch.
Design: gradient roxo->pink (identidade KR8) com letra "L" centralizada.
Saida: PNGs nos tamanhos Android + 1024x1024 master.
"""
import os
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(r"D:\Projetos do Claude\Ludex\app")
ICON_DIR = ROOT / "src-tauri" / "icons" / "android"
ICONS_BASE = ROOT / "src-tauri" / "icons"

# Tamanhos Android adaptive icon
# foreground/background sao 432x432 dentro de 108x108dp safe area
# launcher final eh 192px (xxxhdpi)
ANDROID_SIZES = {
    "mdpi":     48,
    "hdpi":     72,
    "xhdpi":    96,
    "xxhdpi":   144,
    "xxxhdpi":  192,
}

# Cores brand Ludex (KR8 dueto)
PURPLE = (124, 58, 237)   # #7c3aed
PINK = (236, 72, 153)     # #ec4899
WHITE = (255, 255, 255)

def make_gradient(size, c1, c2, angle=135):
    """Gradient diagonal de c1 pra c2 (angulo em graus, 135 = top-left -> bottom-right)"""
    base = Image.new('RGB', (size, size), c1)
    top = Image.new('RGB', (size, size), c2)
    mask = Image.new('L', (size, size))
    mdraw = ImageDraw.Draw(mask)
    # Linha gradient
    for y in range(size):
        for x in range(size):
            # progresso diagonal 0..1
            t = (x + y) / (2 * size - 2)
            mdraw.point((x, y), int(t * 255))
    return Image.composite(top, base, mask)

def make_full_icon(size, with_bg=True, rounded=True):
    """Cria icone completo (com background + L centrada).
    Se with_bg=False, retorna SO foreground transparente pra adaptive icon."""
    if with_bg:
        img = make_gradient(size, PURPLE, PINK)
        img = img.convert("RGBA")
    else:
        img = Image.new("RGBA", (size, size), (0, 0, 0, 0))

    draw = ImageDraw.Draw(img)

    # Letra "L" branca centralizada
    # Font: tenta sistemas, fallback default
    font_size = int(size * 0.62)
    font = None
    for font_path in [
        r"C:\Windows\Fonts\arialbd.ttf",  # Arial Bold
        r"C:\Windows\Fonts\segoeuib.ttf", # Segoe UI Bold
        r"C:\Windows\Fonts\impact.ttf",   # Impact
    ]:
        if os.path.isfile(font_path):
            try:
                font = ImageFont.truetype(font_path, font_size)
                break
            except: pass
    if font is None:
        font = ImageFont.load_default()

    # Mede texto e centraliza
    text = "L"
    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    tx = (size - tw) / 2 - bbox[0]
    ty = (size - th) / 2 - bbox[1]

    # Sombra suave
    if with_bg:
        shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        sdraw = ImageDraw.Draw(shadow)
        sdraw.text((tx + size*0.01, ty + size*0.015), text, fill=(0, 0, 0, 80), font=font)
        shadow = shadow.filter(ImageFilter.GaussianBlur(radius=int(size*0.012)))
        img = Image.alpha_composite(img, shadow)
        draw = ImageDraw.Draw(img)

    # Letra branca
    draw.text((tx, ty), text, fill=WHITE, font=font)

    # Ponto amarelo (representa 'play' / botao A do dueto KR8)
    if with_bg:
        dot_r = int(size * 0.07)
        dot_x = int(size * 0.72)
        dot_y = int(size * 0.78)
        # Glow
        glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        gdraw = ImageDraw.Draw(glow)
        gdraw.ellipse([dot_x-dot_r*2, dot_y-dot_r*2, dot_x+dot_r*2, dot_y+dot_r*2],
                       fill=(251, 191, 36, 100))
        glow = glow.filter(ImageFilter.GaussianBlur(radius=int(size*0.015)))
        img = Image.alpha_composite(img, glow)
        draw = ImageDraw.Draw(img)
        # Ponto solido
        draw.ellipse([dot_x-dot_r, dot_y-dot_r, dot_x+dot_r, dot_y+dot_r],
                      fill=(251, 191, 36, 255))

    # Cantos arredondados (mascara) — Android adaptive icon adiciona mascara propria,
    # mas pra ic_launcher.png simples ainda precisa
    if rounded and with_bg:
        mask = Image.new("L", (size, size), 0)
        mdraw = ImageDraw.Draw(mask)
        radius = int(size * 0.22)
        mdraw.rounded_rectangle([0, 0, size, size], radius=radius, fill=255)
        # aplica mascara
        out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        out.paste(img, (0, 0), mask)
        img = out

    return img

def main():
    print("=== Gerando icones Ludex ===")

    # Master 1024x1024 pra Windows e source
    master = make_full_icon(1024, with_bg=True, rounded=True)
    master_path = ROOT / "icon-1024.png"
    master.save(master_path, "PNG")
    print(f"  master 1024:  {master_path}")

    # Master sem corners (pra Tauri ico gerar)
    icon512 = make_full_icon(512, with_bg=True, rounded=True)
    icon512.save(ICONS_BASE / "icon.png", "PNG")
    print(f"  tauri icon: {ICONS_BASE / 'icon.png'}")

    # Tamanhos menores Tauri
    for sz, name in [(32, "32x32.png"), (64, "64x64.png"), (128, "128x128.png"),
                      (256, "128x128@2x.png")]:
        i = make_full_icon(sz, with_bg=True, rounded=True)
        i.save(ICONS_BASE / name, "PNG")
        print(f"  tauri {name}")

    # Android: ic_launcher.png (com fundo arredondado) + ic_launcher_round.png + foreground
    for dpi, size in ANDROID_SIZES.items():
        outdir = ICON_DIR / f"mipmap-{dpi}"
        outdir.mkdir(parents=True, exist_ok=True)

        # Regular launcher: fundo + arredondado
        ic = make_full_icon(size, with_bg=True, rounded=True)
        ic.save(outdir / "ic_launcher.png", "PNG")

        # Round launcher: mesma coisa (Android coloca mascara circular)
        ic_round = make_full_icon(size, with_bg=True, rounded=True)
        ic_round.save(outdir / "ic_launcher_round.png", "PNG")

        # Foreground: SO a letra L + ponto (transparente), tamanho 1.5x pra adaptive icon
        # Android adaptive: foreground deve ser 108x108dp com safe zone 66x66 central
        fg_size = int(size * 1.5)
        # Cria com fundo (depois remove o bg do gradient pra ficar so a L+ponto)
        fg = make_full_icon(fg_size, with_bg=False, rounded=False)
        # Re-render so foreground stuff
        fg2 = Image.new("RGBA", (fg_size, fg_size), (0, 0, 0, 0))
        d = ImageDraw.Draw(fg2)
        font_size = int(fg_size * 0.42)
        font = None
        for fp in [r"C:\Windows\Fonts\arialbd.ttf", r"C:\Windows\Fonts\segoeuib.ttf"]:
            if os.path.isfile(fp):
                font = ImageFont.truetype(fp, font_size)
                break
        bbox = d.textbbox((0, 0), "L", font=font)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]
        tx = (fg_size - tw) / 2 - bbox[0]
        ty = (fg_size - th) / 2 - bbox[1]
        d.text((tx, ty), "L", fill=WHITE, font=font)
        # Ponto
        dot_r = int(fg_size * 0.045)
        dx = int(fg_size * 0.62)
        dy = int(fg_size * 0.65)
        d.ellipse([dx-dot_r, dy-dot_r, dx+dot_r, dy+dot_r], fill=(251, 191, 36, 255))
        fg2.save(outdir / "ic_launcher_foreground.png", "PNG")
        print(f"  android mipmap-{dpi}: {size}x{size}")

    # Adaptive icon: troca background pra gradient roxo->pink (ja era branco)
    # Atualiza values/ic_launcher_background.xml
    values_dir = ICON_DIR / "values"
    values_dir.mkdir(parents=True, exist_ok=True)
    bg_xml = values_dir / "ic_launcher_background.xml"
    bg_xml.write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<resources>\n'
        '  <color name="ic_launcher_background">#7c3aed</color>\n'
        '</resources>\n',
        encoding="utf-8"
    )
    print(f"  background color XML: {bg_xml}")

    # Adaptive icon definition (mipmap-anydpi-v26/ic_launcher.xml)
    anydpi_dir = ICON_DIR / "mipmap-anydpi-v26"
    anydpi_dir.mkdir(parents=True, exist_ok=True)
    (anydpi_dir / "ic_launcher.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
        '  <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n'
        '  <background android:drawable="@color/ic_launcher_background"/>\n'
        '</adaptive-icon>\n',
        encoding="utf-8"
    )
    print(f"  adaptive icon XML: {anydpi_dir / 'ic_launcher.xml'}")

    print("\n=== OK ===")

if __name__ == "__main__":
    main()
