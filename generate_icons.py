import struct
import zlib
import os

def create_png(width, height, draw_func, filename):
    raw_data = bytearray()
    for y in range(height):
        raw_data.append(0)
        for x in range(width):
            r, g, b, a = draw_func(x, y, width, height)
            raw_data.extend([r, g, b, a])
    
    png = b'\x89PNG\r\n\x1a\n'
    ihdr_data = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    ihdr_crc = zlib.crc32(b'IHDR' + ihdr_data)
    png += struct.pack('>I', len(ihdr_data)) + b'IHDR' + ihdr_data + struct.pack('>I', ihdr_crc)
    
    compressed = zlib.compress(bytes(raw_data), 9)
    idat_crc = zlib.crc32(b'IDAT' + compressed)
    png += struct.pack('>I', len(compressed)) + b'IDAT' + compressed + struct.pack('>I', idat_crc)
    
    iend_crc = zlib.crc32(b'IEND')
    png += struct.pack('>I', 0) + b'IEND' + struct.pack('>I', iend_crc)
    
    with open(filename, 'wb') as f:
        f.write(png)

def plex_icon_drawer(x, y, w, h):
    nx = x / (w - 1) if w > 1 else 0.5
    ny = y / (h - 1) if h > 1 else 0.5
    
    cx, cy = 0.5, 0.5
    dx = abs(nx - cx)
    dy = abs(ny - cy)
    corner_r = 0.18
    in_box = False
    if dx <= (0.5 - corner_r) and dy <= 0.5:
        in_box = True
    elif dy <= (0.5 - corner_r) and dx <= 0.5:
        in_box = True
    elif ((dx - (0.5 - corner_r))**2 + (dy - (0.5 - corner_r))**2) <= corner_r**2:
        in_box = True
    
    if not in_box:
        return (0, 0, 0, 0)
        
    sym_y = abs(ny - 0.5)
    x_max = 0.74 - (sym_y / 0.28) * 0.26
    x_min = 0.48 - (sym_y / 0.28) * 0.26
    
    if sym_y <= 0.28 and x_min <= nx <= x_max:
        return (229, 160, 13, 255) # Plex Orange #E5A00D
    
    return (30, 35, 40, 255) # Background #1E2328

out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "icons")
os.makedirs(out_dir, exist_ok=True)
for size in [16, 48, 128]:
    create_png(size, size, plex_icon_drawer, os.path.join(out_dir, f"icon{size}.png"))
print("Icons generated successfully!")
