import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const failures = [];
const warnings = [];
const walk = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  if (entry.name === 'node_modules' || entry.name === '.git') return [];
  const full = path.join(directory, entry.name);
  return entry.isDirectory() ? walk(full) : [full];
});
const files = walk(root);
const htmlFiles = files.filter(file => file.endsWith('.html'));
const jsFiles = files.filter(file => file.endsWith('.js') || file.endsWith('.mjs'));

for (const file of jsFiles) {
  try { execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' }); }
  catch (error) { failures.push(`JavaScript syntax: ${path.relative(root, file)}\n${error.stderr?.toString() || error.message}`); }
}

const external = /^(?:[a-z]+:|\/\/|#|mailto:|tel:|javascript:|data:)/i;
for (const file of htmlFiles) {
  const source = fs.readFileSync(file, 'utf8');
  const relative = path.relative(root, file);
  const scriptMatches = [...source.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
  scriptMatches.forEach((match, index) => {
    const temp = path.join('/tmp', `gga-${path.basename(file)}-${index}.js`);
    fs.writeFileSync(temp, match[1]);
    try { execFileSync(process.execPath, ['--check', temp], { stdio: 'pipe' }); }
    catch (error) { failures.push(`Inline JavaScript syntax: ${relative} script ${index + 1}\n${error.stderr?.toString() || error.message}`); }
  });

  for (const match of source.matchAll(/\b(?:href|src)=["']([^"']+)["']/gi)) {
    const value = match[1].split('?')[0].split('#')[0];
    if (!value || external.test(value) || value.startsWith('/api/') || value.includes('${')) continue;
    const target = value.startsWith('/') ? path.resolve(root, value.slice(1)) : path.resolve(path.dirname(file), value);
    if (!fs.existsSync(target)) failures.push(`Missing local asset from ${relative}: ${match[1]}`);
  }

  if (/dashboard\.html|profile\.html|palace\.html|child-login\.html|success\.html/.test(relative) && !/noindex/i.test(source)) {
    failures.push(`Protected/account page is missing noindex: ${relative}`);
  }
  if (/googletagmanager\.com\/gtag/.test(source) && /dashboard|palace|child-login|emerald|sapphire|ruby/.test(relative)) {
    failures.push(`Child/account page loads behavioural analytics: ${relative}`);
  }
}

const sqlPath = path.join(root, 'supabase/migrations/001_production_foundation.sql');
if (!fs.existsSync(sqlPath)) failures.push('Missing production SQL migration.');
else {
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const itemSection = sql.match(/insert into public\.reward_items[\s\S]*?on conflict\(item_key\)/i)?.[0] || '';
  const itemCount = (itemSection.match(/^\s*\('/gm) || []).length;
  if (itemCount !== 100) failures.push(`Reward catalogue must contain exactly 100 items; found ${itemCount}.`);
  for (const required of ['complete_child_activity', 'purchase_reward_item', 'save_child_palace', 'rotate_child_pin']) {
    if (!sql.includes(`function public.${required}`)) failures.push(`SQL function missing: ${required}`);
  }
}

const forbidden = [
  ['client-side Stripe price IDs', /\bprice_[A-Za-z0-9]{14,}\b/g, files.filter(f => f.endsWith('.html') || f.includes('/assets/'))],
  ['service-role key', /service_role|SUPABASE_SERVICE_ROLE_KEY\s*=\s*eyJ/gi, files.filter(f => f.endsWith('.html') || f.includes('/assets/'))]
];
for (const [label, pattern, targets] of forbidden) for (const file of targets) {
  const text = fs.readFileSync(file, 'utf8');
  if (pattern.test(text)) failures.push(`Possible ${label} exposed in ${path.relative(root, file)}.`);
  pattern.lastIndex = 0;
}

const audioBytes = files.filter(file => /assets[\\/]audio/.test(file)).reduce((total, file) => total + fs.statSync(file).size, 0);
if (audioBytes > 40 * 1024 * 1024) warnings.push(`Audio payload is ${(audioBytes / 1024 / 1024).toFixed(1)} MB. Move large audio to optimised object storage/CDN before high-scale launch.`);

if (failures.length) {
  console.error(`\nValidation failed (${failures.length}):\n- ${failures.join('\n- ')}\n`);
  process.exit(1);
}
console.log(`Validation passed: ${htmlFiles.length} HTML files, ${jsFiles.length} JavaScript files, 100 palace items.`);
if (warnings.length) console.warn(`Warnings:\n- ${warnings.join('\n- ')}`);
