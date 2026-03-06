import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const changelogPath = path.join(root, "CHANGELOG.md");
const distPath = path.join(root, "dist", "index.js");
const args = new Set(process.argv.slice(2));

const versionsCheck = spawnSync(process.execPath, [path.join(root, "scripts", "validate-versions.mjs")], {
  stdio: "inherit",
});
if ((versionsCheck.status ?? 1) !== 0) {
  process.exit(versionsCheck.status ?? 1);
}

if (!fs.existsSync(distPath)) {
  console.error("[validate:release] dist/index.js is missing. Run npm run build.");
  process.exit(1);
}

if (!fs.existsSync(changelogPath)) {
  console.error("[validate:release] CHANGELOG.md is missing.");
  process.exit(1);
}

if (args.has("--main")) {
  const changelog = fs.readFileSync(changelogPath, "utf8");
  if (/\[\d+\.\d+\.\d+(?:\.\d+)?-dev\d+\]/i.test(changelog)) {
    console.error("[validate:release] Found -dev entries in CHANGELOG.md while validating main release.");
    process.exit(1);
  }
}

console.log("[validate:release] OK");
