"""Export all app icons from the approved master using macOS image tools."""
import base64
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'electron/app-icon.png'


def resize(size, destination):
    subprocess.run(['sips', '-z', str(size), str(size), str(SOURCE),
                    '--out', str(destination)], check=True, capture_output=True)


def main():
    iconset = ROOT / 'electron/icon.iconset'
    iconset.mkdir(exist_ok=True)
    for size in (16, 32, 128, 256, 512):
        resize(size, iconset / f'icon_{size}x{size}.png')
        resize(size * 2, iconset / f'icon_{size}x{size}@2x.png')
    resize(1024, ROOT / 'electron/dock-icon.png')
    resize(256, ROOT / 'frontend/icon.png')
    subprocess.run(['iconutil', '-c', 'icns', str(iconset), '-o',
                    str(ROOT / 'electron/icon.icns')], check=True)
    # Keep the existing SVG entry point faithful to the raster master.
    encoded = base64.b64encode(SOURCE.read_bytes()).decode('ascii')
    (ROOT / 'electron/icon.svg').write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">\n'
        '  <title>映屿 · luminisle</title>\n'
        f'  <image width="1024" height="1024" href="data:image/png;base64,{encoded}"/>\n'
        '</svg>\n')
    print('Exported luminisle icons: web, Dock, ICNS, iconset and SVG wrapper')


if __name__ == '__main__':
    main()
