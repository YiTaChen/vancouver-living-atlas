import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Hash the exact generated hydration payload; do not allow arbitrary inline JS. */
export function inlineScriptHashes(html) {
  const hashes = new Set();
  for (const [, attributes, body] of html.matchAll(
    /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi,
  )) {
    if (/\bsrc\s*=/i.test(attributes)) {
      const source = attributes.match(/\bsrc\s*=\s*["']([^"']*)["']/i)?.[1];
      assert(source?.startsWith('/') && !source.startsWith('//'),
        'Production scripts must use same-origin absolute paths');
      continue;
    }
    if (body.trim()) {
      hashes.add(`'sha256-${createHash('sha256').update(body).digest('base64')}'`);
    }
  }
  return [...hashes].sort();
}

export function contentSecurityPolicy(hashes) {
  assert(hashes.every((hash) => /^'sha256-[A-Za-z0-9+/]{43}='$/.test(hash)),
    'CSP only accepts SHA-256 script hashes');
  return [
    "default-src 'self'",
    `script-src 'self' ${hashes.join(' ')}`.trim(),
    "script-src-attr 'none'",
    // React and Three use dynamic style attributes. Script policy stays strict.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
}

export async function prepareFirebaseHosting({
  root = path.resolve('dist/client'),
  configPath = path.resolve('firebase.json'),
  outputPath = path.resolve('firebase.generated.json'),
} = {}) {
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  assert.equal(config.hosting.public, 'dist/client',
    'Firebase may only publish the verified static client');
  const files = await readdir(root, { recursive: true });
  const pages = files.filter((file) => file.endsWith('.html'));
  assert(pages.includes('index.html'), 'Build must contain the home page');
  const hashes = new Set();
  for (const page of pages) {
    for (const hash of inlineScriptHashes(await readFile(path.join(root, page), 'utf8'))) {
      hashes.add(hash);
    }
  }
  const policy = contentSecurityPolicy([...hashes].sort());
  // Appended last so a future source-level CSP cannot weaken this build policy.
  config.hosting.headers.push({
    source: '**',
    headers: [{ key: 'Content-Security-Policy', value: policy }],
  });
  await writeFile(outputPath, `${JSON.stringify(config, null, 2)}\n`);
  return { pages: pages.length, scriptHashes: hashes.size, outputPath };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log('Firebase CSP prepared:', await prepareFirebaseHosting());
}
