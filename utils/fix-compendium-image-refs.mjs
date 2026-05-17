import { ClassicLevel } from "classic-level";
import fs from "fs/promises";
import path from "path";

const workspace = process.cwd();
const reportPath = path.join(workspace, ".tmp", "compendium-image-audit", "image-report.checked.json");
const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
const missing = report.filter((finding) => finding.available === false);
const replacements = new Map();

for (const finding of missing) {
  if (!replacements.has(finding.value)) {
    const replacement = replacementFor(finding);
    replacements.set(finding.value, replacement);
    await ensureGeneratedAsset(replacement, finding);
  }
}

const system = JSON.parse(await fs.readFile(path.join(workspace, "system.json"), "utf8"));
const touchedPacks = new Set(missing.map((finding) => finding.pack));
let updatedDocuments = 0;
let updatedReferences = 0;

for (const pack of system.packs.filter((pack) => touchedPacks.has(pack.name))) {
  const packPath = path.resolve(workspace, pack.path);
  await normalizeCurrent(packPath);

  const db = new ClassicLevel(packPath, { keyEncoding: "utf8", valueEncoding: "json" });
  await db.open();

  for await (const [key, doc] of db.iterator()) {
    const counter = { count: 0 };
    const updated = replaceRefs(doc, counter);
    if (updated) {
      await db.put(key, doc);
      updatedDocuments += 1;
      updatedReferences += counter.count;
    }
  }

  await db.close();
}

const mappingPath = path.join(workspace, ".tmp", "compendium-image-audit", "image-replacements.json");
await fs.writeFile(mappingPath, `${JSON.stringify([...replacements.entries()].map(([from, to]) => ({ from, to })), null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  uniqueMissingRefs: replacements.size,
  updatedDocuments,
  updatedReferences,
  mappingPath,
}, null, 2));

function replaceRefs(value, counter) {
  if (typeof value !== "object" || value === null) return false;

  let changed = false;
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === "string" && replacements.has(child)) {
      value[key] = replacements.get(child);
      counter.count += 1;
      changed = true;
    } else if (typeof child === "object" && child !== null) {
      changed = replaceRefs(child, counter) || changed;
    }
  }
  return changed;
}

async function normalizeCurrent(packPath) {
  const currentPath = path.join(packPath, "CURRENT");
  const current = await fs.readFile(currentPath, "utf8");
  await fs.writeFile(currentPath, current.replace(/\r\n/g, "\n"), "utf8");
}

function replacementFor(finding) {
  const category = categoryFor(finding);
  const label = labelFor(finding);
  const slug = slugify(label);
  return `systems/thewitchertrpg/assets/images/generated/${category}/${slug}.svg`;
}

function categoryFor(finding) {
  const haystack = `${finding.value} ${finding.documentName} ${finding.field}`.toLowerCase();
  if (finding.documentType === "Scene" || haystack.includes("map")) return "scenes";
  if (haystack.includes("magic/symbol") || haystack.includes("sign") || haystack.includes("spell")) return "magic";
  if (haystack.includes("rune") || haystack.includes("glyph")) return "runes-glyphs";
  if (haystack.includes("profession")) return "professions";
  if (haystack.includes("race icons") || ["human", "dwarf", "witcher", "elf"].includes(finding.documentName.toLowerCase())) return "races";
  if (haystack.includes("transportation") || haystack.includes("saddle") || haystack.includes("wagon") || haystack.includes("ship")) return "transportation";
  if (haystack.includes("alchemy") || haystack.includes("potion") || haystack.includes("decoction") || haystack.includes("oil")) return "alchemy";
  if (haystack.includes("bestiary") || haystack.includes("tokenizer") || haystack.includes("tokens")) return "bestiary";
  if (haystack.includes("journal") || haystack.includes("monks-enhanced-journal")) return "journal";
  if (haystack.includes("medallion") || haystack.includes("armor")) return "witcher-gear";
  return "misc";
}

function labelFor(finding) {
  const decoded = decodeURIComponent(finding.value.split("?")[0]);
  const basename = decoded.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "");
  if (finding.documentName && !finding.documentName.startsWith("!")) return finding.documentName;
  return basename || "Replacement Image";
}

async function ensureGeneratedAsset(foundryPath, finding) {
  const relative = foundryPath.replace(/^systems\/thewitchertrpg\//, "");
  const filePath = path.resolve(workspace, relative);
  const relativeToWorkspace = path.relative(workspace, filePath);
  if (relativeToWorkspace.startsWith("..") || path.isAbsolute(relativeToWorkspace)) {
    throw new Error(`Refusing to write outside workspace: ${filePath}`);
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  try {
    await fs.access(filePath);
    return;
  } catch {
    const svg = svgFor(finding, foundryPath);
    await fs.writeFile(filePath, svg, "utf8");
  }
}

function svgFor(finding, foundryPath) {
  const category = foundryPath.split("/").at(-2);
  const label = escapeXml(labelFor(finding));
  const title = escapeXml(titleFor(category));
  const palette = paletteFor(category);
  const symbol = symbolFor(category, label);
  const isScene = category === "scenes";
  const width = isScene ? 1600 : 512;
  const height = isScene ? 1000 : 512;

  if (isScene) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="1600" height="1000" fill="#d4bd8c"/>
  <path d="M112 116 C352 40 424 180 592 138 C742 100 862 64 1014 154 C1174 250 1362 186 1488 316 C1370 420 1432 618 1250 690 C1056 766 976 914 744 844 C560 788 474 884 306 752 C150 630 266 438 112 330 Z" fill="#b9945d" stroke="#5f4326" stroke-width="16"/>
  <path d="M222 284 C390 210 530 286 642 242 M718 354 C906 282 1054 338 1220 278 M444 604 C650 524 846 628 1054 524" fill="none" stroke="#6f512f" stroke-width="10" stroke-linecap="round" opacity=".65"/>
  <g fill="#587454" opacity=".9">
    <circle cx="376" cy="374" r="26"/><circle cx="418" cy="404" r="18"/><circle cx="1010" cy="286" r="24"/><circle cx="1082" cy="320" r="20"/>
    <circle cx="712" cy="712" r="22"/><circle cx="760" cy="742" r="18"/>
  </g>
  <path d="M128 904 C420 810 744 946 1012 824 C1192 742 1340 794 1490 710" fill="none" stroke="#7f653f" stroke-width="6" stroke-dasharray="18 18" opacity=".75"/>
  <text x="800" y="112" text-anchor="middle" font-family="Georgia, serif" font-size="58" fill="#3f2b18">${label}</text>
  <text x="800" y="944" text-anchor="middle" font-family="Georgia, serif" font-size="28" fill="#5f4326">Generated fallback map</text>
</svg>
`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="bg" cx="42%" cy="30%" r="72%">
      <stop offset="0%" stop-color="${palette.light}"/>
      <stop offset="62%" stop-color="${palette.mid}"/>
      <stop offset="100%" stop-color="${palette.dark}"/>
    </radialGradient>
  </defs>
  <rect width="512" height="512" rx="44" fill="url(#bg)"/>
  <rect x="28" y="28" width="456" height="456" rx="34" fill="none" stroke="#f4ead4" stroke-width="10" opacity=".5"/>
  ${symbol}
  <text x="256" y="410" text-anchor="middle" font-family="Georgia, serif" font-size="34" font-weight="700" fill="#fff3d6">${title}</text>
  <text x="256" y="452" text-anchor="middle" font-family="Georgia, serif" font-size="24" fill="#f6e8c8">${label}</text>
</svg>
`;
}

function titleFor(category) {
  return {
    "alchemy": "Alchemy",
    "bestiary": "Bestiary",
    "journal": "Journal",
    "magic": "Magic",
    "misc": "Witcher TRPG",
    "professions": "Profession",
    "races": "Race",
    "runes-glyphs": "Rune",
    "transportation": "Travel",
    "witcher-gear": "Gear",
  }[category] || "Witcher TRPG";
}

function paletteFor(category) {
  return {
    "alchemy": { light: "#7fb069", mid: "#315c3b", dark: "#17261f" },
    "bestiary": { light: "#8a6f55", mid: "#533a2f", dark: "#211816" },
    "journal": { light: "#d9c28e", mid: "#8b6a3c", dark: "#392819" },
    "magic": { light: "#5fb6c8", mid: "#24647b", dark: "#102733" },
    "professions": { light: "#c79f55", mid: "#7c4b28", dark: "#2d1b13" },
    "races": { light: "#9aa879", mid: "#5a6c4a", dark: "#202719" },
    "runes-glyphs": { light: "#b9d5d8", mid: "#47747d", dark: "#172d34" },
    "transportation": { light: "#c19b6b", mid: "#6b4b2f", dark: "#281c13" },
    "witcher-gear": { light: "#b6b7ad", mid: "#666b67", dark: "#222625" },
  }[category] || { light: "#9c8b78", mid: "#594638", dark: "#211a16" };
}

function symbolFor(category, label) {
  if (category === "alchemy") return `<path d="M206 92h100v40l-26 22v76l82 134c36 58-6 132-74 132h-64c-68 0-110-74-74-132l82-134v-76l-26-22z" fill="#f8f0d8" opacity=".9"/><path d="M178 368h156l30 50c18 31-3 70-39 70H187c-36 0-57-39-39-70z" fill="#73b67a"/>`;
  if (category === "bestiary") return `<path d="M256 66c86 0 156 70 156 156 0 42-18 82-48 112l-34-34c20-21 31-49 31-78 0-58-47-105-105-105s-105 47-105 105c0 29 12 57 31 78l-34 34c-30-30-48-70-48-112 0-86 70-156 156-156z" fill="#f8f0d8"/><path d="M196 292h120l38 132H158z" fill="#d2b789"/><circle cx="214" cy="218" r="18" fill="#211816"/><circle cx="298" cy="218" r="18" fill="#211816"/>`;
  if (category === "journal") return `<path d="M148 82h232c18 0 32 14 32 32v310c0 18-14 32-32 32H148c-26 0-48-22-48-48V130c0-26 22-48 48-48z" fill="#f8f0d8"/><path d="M156 126h202M156 178h202M156 230h150M156 282h188" stroke="#6b4b2f" stroke-width="18" stroke-linecap="round"/>`;
  if (category === "magic") return `<circle cx="256" cy="254" r="150" fill="none" stroke="#f8f0d8" stroke-width="18"/><path d="M256 86l52 116 126 14-94 86 26 124-110-64-110 64 26-124-94-86 126-14z" fill="#f8f0d8" opacity=".86"/>`;
  if (category === "professions") return `<path d="M256 64l148 78v96c0 98-60 169-148 210-88-41-148-112-148-210v-96z" fill="#f8f0d8"/><path d="M182 260h148M214 198h84M214 322h84" stroke="#7c4b28" stroke-width="28" stroke-linecap="round"/>`;
  if (category === "races") return `<circle cx="256" cy="164" r="82" fill="#f8f0d8"/><path d="M116 442c22-96 78-148 140-148s118 52 140 148z" fill="#f8f0d8"/><path d="M138 166l-54-42 74-8M374 166l54-42-74-8" fill="none" stroke="#f8f0d8" stroke-width="22" stroke-linecap="round" stroke-linejoin="round"/>`;
  if (category === "runes-glyphs") return `<path d="M256 56l166 96v192l-166 96-166-96V152z" fill="none" stroke="#f8f0d8" stroke-width="22"/><path d="M256 120v272M178 198l78-78 78 78M178 314l78 78 78-78" fill="none" stroke="#f8f0d8" stroke-width="24" stroke-linecap="round" stroke-linejoin="round"/>`;
  if (category === "transportation") return `<path d="M100 300h270l46 76H78z" fill="#f8f0d8"/><path d="M154 300l64-108h122l30 108" fill="none" stroke="#f8f0d8" stroke-width="24" stroke-linejoin="round"/><circle cx="168" cy="392" r="42" fill="#281c13" stroke="#f8f0d8" stroke-width="18"/><circle cx="342" cy="392" r="42" fill="#281c13" stroke="#f8f0d8" stroke-width="18"/>`;
  if (category === "witcher-gear") return `<path d="M256 70l62 70 92 12-46 82 16 94-88-38-36 86-36-86-88 38 16-94-46-82 92-12z" fill="#f8f0d8"/><circle cx="256" cy="256" r="52" fill="#222625"/>`;
  return `<circle cx="256" cy="214" r="120" fill="#f8f0d8"/><path d="M144 354h224v58H144z" fill="#f8f0d8"/>`;
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "replacement";
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
