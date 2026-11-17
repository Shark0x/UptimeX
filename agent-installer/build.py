"""Gera pacote fonte e, no Windows, executavel com o favicon oficial do projeto."""
import argparse
import hashlib
import json
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parent
VERSION = '0.1.0'


def build_icons():
    from PIL import Image
    import resvg_py
    assets = ROOT / 'assets'
    assets.mkdir(exist_ok=True)
    svg = ROOT.parent / 'frontend/public/favicon.svg'
    (assets / 'uptimex.png').write_bytes(resvg_py.svg_to_bytes(svg_path=str(svg), width=256, height=256))
    with Image.open(assets / 'uptimex.png') as image:
        image.save(assets / 'uptimex.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--windows', action='store_true')
    parser.add_argument('--publish', action='store_true', help='Copiar pacotes para frontend/public/downloads')
    args = parser.parse_args()
    if args.windows and platform.system() != 'Windows':
        parser.error('O executavel Windows deve ser construido no Windows.')
    dist = ROOT / 'dist'
    dist.mkdir(exist_ok=True)
    if args.windows:
        build_icons()
        subprocess.run([sys.executable, '-m', 'PyInstaller', '--noconfirm', '--clean', '--onefile', '--windowed',
                        '--name', 'uptimeX-Agent-Windows', '--icon', str(ROOT / 'assets/uptimex.ico'),
                        '--add-data', str(ROOT / 'assets') + ':assets', '--paths', str(ROOT),
                        '--distpath', str(dist), '--workpath', str(ROOT / 'build'), '--specpath', str(ROOT / 'build'),
                        str(ROOT / 'windows_entry.py')], check=True)
    source = dist / 'uptimeX-Agent-Python.zip'
    # Lista explicita: nunca inclui .venv, arquivos de estado ou credenciais.
    with zipfile.ZipFile(source, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name in ('install.py', 'gui.py', 'README.md', 'TESTE.md'):
            archive.write(ROOT / name, 'uptimeX-agent/' + name)
        for name in ('uptimex.ico', 'uptimex.png'):
            if (ROOT / 'assets' / name).exists():
                archive.write(ROOT / 'assets' / name, 'uptimeX-agent/assets/' + name)
    if args.publish:
        target = ROOT.parent / 'frontend/public/downloads'
        target.mkdir(exist_ok=True)
        manifest = {'version': VERSION, 'python': None, 'windows': None}
        for key, path in [('python', source), ('windows', dist / 'uptimeX-Agent-Windows.exe')]:
            if path.exists():
                shutil.copy2(path, target / path.name)
                manifest[key] = {'url': '/downloads/' + path.name, 'bytes': path.stat().st_size,
                                 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
        (target / 'agent-manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print('Pacotes gerados em ' + str(dist))


if __name__ == '__main__':
    main()
