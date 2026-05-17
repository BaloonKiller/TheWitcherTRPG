import fs from "fs/promises";
import path from "path";

const workspace = process.cwd();
const englishPath = path.join(workspace, "lang", "en.json");
const polishPath = path.join(workspace, "lang", "pl.json");
const english = JSON.parse(await fs.readFile(englishPath, "utf8"));
const polish = JSON.parse(await fs.readFile(polishPath, "utf8"));
const synchronized = {};
const added = [];

for (const [key, value] of Object.entries(english)) {
  if (Object.hasOwn(polish, key)) synchronized[key] = polish[key];
  else {
    synchronized[key] = value;
    added.push(key);
  }
}

for (const [key, value] of Object.entries(polish)) {
  if (!Object.hasOwn(synchronized, key)) synchronized[key] = value;
}

await fs.writeFile(polishPath, `${JSON.stringify(synchronized, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ english: Object.keys(english).length, polish: Object.keys(synchronized).length, added }, null, 2));
