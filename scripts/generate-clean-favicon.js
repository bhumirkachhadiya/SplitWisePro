const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// 1. Create crisp SVG favicon
const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="emeraldTealGrad" x1="0%" y1="100%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#10b981"/>
      <stop offset="50%" stop-color="#14b8a6"/>
      <stop offset="100%" stop-color="#2dd4bf"/>
    </linearGradient>
    <filter id="neonGlow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="0" stdDeviation="1.5" flood-color="#10b981" flood-opacity="0.4"/>
    </filter>
  </defs>
  <!-- Transparent background outside the rounded badge -->
  <!-- Dark Obsidian Badge Background with Rounded Corners -->
  <rect x="3" y="3" width="58" height="58" rx="16" fill="#090b10" stroke="url(#emeraldTealGrad)" stroke-width="2.8" filter="url(#neonGlow)"/>
  <!-- Exact Project Dollar Icon -->
  <g transform="translate(8, 8) scale(2)">
    <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" fill="none" stroke="#34d399" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>`;

const svgPath = path.join(__dirname, '..', 'favicon.svg');
fs.writeFileSync(svgPath, svgContent, 'utf8');
console.log('Saved favicon.svg');

// 2. Generate a pixel-perfect 64x64 transparent RGBA PNG
const size = 64;
const radius = 16;
const rgbaBuffer = Buffer.alloc(size * size * 4, 0); // initial alpha = 0 (100% transparent!)

function setPixel(x, y, r, g, b, a) {
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    const idx = (y * size + x) * 4;
    // Alpha blending if already set
    if (a === 255 || rgbaBuffer[idx + 3] === 0) {
        rgbaBuffer[idx] = r;
        rgbaBuffer[idx + 1] = g;
        rgbaBuffer[idx + 2] = b;
        rgbaBuffer[idx + 3] = a;
    } else {
        const srcA = a / 255;
        const dstA = rgbaBuffer[idx + 3] / 255;
        const outA = srcA + dstA * (1 - srcA);
        rgbaBuffer[idx] = Math.round((r * srcA + rgbaBuffer[idx] * dstA * (1 - srcA)) / outA);
        rgbaBuffer[idx + 1] = Math.round((g * srcA + rgbaBuffer[idx + 1] * dstA * (1 - srcA)) / outA);
        rgbaBuffer[idx + 2] = Math.round((b * srcA + rgbaBuffer[idx + 2] * dstA * (1 - srcA)) / outA);
        rgbaBuffer[idx + 3] = Math.round(outA * 255);
    }
}

// Distance to rounded rectangle (x0=3, y0=3, w=58, h=58, r=16)
const bx0 = 3, by0 = 3, bw = 58, bh = 58;
const bx1 = bx0 + bw, by1 = by0 + bh;

for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
        // Find distance to inside of rounded rectangle
        const cx = Math.max(bx0 + radius, Math.min(x, bx1 - radius));
        const cy = Math.max(by0 + radius, Math.min(y, by1 - radius));
        const distToCenter = Math.hypot(x - cx, y - cy);
        
        let inBadge = false;
        if (x >= bx0 && x <= bx1 && y >= by0 && y <= by1) {
            if (x < bx0 + radius && y < by0 + radius) inBadge = distToCenter <= radius;
            else if (x > bx1 - radius && y < by0 + radius) inBadge = distToCenter <= radius;
            else if (x < bx0 + radius && y > by1 - radius) inBadge = distToCenter <= radius;
            else if (x > bx1 - radius && y > by1 - radius) inBadge = distToCenter <= radius;
            else inBadge = true;
        }

        if (inBadge) {
            // Distance from outer boundary
            let distToEdge = Math.min(x - bx0, bx1 - x, y - by0, by1 - y);
            if (x < bx0 + radius && y < by0 + radius) distToEdge = radius - distToCenter;
            else if (x > bx1 - radius && y < by0 + radius) distToEdge = radius - distToCenter;
            else if (x < bx0 + radius && y > by1 - radius) distToEdge = radius - distToCenter;
            else if (x > bx1 - radius && y > by1 - radius) distToEdge = radius - distToCenter;

            // Gradient on border: bottom-left (emerald #10b981: 16, 185, 129) to top-right (teal #2dd4bf: 45, 212, 191)
            const t = ((x - bx0) + (by1 - y)) / (bw + bh);
            const borderR = Math.round(16 + t * (45 - 16));
            const borderG = Math.round(185 + t * (212 - 185));
            const borderB = Math.round(129 + t * (191 - 129));

            if (distToEdge <= 2.5) {
                // Border pixel
                setPixel(x, y, borderR, borderG, borderB, 255);
            } else {
                // Interior dark badge background (#090b10)
                setPixel(x, y, 9, 11, 16, 255);
            }
        }
    }
}

// Draw the Project Dollar Icon on top (scaled 2x in center, offset (8, 8))
// Line segments:
// Vertical line: x = 32, y from 12 to 52
// Top bar: y = 18, x from 27 to 37
// Top curve: x from 27 around to 32, y from 18 to 32
// Bottom curve: x from 32 around to 37, y from 32 to 46
// Bottom bar: y = 46, x from 20 to 37

function drawLine(x0, y0, x1, y1, widthPx, r, g, b) {
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.ceil(dist * 2);
    for (let s = 0; s <= steps; s++) {
        const curX = x0 + (x1 - x0) * (s / steps);
        const curY = y0 + (y1 - y0) * (s / steps);
        const half = widthPx / 2;
        for (let dy = -Math.ceil(half); dy <= Math.ceil(half); dy++) {
            for (let dx = -Math.ceil(half); dx <= Math.ceil(half); dx++) {
                if (Math.hypot(dx, dy) <= half) {
                    setPixel(Math.round(curX + dx), Math.round(curY + dy), r, g, b, 255);
                }
            }
        }
    }
}

function drawArc(cx, cy, rRadius, startAngle, endAngle, widthPx, r, g, b) {
    const steps = 60;
    for (let s = 0; s <= steps; s++) {
        const a = startAngle + (endAngle - startAngle) * (s / steps);
        const px = cx + Math.cos(a) * rRadius;
        const py = cy + Math.sin(a) * rRadius;
        const half = widthPx / 2;
        for (let dy = -Math.ceil(half); dy <= Math.ceil(half); dy++) {
            for (let dx = -Math.ceil(half); dx <= Math.ceil(half); dx++) {
                if (Math.hypot(dx, dy) <= half) {
                    setPixel(Math.round(px + dx), Math.round(py + dy), r, g, b, 255);
                }
            }
        }
    }
}

// Mint green dollar symbol color (#34d399: 52, 211, 153)
const strokeColor = [52, 211, 153];
const strokeW = 4.2;

// Vertical center stem: x=32, y from 12 to 52
drawLine(32, 12, 32, 52, strokeW, strokeColor[0], strokeColor[1], strokeColor[2]);

// Top S-curve:
// Starts at x=42, y=18, goes left to x=27, y=18
drawLine(32, 18, 42, 18, strokeW, strokeColor[0], strokeColor[1], strokeColor[2]);
// Arc around left: center (27, 25), radius 7, angles -PI/2 (top) to PI/2 (bottom)
drawArc(27, 25, 7, -Math.PI / 2, Math.PI / 2, strokeW, strokeColor[0], strokeColor[1], strokeColor[2]);
// Cross center bar from (27, 32) to (37, 32)
drawLine(27, 32, 37, 32, strokeW, strokeColor[0], strokeColor[1], strokeColor[2]);
// Bottom arc around right: center (37, 39), radius 7, angles -PI/2 to PI/2
drawArc(37, 39, 7, -Math.PI / 2, Math.PI / 2, strokeW, strokeColor[0], strokeColor[1], strokeColor[2]);
// Bottom end stroke to left: (37, 46) to (22, 46)
drawLine(22, 46, 37, 46, strokeW, strokeColor[0], strokeColor[1], strokeColor[2]);

// Convert raw RGBA to PNG format
const stride = 1 + size * 4;
const rawScanlines = Buffer.alloc(size * stride);
for (let y = 0; y < size; y++) {
    rawScanlines[y * stride] = 0; // Filter None
    rgbaBuffer.copy(rawScanlines, y * stride + 1, y * size * 4, (y + 1) * size * 4);
}

const idatData = zlib.deflateSync(rawScanlines, { level: 9 });

function crc32(buf) {
    let crc = 0 ^ (-1);
    for (let i = 0; i < buf.length; i++) {
        crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xFF];
    }
    return (crc ^ (-1)) >>> 0;
}

const crcTable = [];
for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
        c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
    }
    crcTable[i] = c;
}

function makeChunk(type, data) {
    const len = data.length;
    const buf = Buffer.alloc(12 + len);
    buf.writeUInt32BE(len, 0);
    buf.write(type, 4, 4, 'ascii');
    data.copy(buf, 8);
    const crcVal = crc32(buf.slice(4, 8 + len));
    buf.writeUInt32BE(crcVal, 8 + len);
    return buf;
}

const ihdrData = Buffer.alloc(13);
ihdrData.writeUInt32BE(size, 0);
ihdrData.writeUInt32BE(size, 4);
ihdrData.writeUInt8(8, 8); // 8-bit
ihdrData.writeUInt8(6, 9); // RGBA
ihdrData.writeUInt8(0, 10);
ihdrData.writeUInt8(0, 11);
ihdrData.writeUInt8(0, 12);

const pngSig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
const pngBuffer = Buffer.concat([
    pngSig,
    makeChunk('IHDR', ihdrData),
    makeChunk('IDAT', idatData),
    makeChunk('IEND', Buffer.alloc(0))
]);

const pngPath = path.join(__dirname, '..', 'favicon.png');
const icoPath = path.join(__dirname, '..', 'favicon.ico');
fs.writeFileSync(pngPath, pngBuffer);
fs.writeFileSync(icoPath, pngBuffer);

const b64Png = pngBuffer.toString('base64');
fs.writeFileSync(path.join(__dirname, '..', 'temp_clean_png_b64.txt'), b64Png);

console.log('Saved 100% transparent favicon.png and favicon.ico, size:', pngBuffer.length);
console.log('Clean PNG base64 length:', b64Png.length);

process.exit(0);
