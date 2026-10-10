import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const publicDir = path.resolve(__dirname, '../public');
const iconsDir = path.join(publicDir, 'icons');

if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// Clean hospital & queue emblem SVG (512x512)
// Designed within safe zone (80% circle) so it renders sharply on both standard and maskable icons.
const svgBadge = (isMaskable = false) => `
<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#2563eb" />
      <stop offset="100%" stop-color="#1d4ed8" />
    </linearGradient>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#0f172a" flood-opacity="0.25"/>
    </filter>
  </defs>

  <!-- Background -->
  ${
    isMaskable
      ? `<rect width="512" height="512" fill="url(#bgGrad)" />`
      : `<rect width="512" height="512" rx="112" fill="url(#bgGrad)" />`
  }

  <!-- Center emblem group with drop shadow -->
  <g filter="url(#shadow)">
    <!-- Outer Shield / Circle Container -->
    <circle cx="256" cy="256" r="160" fill="#ffffff" fill-opacity="0.15" />
    <circle cx="256" cy="256" r="136" fill="#ffffff" />

    <!-- Hospital Cross (Primary Blue) -->
    <rect x="226" y="166" width="60" height="180" rx="14" fill="#2563eb" />
    <rect x="166" y="226" width="180" height="60" rx="14" fill="#2563eb" />

    <!-- Center Pulse / Queue Accent (Subtle Spark/Heart in center of cross) -->
    <circle cx="256" cy="256" r="16" fill="#ffffff" />
  </g>
</svg>
`;

async function generate() {
  const standardSvg = Buffer.from(svgBadge(false));
  const maskableSvg = Buffer.from(svgBadge(true));

  // 1. icon-180.png (Apple touch icon)
  await sharp(standardSvg)
    .resize(180, 180)
    .png()
    .toFile(path.join(iconsDir, 'icon-180.png'));
  console.log('Generated icon-180.png');

  // 2. icon-192.png (PWA standard)
  await sharp(standardSvg)
    .resize(192, 192)
    .png()
    .toFile(path.join(iconsDir, 'icon-192.png'));
  console.log('Generated icon-192.png');

  // 3. icon-512.png (PWA standard)
  await sharp(standardSvg)
    .resize(512, 512)
    .png()
    .toFile(path.join(iconsDir, 'icon-512.png'));
  console.log('Generated icon-512.png');

  // 4. icon-512-maskable.png (PWA maskable)
  await sharp(maskableSvg)
    .resize(512, 512)
    .png()
    .toFile(path.join(iconsDir, 'icon-512-maskable.png'));
  console.log('Generated icon-512-maskable.png');

  console.log('All icons generated successfully.');
}

generate().catch((err) => {
  console.error('Failed to generate icons:', err);
  process.exit(1);
});
