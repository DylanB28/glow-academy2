import sharp from 'sharp';
import { existsSync, readFileSync, writeFileSync } from 'fs';

const ASSETS = 'assets';
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

const HTML_FILES = [
  'index.html',
  'about-us.html',
  'dashboard.html',
  'emerald-eden.html',
  'privacy.html',
  'ruby-rise.html',
  'sapphire-sanctuary.html',
  'sign-in.html',
  'signup.html',
  'support.html',
  'terms-and-conditions.html',
  'success.html',
];

async function generateImages() {
  for (const src of [`${ASSETS}/logo.png`, `${ASSETS}/favicon.png`]) {
    if (!existsSync(src)) throw new Error(`Source not found: ${src}`);
  }

  const jobs = [
    sharp(`${ASSETS}/logo.png`)
      .resize(96, 96, { fit: 'contain', background: TRANSPARENT })
      .webp({ quality: 85, effort: 6 })
      .toFile(`${ASSETS}/logo-96.webp`),
    sharp(`${ASSETS}/logo.png`)
      .resize(96, 96, { fit: 'contain', background: TRANSPARENT })
      .png({ compressionLevel: 9 })
      .toFile(`${ASSETS}/logo-96.png`),
    sharp(`${ASSETS}/logo.png`)
      .resize(600, 600, { fit: 'contain', background: TRANSPARENT })
      .png({ compressionLevel: 9 })
      .toFile(`${ASSETS}/logo-og.png`),
    sharp(`${ASSETS}/favicon.png`)
      .resize(32, 32, { fit: 'contain', background: TRANSPARENT })
      .png({ compressionLevel: 9 })
      .toFile(`${ASSETS}/favicon-32.png`),
    sharp(`${ASSETS}/favicon.png`)
      .resize(180, 180, { fit: 'contain', background: TRANSPARENT })
      .png({ compressionLevel: 9 })
      .toFile(`${ASSETS}/favicon-180.png`),
  ];

  console.log('Generating optimized images...');
  const results = await Promise.all(jobs);
  const labels = ['logo-96.webp', 'logo-96.png', 'logo-og.png', 'favicon-32.png', 'favicon-180.png'];
  results.forEach((info, i) =>
    console.log(`  ${labels[i].padEnd(20)} ${(info.size / 1024).toFixed(1)} KB`)
  );
}

function patchHTML() {
  console.log('\nPatching HTML files...');

  const LOGO_IMG_OLD = `<img src="assets/logo.png" alt="Gem Glow Academy logo" onerror="this.style.display='none'">`;
  const LOGO_IMG_NEW = `<picture>\n  <source srcset="assets/logo-96.webp" type="image/webp">\n  <img src="assets/logo-96.png" alt="Gem Glow Academy logo" width="85" height="85" onerror="this.style.display='none'">\n</picture>`;

  const FAVICON_OLD = `<link rel="icon" type="image/png" href="assets/favicon.png">`;
  const FAVICON_OLD_NO_TYPE = `<link rel="icon" href="assets/favicon.png">`;
  const FAVICON_NEW = `<link rel="icon" type="image/png" sizes="32x32" href="assets/favicon-32.png">\n<link rel="apple-touch-icon" sizes="180x180" href="assets/favicon-180.png">`;

  for (const file of HTML_FILES) {
    if (!existsSync(file)) {
      console.log(`  ${file.padEnd(35)} SKIPPED (not found)`);
      continue;
    }

    let html = readFileSync(file, 'utf8');
    let changes = [];

    // Op A: logo picture element
    if (html.includes(LOGO_IMG_OLD)) {
      html = html.replaceAll(LOGO_IMG_OLD, LOGO_IMG_NEW);
      changes.push('logo→<picture>');
    }

    // Op B: favicon links
    if (html.includes(FAVICON_OLD)) {
      html = html.replace(FAVICON_OLD, FAVICON_NEW);
      changes.push('favicon');
    } else if (html.includes(FAVICON_OLD_NO_TYPE)) {
      html = html.replace(FAVICON_OLD_NO_TYPE, FAVICON_NEW);
      changes.push('favicon');
    }

    // Op C: OG/Twitter meta image
    if (html.includes('/assets/logo.png')) {
      html = html.replaceAll('/assets/logo.png', '/assets/logo-og.png');
      changes.push('og:image');
    }

    writeFileSync(file, html, 'utf8');
    console.log(`  ${file.padEnd(35)} ${changes.length ? changes.join(', ') : 'no changes'}`);
  }
}

async function main() {
  await generateImages();
  patchHTML();
  console.log('\nDone.');
}

main().catch(err => { console.error(err); process.exit(1); });
