#!/usr/bin/env node
/**
 * Bumps the version across package.json, src-tauri/Cargo.toml, and
 * src-tauri/tauri.conf.json in a single pass.
 *
 * Usage:  node scripts/bump-version.cjs 0.2.0
 */
const fs = require("fs");
const path = require("path");

const newVersion = process.argv[2];
if (!newVersion) {
  console.error("Usage: node scripts/bump-version.cjs <version>");
  console.error("  e.g. node scripts/bump-version.cjs 0.2.0");
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

// ── Cargo.toml ───────────────────────────────────────────────────────
const cargoPath = path.resolve("src-tauri/Cargo.toml");
let cargo = fs.readFileSync(cargoPath, "utf8");
cargo = cargo.replace(/^version = "[^"]+"/m, `version = "${newVersion}"`);
fs.writeFileSync(cargoPath, cargo);
console.log(`  Cargo.toml            → ${newVersion}`);

console.log(`\nAll configuration files synchronized to v${newVersion}`);
