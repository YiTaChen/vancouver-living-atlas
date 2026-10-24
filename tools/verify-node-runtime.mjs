import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const NODE_ENGINE_RANGE = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).engines.node;

const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const isStableVersion = (value) => typeof value === 'string' &&
  value.trim() === value && stableVersion.test(value) &&
  value.split('.').every((part) => Number.isSafeInteger(Number(part)));

/** Deliberately accept only the stable caret-major ranges used by this project. */
export function isSupportedNodeVersion(version, engineRange = NODE_ENGINE_RANGE) {
  if (!isStableVersion(version)) return false;
  if (typeof engineRange !== 'string') return false;
  const clauses = engineRange.split('||').map((part) => part.trim());
  // Unknown or broadened engine syntax requires an explicit guard review.
  if (!clauses.length || clauses.some((part) =>
    !part.startsWith('^') || !isStableVersion(part.slice(1)) ||
    Number(part.slice(1).split('.')[0]) === 0
  )) return false;
  const [major, minor, patch] = version.split('.').map(Number);
  return clauses.some((part) => {
    const [allowedMajor, minMinor, minPatch] = part.slice(1).split('.').map(Number);
    return major === allowedMajor &&
      (minor > minMinor || (minor === minMinor && patch >= minPatch));
  });
}

export function verifyNodeRuntime() {
  // Environment variables and npm's advertised target are not execution proof.
  const version = process.versions.node;
  if (!isSupportedNodeVersion(version)) {
    throw new Error(
      `Unsupported Node.js runtime ${version}. Required: ${NODE_ENGINE_RANGE}. ` +
      'Run nvm use or select an official patched Node 22/24 binary before retrying.',
    );
  }
}

if (process.argv[1] &&
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    verifyNodeRuntime();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
