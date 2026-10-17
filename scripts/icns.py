# Writes a small .icns from the dark icon (PNG entries, palette-reduced). Run once when the icon changes.
# Copyright (c) 2026 Jagadeesh Kumar S. All rights reserved.
import io, struct, sys
from PIL import Image
src = Image.open(sys.argv[1]).convert('RGBA')
def png(px):
    im = src.resize((px, px), Image.LANCZOS)
    b = io.BytesIO(); im.save(b, 'PNG', optimize=True); return b.getvalue()
entries = [(b'icp4', 16), (b'icp5', 32), (b'ic11', 32), (b'ic12', 64), (b'ic07', 128), (b'ic08', 256), (b'ic13', 256)]
body = b''.join(t + struct.pack('>I', len(d) + 8) + d for t, d in ((t, png(px)) for t, px in entries))
open(sys.argv[2], 'wb').write(b'icns' + struct.pack('>I', len(body) + 8) + body)
