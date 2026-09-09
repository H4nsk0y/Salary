import { cp, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(projectRoot, "www");
const copiedDirectories = ["fonts", "images", "styles", "vendor"];
const copiedRootExtensions = new Set([".html", ".js", ".webmanifest", ".ico"]);
const copiedRootNames = new Set([".nojekyll"]);

function assertSafeOutputPath() {
  const relative = path.relative(projectRoot, outputDir);
  if (relative !== "www" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Unsafe mobile output path: ${outputDir}`);
  }
}

assertSafeOutputPath();
await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

const rootEntries = await readdir(projectRoot, { withFileTypes: true });
const rootFiles = rootEntries
  .filter((entry) => entry.isFile())
  .filter((entry) => copiedRootNames.has(entry.name) || copiedRootExtensions.has(path.extname(entry.name)))
  .map((entry) => entry.name);

for (const fileName of rootFiles) {
  await cp(path.join(projectRoot, fileName), path.join(outputDir, fileName));
}

for (const directoryName of copiedDirectories) {
  await cp(path.join(projectRoot, directoryName), path.join(outputDir, directoryName), {
    recursive: true,
  });
}

console.log(
  `Mobile web bundle ready: ${rootFiles.length} root files and ${copiedDirectories.length} asset directories copied to www.`,
);
