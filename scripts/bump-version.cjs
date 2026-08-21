#!/usr/bin/env node
/**
 * Bumps the version across package.json, src-tauri/tauri.conf.json,
 * src-tauri/Cargo.toml, and core/Cargo.toml in a single pass.
 *
 * Usage:  node scripts/bump-version.cjs 0.2.0
 *   or:   npm run bump -- 0.2.0
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[\w.]+)?$/;

const newVersion = process.argv[2];
if (!newVersion || !SEMVER_RE.test(newVersion)) {
  console.error("Usage: node scripts/bump-version.cjs <semver>");
  console.error('  e.g. node scripts/bump-version.cjs 0.2.0  (or "0.2.0-beta.1")');
  process.exit(1);
}

// ── package.json ──────────────────────────────────────────────────────
const pkgPath = path.resolve("package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
pkg.version = newVersion;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
console.log(`  package.json          → ${newVersion}`);

// ── tauri.conf.json ──────────────────────────────────────────────────
const tauriPath = path.resolve("src-tauri/tauri.conf.json");
const tauri = JSON.parse(fs.readFileSync(tauriPath, "utf8"));
tauri.version = newVersion;
fs.writeFileSync(tauriPath, JSON.stringify(tauri, null, 2) + "\n");
console.log(`  tauri.conf.json       → ${newVersion}`);

// ── Cargo.toml files (anchored to the [package] section) ─────────────
for (const rel of ["src-tauri/Cargo.toml", "core/Cargo.toml"]) {
  const cargoPath = path.resolve(rel);
  let cargo = fs.readFileSync(cargoPath, "utf8");
  const pkgSection = cargo.indexOf("[package]");
  const nextSection = cargo.indexOf("\n[", pkgSection + 1);
  const sectionEnd = nextSection === -1 ? cargo.length : nextSection;
  const head = cargo.slice(0, pkgSection);
  const body = cargo.slice(pkgSection, sectionEnd);
  const tail = cargo.slice(sectionEnd);
  if (!/^version = "[^"]+"/m.test(body)) {
    console.error(`  ERROR: no version key found in ${rel} [package] section`);
    process.exit(1);
  }
  cargo = head + body.replace(/^version = "[^"]+"/m, `version = "${newVersion}"`) + tail;
  fs.writeFileSync(cargoPath, cargo);
  console.log(`  ${rel.padEnd(22)}→ ${newVersion}`);
}

// ── Refresh Cargo.lock so it doesn't go stale ────────────────────────
try {
  execSync("cargo update -p auto-dm -p auto-dm-core", { stdio: "pipe" });
  console.log("  Cargo.lock            → refreshed");
} catch {
  console.warn("  WARN: could not refresh Cargo.lock (run `cargo update -p auto-dm -p auto-dm-core` after next build)");
}

console.log(`\nAll configuration files synchronized to v${newVersion}`);
