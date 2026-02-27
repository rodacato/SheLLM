const sharp = require('sharp');
const path = require('path');

const ASSETS = path.join(__dirname, 'assets');

const DARK_BG = { r: 26, g: 30, b: 33, alpha: 1 };
const LIGHT_BG = { r: 240, g: 244, b: 247, alpha: 1 };

async function generate() {
  // ── Favicons (dark) from logo-icon-color.png ──
  const iconColorBuf = await sharp(path.join(ASSETS, 'logo-icon-color.png'))
    .trim({ threshold: 15 })
    .png()
    .toBuffer();

  for (const size of [16, 32, 48, 64, 128, 180, 192, 256, 512]) {
    await sharp(iconColorBuf)
      .resize(size, size, { fit: 'contain', background: DARK_BG })
      .png()
      .toFile(path.join(ASSETS, `favicon-dark-${size}.png`));
    console.log(`  favicon-dark-${size}.png`);
  }

  // ── Favicons (light) from logo-icon-mono.png ──
  const iconMonoBuf = await sharp(path.join(ASSETS, 'logo-icon-mono.png'))
    .trim({ threshold: 15 })
    .png()
    .toBuffer();

  for (const size of [16, 32, 48, 64, 128, 180, 192, 256, 512]) {
    await sharp(iconMonoBuf)
      .resize(size, size, { fit: 'contain', background: LIGHT_BG })
      .png()
      .toFile(path.join(ASSETS, `favicon-light-${size}.png`));
    console.log(`  favicon-light-${size}.png`);
  }

  // ── Print final inventory ──
  const fs = require('fs');
  const all = fs.readdirSync(ASSETS).filter(f => f.endsWith('.png')).sort();
  console.log('\n--- Asset inventory ---');
  for (const f of all) {
    const m = await sharp(path.join(ASSETS, f)).metadata();
    const stat = fs.statSync(path.join(ASSETS, f));
    const kb = (stat.size / 1024).toFixed(1);
    console.log(`  ${f}: ${m.width}×${m.height} (${kb} KB)`);
  }
  console.log('\nDone!');
}

generate().catch(console.error);
