#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const nextVersion = process.argv[2];
if (!nextVersion) {
  console.error("Usage: pnpm version:sync <version>");
  process.exit(1);
}

if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(nextVersion)) {
  console.error(`Invalid version: ${nextVersion}`);
  process.exit(1);
}

const root = resolve(process.cwd());
const files = [
  {
    path: resolve(root, "package.json"),
    update: (text) =>
      text.replace(/("version"\s*:\s*")([^"]+)(")/, `$1${nextVersion}$3`),
  },
  {
    path: resolve(root, "src-tauri", "Cargo.toml"),
    update: (text) =>
      text.replace(/(^version\s*=\s*")([^"]+)("$)/m, `$1${nextVersion}$3`),
  },
  {
    path: resolve(root, "src-tauri", "tauri.conf.json"),
    update: (text) =>
      text.replace(/("version"\s*:\s*")([^"]+)(")/, `$1${nextVersion}$3`),
  },
  {
    path: resolve(root, ".github", "workflows", "main.yml"),
    update: (text) =>
      text
        .replace(
          /(description: Release tag, for example v)([0-9A-Za-z.-]+)/,
          `$1${nextVersion}`,
        )
        .replace(/(default: v)([0-9A-Za-z.-]+)/, `$1${nextVersion}`),
  },
  {
    path: resolve(root, "README.md"),
    update: (text) =>
      text
        .replace(/git tag v([0-9A-Za-z.-]+)/g, `git tag v${nextVersion}`)
        .replace(
          /git push origin v([0-9A-Za-z.-]+)/g,
          `git push origin v${nextVersion}`,
        ),
  },
];

for (const file of files) {
  const input = readFileSync(file.path, "utf8");
  const output = file.update(input);
  if (output === input) {
    continue;
  }
  writeFileSync(file.path, output);
}

console.log(`Synced version to ${nextVersion}`);
