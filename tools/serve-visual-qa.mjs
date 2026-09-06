// Serve an explicitly instrumented static build, locally. Never a hosting server.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const root = resolve('dist/client');
const label = process.argv[2] || 'baseline';
if (!/^[a-z0-9-]+$/.test(label)) throw new Error('Use a simple result label');
const output = resolve('work/visual-qa', label);
await mkdir(output, { recursive: true });
const revision = execFileSync('git', ['rev-parse', 'HEAD'], {
  encoding: 'utf8',
}).trim();
// HEAD is the parent revision while validating an uncommitted stage. Hash the
// actual visual source and data as well, so that distinction stays explicit.
const visualFiles = [...new Set(execFileSync('git', [
  'ls-files', '-co', '--exclude-standard', '--', 'lib', 'app',
  'public/data', 'public/textures', 'package.json', 'package-lock.json', 'vite.config.ts',
], {encoding:'utf8'}).trim().split('\n'))].sort();
const digest = createHash('sha256');
for (const file of visualFiles) {
  digest.update(file + '\0');
  digest.update(await readFile(file));
}
const sourceFingerprint = digest.digest('hex');
const mime = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.geojson': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost:3100');
    if (req.method === 'POST' && url.pathname === '/__visual-qa') {
      if (
        req.headers.origin &&
        !/^http:\/\/(localhost|127\.0\.0\.1):3100$/.test(req.headers.origin)
      ) {
        res.writeHead(403);
        return res.end();
      }
      const chunks = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 24e6) throw new Error('Report too large');
        chunks.push(chunk);
      }
      const data = JSON.parse(Buffer.concat(chunks).toString());
      if (!/^[a-z0-9-]+$/.test(data.name))
        throw new Error('Invalid report name');
      await writeFile(
        resolve(output, data.name + '.json'),
        JSON.stringify({ revision, sourceFingerprint, ...data.row }, null, 2),
      );
      if (
        typeof data.screenshot === 'string' &&
        data.screenshot.startsWith('data:image/png;base64,')
      )
        await writeFile(
          resolve(output, data.name + '.png'),
          Buffer.from(data.screenshot.slice(22), 'base64'),
        );
      console.log(
        'Saved',
        data.name,
        data.row.fps ? Math.round(data.row.fps) + ' FPS' : '',
      );
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end('{"saved":true}');
    }
    let file = resolve(root, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(root + sep) && file !== root) {
      res.writeHead(403);
      return res.end();
    }
    if (file === root || (await stat(file).catch(() => null))?.isDirectory())
      file = resolve(file, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': mime[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}).listen(3100, '127.0.0.1', () =>
  console.log('Visual QA: http://localhost:3100/ → ' + output),
);
