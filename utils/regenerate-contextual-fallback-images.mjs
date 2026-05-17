import fs from "fs/promises";
import path from "path";

const root = path.resolve("assets/images/generated");
const files = await listFiles(root, ".webp");

if (files.length === 0) {
  throw new Error(`No curated WebP replacements found in ${root}`);
}

const invalid = [];
for (const file of files) {
  const data = await fs.readFile(file);
  if (data.length < 12 || data.subarray(0, 4).toString("ascii") !== "RIFF" || data.subarray(8, 12).toString("ascii") !== "WEBP") {
    invalid.push(path.relative(process.cwd(), file));
  }
}

if (invalid.length > 0) {
  throw new Error(`Invalid WebP replacements:\n${invalid.join("\n")}`);
}

console.log(JSON.stringify({
  verified: files.length,
  root,
  note: "These curated images are intentionally not regenerated from generic SVG templates.",
}, null, 2));

async function listFiles(directory, extension) {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(fullPath, extension));
    else if (entry.isFile() && entry.name.endsWith(extension)) files.push(fullPath);
  }
  return files;
}
