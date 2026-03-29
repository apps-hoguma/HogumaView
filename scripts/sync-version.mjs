import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const appName = "hogumaview";

function resolveProjectPath(relPath) {
  return path.join(projectRoot, relPath);
}

function readTextFile(relPath) {
  return fs.readFileSync(resolveProjectPath(relPath), "utf8");
}

function writeTextFileIfChanged(relPath, content) {
  const absPath = resolveProjectPath(relPath);
  const previous = fs.readFileSync(absPath, "utf8");
  if (previous !== content) {
    fs.writeFileSync(absPath, content, "utf8");
  }
}

function readJsonFile(relPath) {
  return JSON.parse(readTextFile(relPath));
}

function getSourceVersion() {
  const pkg = readJsonFile("package.json");
  const version = typeof pkg.version === "string" ? pkg.version.trim() : "";
  if (!version) {
    throw new Error("package.json version is missing");
  }
  return version;
}

function syncPackageLock(version) {
  const relPath = "package-lock.json";
  if (!fs.existsSync(resolveProjectPath(relPath))) {
    return;
  }
  const lock = readJsonFile(relPath);
  lock.version = version;
  if (lock.packages && lock.packages[""]) {
    lock.packages[""].version = version;
  }
  writeTextFileIfChanged(relPath, `${JSON.stringify(lock, null, 2)}\n`);
}

function replaceFirstOrThrow(content, pattern, replacement, fileLabel) {
  if (!pattern.test(content)) {
    throw new Error(`failed to update version in ${fileLabel}`);
  }
  pattern.lastIndex = 0;
  return content.replace(pattern, replacement);
}

function syncCargoToml(version) {
  const relPath = "src-tauri/Cargo.toml";
  const content = readTextFile(relPath);
  const next = replaceFirstOrThrow(
    content,
    /(\[package\][\s\S]*?\r?\nversion\s*=\s*")([^"]+)(")/,
    `$1${version}$3`,
    relPath,
  );
  writeTextFileIfChanged(relPath, next);
}

function syncTauriConf(version) {
  const relPath = "src-tauri/tauri.conf.json";
  const content = readTextFile(relPath);
  const next = replaceFirstOrThrow(
    content,
    /("version"\s*:\s*")([^"]+)(")/,
    `$1${version}$3`,
    relPath,
  );
  writeTextFileIfChanged(relPath, next);
}

function syncCargoLock(version) {
  const relPath = "src-tauri/Cargo.lock";
  if (!fs.existsSync(resolveProjectPath(relPath))) {
    return;
  }
  const content = readTextFile(relPath);
  const next = replaceFirstOrThrow(
    content,
    /(\[\[package\]\]\r?\nname = "hogumaview"\r?\nversion = ")([^"]+)(")/,
    `$1${version}$3`,
    relPath,
  );
  writeTextFileIfChanged(relPath, next);
}

function main() {
  const version = getSourceVersion();
  syncPackageLock(version);
  syncCargoToml(version);
  syncTauriConf(version);
  syncCargoLock(version);
  console.log(`synced ${appName} version to ${version}`);
}

main();
