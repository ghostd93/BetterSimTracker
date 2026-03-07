import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const packagePath = path.join(root, "package.json");
const manifestPath = path.join(root, "manifest.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

const pkg = readJson(packagePath);
const manifest = readJson(manifestPath);

const packageVersion = String(pkg.version ?? "").trim();
const manifestVersion = String(manifest.version ?? "").trim();

if (!packageVersion || !manifestVersion) {
  console.error("[validate:versions] Missing version in package.json or manifest.json");
  process.exit(1);
}

if (packageVersion !== manifestVersion) {
  console.error("[validate:versions] Version mismatch");
  console.error(`- package.json:  ${packageVersion}`);
  console.error(`- manifest.json: ${manifestVersion}`);
  process.exit(1);
}

console.log(`[validate:versions] OK (${packageVersion})`);
