"""Arma index.html (un solo archivo) a partir de src/ y vendor/. Uso: python3 tools/build.py"""
import os
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
src = os.path.join(root, 'src')
assets = open(os.path.join(src, 'assets.json')).read()
js = '\n'.join(open(os.path.join(src, f)).read() for f in ['core.js', 'sim.js', 'net.js', 'render.js', 'ui.js', 'flow.js'])
js = js.replace('/*__ASSETS__*/null', assets)
assert '</script' not in js.lower()
page = open(os.path.join(src, 'shell.html')).read().replace('/*__SCRIPT__*/', js)
peer = open(os.path.join(root, 'vendor', 'peerjs.min.js')).read().replace('//# sourceMappingURL=peerjs.min.js.map', '')
assert '</script' not in peer.lower()
head, body = page.split('<div id="app">', 1)
html = ('<!doctype html>\n<html lang="es">\n<head>\n<meta charset="utf-8">\n'
  '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">\n'
  '<style>*,*::before,*::after{box-sizing:border-box}html{color-scheme:dark}body{margin:0;font:14px system-ui,sans-serif}[hidden]{display:none!important}</style>\n'
  + head +
  '<meta name="description" content="Gravity Well: conquista planetaria para el celular, para jugar solo u online con amigos.">\n'
  '<script>/* PeerJS 1.5.4 · MIT License · https://github.com/peers/peerjs (ver vendor/LICENSE-peerjs.txt) */\n' + peer + '\n</script>\n'
  '</head>\n<body>\n<div id="app">' + body + '\n</body>\n</html>\n')
open(os.path.join(root, 'index.html'), 'w').write(html)
print('index.html', len(html), 'bytes')
