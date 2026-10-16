const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: npm run qr -- <url> <out.svg>');
    console.error('Example: npm run qr -- http://localhost:5173/join/svc-123 qr.svg');
    process.exit(1);
  }

  const [url, outFile] = args;
  const outPath = path.resolve(process.cwd(), outFile);

  try {
    const svgString = await QRCode.toString(url, {
      type: 'svg',
      margin: 2,
      errorCorrectionLevel: 'H',
    });

    const dir = path.dirname(outPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(outPath, svgString, 'utf8');
    console.log(`✓ Wrote QR code for "${url}" to ${outPath}`);
  } catch (err) {
    console.error('Failed to generate QR SVG:', err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
