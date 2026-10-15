import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const svg = `
<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#080F14" />
      <stop offset="100%" stop-color="#0D1A22" />
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="1200" height="630" fill="url(#bg)" />

  <!-- Subtle grid dots -->
  <g opacity="0.08" fill="#F2F5F6">
    ${Array.from({ length: 24 })
      .map((_, i) =>
        Array.from({ length: 12 })
          .map(
            (_, j) =>
              `<circle cx="${50 * (i + 1)}" cy="${50 * (j + 1)}" r="1.5" />`
          )
          .join('')
      )
      .join('')}
  </g>

  <!-- Brand Wordmark -->
  <g transform="translate(100, 120)">
    <circle cx="16" cy="16" r="10" fill="#0B8A7C" />
    <text x="42" y="25" font-family="system-ui, -apple-system, sans-serif" font-size="36" font-weight="700" fill="#F2F5F6" letter-spacing="-0.02em">
      SmartQueue
    </text>
  </g>

  <!-- Headline & Subtitle -->
  <text x="100" y="260" font-family="system-ui, -apple-system, sans-serif" font-size="56" font-weight="800" fill="#FFFFFF" letter-spacing="-0.03em">
    Hospital queues without
  </text>
  <text x="100" y="330" font-family="system-ui, -apple-system, sans-serif" font-size="56" font-weight="800" fill="#0B8A7C" letter-spacing="-0.03em">
    the waiting room.
  </text>
  <text x="100" y="400" font-family="system-ui, -apple-system, sans-serif" font-size="24" font-weight="400" fill="#889CA6">
    Real-time token tracking, live status notifications, and one-tap consultation desk flow.
  </text>

  <!-- Ticket Graphic on Right -->
  <g transform="translate(800, 140)">
    <!-- Ticket Shadow -->
    <rect x="8" y="8" width="300" height="360" rx="16" fill="#000000" opacity="0.4" />
    <!-- Ticket Base -->
    <rect x="0" y="0" width="300" height="360" rx="16" fill="#142028" stroke="#263A46" stroke-width="2" />
    
    <!-- Ticket Header -->
    <text x="24" y="44" font-family="system-ui, -apple-system, sans-serif" font-size="14" font-weight="700" fill="#0B8A7C" letter-spacing="0.05em">
      GENERAL OPD
    </text>
    <text x="24" y="66" font-family="system-ui, -apple-system, sans-serif" font-size="12" fill="#889CA6">
      City Hospital
    </text>

    <!-- Perforation Line -->
    <line x1="20" y1="95" x2="280" y2="95" stroke="#263A46" stroke-width="2" stroke-dasharray="6 6" />

    <!-- Big Token Number -->
    <text x="150" y="200" font-family="monospace, monospace" font-size="72" font-weight="900" fill="#FFB224" text-anchor="middle">
      #42
    </text>

    <!-- Status -->
    <rect x="75" y="240" width="150" height="36" rx="18" fill="#FFB224" fill-opacity="0.15" stroke="#FFB224" stroke-opacity="0.3" stroke-width="1" />
    <text x="150" y="264" font-family="system-ui, -apple-system, sans-serif" font-size="14" font-weight="700" fill="#FFB224" text-anchor="middle">
      YOUR TURN
    </text>

    <text x="150" y="315" font-family="system-ui, -apple-system, sans-serif" font-size="14" font-weight="500" fill="#F2F5F6" text-anchor="middle">
      Please proceed to Counter 1
    </text>
  </g>
</svg>
`;

async function run() {
  const outDir = path.resolve(__dirname, '../public');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const outPath = path.join(outDir, 'og-image.png');
  await sharp(Buffer.from(svg))
    .png()
    .toFile(outPath);

  console.log(`Generated OG image: ${outPath} (1200x630)`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
