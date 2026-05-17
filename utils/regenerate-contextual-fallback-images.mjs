import fs from "fs/promises";
import path from "path";

const root = path.resolve("assets/images/generated");
const files = await listSvgFiles(root);

for (const file of files) {
  const category = path.basename(path.dirname(file));
  const slug = path.basename(file, ".svg");
  const label = titleCase(slug);
  await fs.writeFile(file, renderAsset({ category, slug, label }), "utf8");
}

console.log(JSON.stringify({ regenerated: files.length, root }, null, 2));

async function listSvgFiles(dir) {
  const files = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await listSvgFiles(fullPath));
    else if (entry.isFile() && entry.name.endsWith(".svg")) files.push(fullPath);
  }
  return files;
}

function renderAsset(asset) {
  if (asset.category === "scenes") return renderMap(asset);

  const palette = paletteFor(asset);
  const motif = motifFor(asset);
  const label = escapeXml(asset.label);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="bg" cx="42%" cy="28%" r="76%">
      <stop offset="0%" stop-color="${palette.light}"/>
      <stop offset="58%" stop-color="${palette.mid}"/>
      <stop offset="100%" stop-color="${palette.dark}"/>
    </radialGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="10" stdDeviation="10" flood-color="#000" flood-opacity=".36"/>
    </filter>
  </defs>
  <rect width="512" height="512" rx="42" fill="url(#bg)"/>
  <path d="M42 78c70-38 142-52 214-42 82 12 154 48 214 104v294H42z" fill="#fff" opacity=".06"/>
  <rect x="26" y="26" width="460" height="460" rx="34" fill="none" stroke="#f4ead4" stroke-width="8" opacity=".48"/>
  <g filter="url(#shadow)">${motif}</g>
  <rect x="58" y="398" width="396" height="66" rx="12" fill="#120f0c" opacity=".55"/>
  <text x="256" y="439" text-anchor="middle" font-family="Georgia, serif" font-size="${fontSize(asset.label)}" font-weight="700" fill="#fff0d2">${label}</text>
</svg>
`;
}

function renderMap(asset) {
  const label = escapeXml(asset.label);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000">
  <rect width="1600" height="1000" fill="#d6c091"/>
  <rect x="26" y="26" width="1548" height="948" fill="none" stroke="#6f4d2c" stroke-width="18"/>
  <path d="M238 192c118-92 250-96 364-42 82 40 140-30 246-24 112 6 174 94 286 86 118-8 214 56 250 166-92 68-80 178-154 242-92 80-222 42-314 112-110 84-242 100-364 28-96-58-190 14-294-44-94-52-112-166-56-264 46-78-52-158 40-260z" fill="#b6925f" stroke="#56391f" stroke-width="14"/>
  <path d="M330 318c74-42 150-38 228-8M716 292c106-46 222-34 330 26M482 604c128-64 256-26 374-74M930 704c98-72 196-72 294-18" fill="none" stroke="#654726" stroke-width="9" stroke-linecap="round"/>
  <path d="M180 862c204-80 354-20 522-62 160-40 250-136 430-118 120 12 198-36 304-82" fill="none" stroke="#745936" stroke-width="7" stroke-dasharray="20 18" opacity=".8"/>
  <g fill="#516f50" stroke="#2f422f" stroke-width="5">
    <circle cx="410" cy="408" r="28"/><circle cx="452" cy="436" r="22"/><circle cx="506" cy="390" r="18"/>
    <circle cx="1048" cy="342" r="27"/><circle cx="1112" cy="378" r="22"/><circle cx="818" cy="736" r="25"/>
  </g>
  <g fill="#4b6f87" opacity=".76"><path d="M1190 132c90 34 164 104 206 206-42 18-88 26-136 18-70-12-120-60-150-124z"/><path d="M170 590c92 8 148 52 170 130-78 20-150 0-216-58z"/></g>
  <text x="800" y="106" text-anchor="middle" font-family="Georgia, serif" font-size="64" font-weight="700" fill="#3e2815">${label}</text>
  <text x="800" y="930" text-anchor="middle" font-family="Georgia, serif" font-size="28" fill="#5a3e23">fallback regional map</text>
</svg>
`;
}

function motifFor(asset) {
  const { category, slug } = asset;
  if (category === "alchemy") return alchemyMotif(slug);
  if (category === "bestiary") return bestiaryMotif(slug);
  if (category === "journal") return journalMotif(slug);
  if (category === "magic") return magicMotif(slug);
  if (category === "professions") return professionMotif(slug);
  if (category === "races") return raceMotif(slug);
  if (category === "runes-glyphs") return runeMotif(slug);
  if (category === "transportation") return transportMotif(slug);
  if (category === "witcher-gear") return gearMotif(slug);
  return miscMotif(slug);
}

function alchemyMotif(slug) {
  const potion = {
    "swallow": { liquid: "#d7772b", glow: "#f4b15d", accent: "heal" },
    "thunderbolt": { liquid: "#2f2520", glow: "#b98038", accent: "strength" },
    "blizzard": { liquid: "#b8eef4", glow: "#eefcff", accent: "frost" },
    "golden-oriole": { liquid: "#e0ad24", glow: "#ffe078", accent: "antidote" },
    "katakan-decoction": { liquid: "#6d2025", glow: "#a13a42", accent: "fang" },
    "wyvern-decoction": { liquid: "#486f35", glow: "#8aa95f", accent: "wing" },
    "werewolf-decoction": { liquid: "#6c665c", glow: "#b3aa99", accent: "claw" },
    "grave-hag-decoction": { liquid: "#6e5636", glow: "#aa8753", accent: "skull" },
    "arachas-decoction": { liquid: "#586f31", glow: "#9aa85a", accent: "web" },
  }[slug] || { liquid: "#7fb069", glow: "#b7d98b", accent: "bubbles" };
  const accent = alchemyAccent(potion.accent);
  return `<path d="M210 78h92v46l-28 24v76l82 142c32 56-8 126-72 126h-56c-64 0-104-70-72-126l82-142v-76l-28-24z" fill="#f5ead1"/>
  <path d="M178 354h156l34 58c20 34-4 78-44 78H188c-40 0-64-44-44-78z" fill="${potion.liquid}"/>
  <path d="M198 378h116c20 0 34 22 24 40-12 22-30 36-82 36s-70-14-82-36c-10-18 4-40 24-40z" fill="${potion.glow}" opacity=".58"/>
  <path d="M220 86h72" stroke="#60422b" stroke-width="18" stroke-linecap="round"/>
  ${accent}`;
}

function bestiaryMotif(slug) {
  if (slug.includes("centipede") || slug.includes("scorpion") || slug.includes("glustyworp")) {
    return `<path d="M104 254c72-72 232-72 304 0-70 78-234 78-304 0z" fill="#ead7b0"/>
    <path d="M136 254h240" stroke="#4e3929" stroke-width="18" stroke-linecap="round"/>
    <g stroke="#ead7b0" stroke-width="20" stroke-linecap="round"><path d="M176 226l-44-60"/><path d="M222 216l-18-72"/><path d="M290 216l18-72"/><path d="M336 226l44-60"/><path d="M176 282l-44 60"/><path d="M222 292l-18 72"/><path d="M290 292l18 72"/><path d="M336 282l44 60"/></g>`;
  }
  if (slug.includes("wraith")) {
    return `<path d="M256 72c76 0 126 62 126 140v210l-54-40-44 58-44-58-54 40V212c0-78 50-140 126-140z" fill="#e7edf0" opacity=".88"/>
    <circle cx="220" cy="206" r="18" fill="#182327"/><circle cx="292" cy="206" r="18" fill="#182327"/><path d="M222 282c24 22 44 22 68 0" fill="none" stroke="#182327" stroke-width="12" stroke-linecap="round"/>`;
  }
  if (slug.includes("criminal") || slug.includes("scout")) {
    return `<circle cx="256" cy="144" r="62" fill="#ead7b0"/><path d="M132 436c20-100 70-158 124-158s104 58 124 158z" fill="#ead7b0"/>
    <path d="M166 246l180-68" stroke="#3b281b" stroke-width="24" stroke-linecap="round"/><path d="M178 256l176 0" stroke="#3b281b" stroke-width="18" stroke-linecap="round"/>`;
  }
  return `<path d="M256 68c92 0 166 74 166 166 0 48-22 94-58 126l-42-42c24-22 38-52 38-84 0-58-46-104-104-104s-104 46-104 104c0 32 14 62 38 84l-42 42c-36-32-58-78-58-126 0-92 74-166 166-166z" fill="#ead7b0"/>
  <circle cx="216" cy="224" r="20" fill="#211816"/><circle cx="296" cy="224" r="20" fill="#211816"/><path d="M190 334h132l40 108H150z" fill="#c6a078"/>`;
}

function journalMotif(slug) {
  const image = slug.includes("handouts");
  return `<path d="M126 82h260c22 0 40 18 40 40v294c0 22-18 40-40 40H126c-22 0-40-18-40-40V122c0-22 18-40 40-40z" fill="#f3e4bd"/>
  ${image ? `<rect x="144" y="142" width="224" height="160" rx="10" fill="#8fb0a0"/><path d="M158 282l62-70 48 46 36-36 50 60z" fill="#f3e4bd"/>` : `<path d="M150 154h210M150 210h210M150 266h172M150 322h196" stroke="#6b4b2f" stroke-width="18" stroke-linecap="round"/>`}
  <path d="M126 82c30 28 30 346 0 374" fill="none" stroke="#6b4b2f" stroke-width="16" opacity=".7"/>`;
}

function magicMotif(slug) {
  if (slug.includes("fire") || slug.includes("flame") || slug.includes("blemish")) return `<path d="M256 64c66 84-24 116 50 196 26 28 40 62 32 100-10 52-50 88-98 88-58 0-104-46-104-104 0-54 38-92 78-126 34-30 56-76 42-154z" fill="#f4d071"/><path d="M260 250c38 54-20 72 12 118 14 20-2 48-28 48-28 0-48-22-48-50 0-38 48-62 64-116z" fill="#c44b32"/>`;
  if (slug.includes("water") || slug.includes("deluge")) return `<path d="M256 64c90 106 132 178 132 244 0 82-58 140-132 140s-132-58-132-140c0-66 42-138 132-244z" fill="#c9eff6"/><path d="M188 328c42 34 94 34 136 0" fill="none" stroke="#327c92" stroke-width="22" stroke-linecap="round"/>`;
  if (slug.includes("earth") || slug.includes("prison")) return `<path d="M118 338l72-178h132l72 178-138 92z" fill="#d0b17a"/><path d="M190 160l66 270M322 160l-66 270M118 338h276" stroke="#5b4128" stroke-width="18" stroke-linecap="round"/>`;
  if (slug.includes("air") || slug.includes("ribbon") || slug.includes("shift")) return `<path d="M110 214c98-76 188 58 292-18M116 302c84-58 164 42 282-10M160 382c66-44 142 28 220-4" fill="none" stroke="#e6f2f4" stroke-width="28" stroke-linecap="round"/>`;
  return `<circle cx="256" cy="254" r="150" fill="none" stroke="#e6f2f4" stroke-width="20"/><path d="M256 88l50 114 124 12-92 86 26 122-108-62-108 62 26-122-92-86 124-12z" fill="#e6f2f4"/>`;
}

function professionMotif(slug) {
  if (slug.includes("bard")) return `<path d="M182 116v214c0 44-34 78-78 78 0-44 34-78 78-78" fill="none" stroke="#f5e2b9" stroke-width="28" stroke-linecap="round"/><path d="M182 134l184-46v214c0 44-34 78-78 78 0-44 34-78 78-78" fill="none" stroke="#f5e2b9" stroke-width="28" stroke-linecap="round"/>`;
  if (slug.includes("mage")) return `<path d="M256 66l54 148 150 8-118 94 38 146-124-82-124 82 38-146-118-94 150-8z" fill="#f5e2b9"/>`;
  if (slug.includes("merchant")) return `<path d="M132 168h248l38 204H94z" fill="#f5e2b9"/><path d="M184 168c0-48 30-78 72-78s72 30 72 78" fill="none" stroke="#f5e2b9" stroke-width="24"/><circle cx="206" cy="280" r="20" fill="#7c4b28"/><circle cx="306" cy="280" r="20" fill="#7c4b28"/>`;
  if (slug.includes("witcher")) return gearMotif("wolf-medallion");
  return `<path d="M256 64l150 80v100c0 98-60 168-150 210-90-42-150-112-150-210V144z" fill="#f5e2b9"/><path d="M176 266h160M212 202h88M212 330h88" stroke="#7c4b28" stroke-width="28" stroke-linecap="round"/>`;
}

function raceMotif(slug) {
  const ears = slug.includes("elf") ? `<path d="M172 172l-84-54 96-14M340 172l84-54-96-14" fill="none" stroke="#f1dfbd" stroke-width="22" stroke-linecap="round" stroke-linejoin="round"/>` : "";
  const beard = slug.includes("dwarf") ? `<path d="M184 220c18 106 126 106 144 0 28 92-16 194-72 222-56-28-100-130-72-222z" fill="#7d5a38"/>` : "";
  const medallion = slug.includes("witcher") ? `<circle cx="256" cy="326" r="34" fill="#c9cbc2"/><path d="M256 306l14 20 24 4-18 16 6 24-26-12-26 12 6-24-18-16 24-4z" fill="#303734"/>` : "";
  return `${ears}<circle cx="256" cy="164" r="78" fill="#f1dfbd"/><path d="M118 444c24-104 78-158 138-158s114 54 138 158z" fill="#f1dfbd"/>${beard}${medallion}<circle cx="228" cy="154" r="10" fill="#202719"/><circle cx="284" cy="154" r="10" fill="#202719"/>`;
}

function runeMotif(slug) {
  const variants = {
    "dazhbog-rune": "M256 96v320M176 176l80-80 80 80M176 336l80 80 80-80",
    "zoria-rune": "M164 128h184L164 384h184M256 128v256",
    "veles-rune": "M168 112l88 288 88-288M196 260h120",
    "chemobog-rune": "M162 150l188 212M350 150L162 362M256 86v340",
    "glyph-of-earth": "M256 92l148 148-148 148-148-148zM256 150v180M166 240h180",
  };
  const pathData = variants[slug] || "M256 96v320M170 190h172M196 320h120";
  return `<path d="M256 56l166 96v192l-166 96-166-96V152z" fill="none" stroke="#e9f7f8" stroke-width="22"/><path d="${pathData}" fill="none" stroke="#e9f7f8" stroke-width="26" stroke-linecap="round" stroke-linejoin="round"/>`;
}

function transportMotif(slug) {
  if (slug.includes("ship") || slug.includes("boat") || slug.includes("cutter")) {
    return `<path d="M110 330h292l-46 74H156z" fill="#f0dfbd"/><path d="M256 100v230M256 126l-106 150h106zM270 152l110 124H270z" fill="#f0dfbd"/><path d="M122 422c52-24 86 24 134 0 52-24 86 24 134 0" fill="none" stroke="#8cc0cf" stroke-width="18" stroke-linecap="round"/>`;
  }
  if (slug.includes("saddle") || slug.includes("blinder") || slug.includes("mule") || slug.includes("ox")) {
    return `<path d="M114 276c34-84 98-126 180-126 74 0 118 44 138 104l-38 16c-20-38-52-56-96-56-54 0-96 22-126 68z" fill="#f0dfbd"/><path d="M178 274l-22 108M330 270l40 112" stroke="#f0dfbd" stroke-width="22" stroke-linecap="round"/><path d="M206 196h112l28 58H178z" fill="#6b4b2f"/>`;
  }
  if (slug.includes("skates")) {
    return `<path d="M130 264h230c28 0 50 22 50 50H188c-34 0-58-18-58-50z" fill="#f0dfbd"/><path d="M166 326c54 48 136 48 244 0" fill="none" stroke="#d8eef2" stroke-width="18" stroke-linecap="round"/><path d="M206 314v76M342 314v76" stroke="#f0dfbd" stroke-width="16"/>`;
  }
  return `<path d="M92 306h288l42 70H70z" fill="#f0dfbd"/><path d="M150 306l66-118h116l48 118" fill="none" stroke="#f0dfbd" stroke-width="24" stroke-linejoin="round"/><circle cx="166" cy="392" r="42" fill="#281c13" stroke="#f0dfbd" stroke-width="18"/><circle cx="346" cy="392" r="42" fill="#281c13" stroke="#f0dfbd" stroke-width="18"/>`;
}

function gearMotif(slug) {
  if (slug.includes("armor")) return `<path d="M158 94h196l50 82-46 254H154l-46-254z" fill="#d9d9cf"/><path d="M188 126c26 42 110 42 136 0M168 220h176M154 318h204" fill="none" stroke="#3f4642" stroke-width="18" stroke-linecap="round"/>`;
  return `<path d="M256 68l58 72 94 8-48 82 20 92-88-36-36 86-36-86-88 36 20-92-48-82 94-8z" fill="#d9d9cf"/><circle cx="256" cy="250" r="58" fill="#222625"/><path d="M232 236h48M256 212v74" stroke="#d9d9cf" stroke-width="16" stroke-linecap="round"/>`;
}

function miscMotif(slug) {
  if (slug.includes("skull")) return `<path d="M256 82c76 0 132 58 132 132 0 56-30 90-70 112v76H194v-76c-40-22-70-56-70-112 0-74 56-132 132-132z" fill="#e7edf0"/><circle cx="216" cy="222" r="28" fill="#203036"/><circle cx="296" cy="222" r="28" fill="#203036"/><path d="M234 304h44M214 362h84" stroke="#203036" stroke-width="16" stroke-linecap="round"/>`;
  if (slug.includes("eye")) return `<path d="M78 256c98-112 258-112 356 0-98 112-258 112-356 0z" fill="#f1dfbd"/><circle cx="256" cy="256" r="76" fill="#6da5b0"/><circle cx="256" cy="256" r="36" fill="#17272c"/><circle cx="278" cy="232" r="14" fill="#fff"/>`;
  if (slug.includes("megascope") || slug.includes("telecommunicator")) return `<circle cx="256" cy="218" r="112" fill="#d8e2e1"/><circle cx="256" cy="218" r="72" fill="#5c95a0"/><path d="M156 370h200M206 320h100v50H206z" stroke="#f1dfbd" stroke-width="24" stroke-linecap="round" fill="none"/>`;
  return raceMotif(slug);
}

function bird(x, y, s = 1) {
  return `<path d="M${x - 68 * s} ${y}c42-38 76-34 112 0 28-22 58-30 96-18-48 18-82 44-110 82-34-44-74-62-118-64z" fill="#f5ead1" opacity=".92"/>`;
}

function snowflake(x, y, s = 1) {
  return `<g stroke="#327c92" stroke-width="${16 * s}" stroke-linecap="round"><path d="M${x} ${y - 76 * s}v${152 * s}"/><path d="M${x - 66 * s} ${y - 38 * s}l${132 * s} ${76 * s}"/><path d="M${x + 66 * s} ${y - 38 * s}l-${132 * s} ${76 * s}"/></g>`;
}

function lightning(x, y, s = 1) {
  return `<path d="M${x + 12 * s} ${y - 92 * s}l-${58 * s} ${122 * s}h${50 * s}l-${36 * s} ${104 * s}l${96 * s}-${146 * s}h-${54 * s}z" fill="#7c4b28"/>`;
}

function alchemyAccent(kind) {
  if (kind === "heal") {
    return `<path d="M256 168v104M204 220h104" stroke="#fff1cc" stroke-width="30" stroke-linecap="round"/>`;
  }
  if (kind === "strength") {
    return `<path d="M196 232c42-64 78-64 120 0M210 236c20 32 72 32 92 0" fill="none" stroke="#d4a05a" stroke-width="24" stroke-linecap="round"/><path d="M186 286h140" stroke="#d4a05a" stroke-width="20" stroke-linecap="round"/>`;
  }
  if (kind === "frost") return snowflake(256, 212, 1.15);
  if (kind === "antidote") {
    return `<path d="M256 146c52 42 82 82 82 122-44 8-82-6-112-42-26-32-34-68-24-110 22 4 40 14 54 30z" fill="#fff3a6" opacity=".9"/><path d="M212 214c42-2 78 12 106 42" fill="none" stroke="#725729" stroke-width="14" stroke-linecap="round"/>`;
  }
  if (kind === "fang") {
    return `<path d="M198 140c32 34 38 88 12 134-28-42-34-88-12-134zM314 140c-32 34-38 88-12 134 28-42 34-88 12-134z" fill="#f2dfc0"/>`;
  }
  if (kind === "wing") {
    return `<path d="M170 246c58-86 116-102 174-48-68 4-122 28-174 48zM342 246c-58-86-116-102-174-48 68 4 122 28 174 48z" fill="#dce6b9" opacity=".9"/>`;
  }
  if (kind === "claw") {
    return `<path d="M190 144c26 58 22 104-12 144M256 128c18 62 18 112 0 158M322 144c-26 58-22 104 12 144" fill="none" stroke="#ddd1bd" stroke-width="22" stroke-linecap="round"/>`;
  }
  if (kind === "skull") {
    return `<path d="M256 132c48 0 82 34 82 78 0 34-18 56-44 70v44h-76v-44c-26-14-44-36-44-70 0-44 34-78 82-78z" fill="#e9dbc2"/><circle cx="232" cy="210" r="14" fill="#6e5636"/><circle cx="280" cy="210" r="14" fill="#6e5636"/>`;
  }
  if (kind === "web") {
    return `<path d="M256 132v160M178 178l156 94M334 178l-156 94M180 236h152" stroke="#e3e5c7" stroke-width="14" stroke-linecap="round"/><circle cx="256" cy="222" r="64" fill="none" stroke="#e3e5c7" stroke-width="12"/>`;
  }
  return `<circle cx="224" cy="196" r="18" fill="#f5ead1" opacity=".85"/><circle cx="286" cy="230" r="14" fill="#f5ead1" opacity=".75"/><circle cx="250" cy="270" r="10" fill="#f5ead1" opacity=".65"/>`;
}

function paletteFor(asset) {
  return {
    "alchemy": { light: "#657e56", mid: "#31583a", dark: "#17231c" },
    "bestiary": { light: "#8a6f55", mid: "#533a2f", dark: "#211816" },
    "journal": { light: "#c8aa68", mid: "#7a5732", dark: "#302114" },
    "magic": { light: "#5fb6c8", mid: "#24647b", dark: "#102733" },
    "misc": { light: "#9a8976", mid: "#594638", dark: "#211a16" },
    "professions": { light: "#c79f55", mid: "#7c4b28", dark: "#2d1b13" },
    "races": { light: "#94a675", mid: "#5a6c4a", dark: "#202719" },
    "runes-glyphs": { light: "#a8c9cf", mid: "#47747d", dark: "#172d34" },
    "transportation": { light: "#c19b6b", mid: "#6b4b2f", dark: "#281c13" },
    "witcher-gear": { light: "#b6b7ad", mid: "#666b67", dark: "#222625" },
  }[asset.category] || { light: "#9c8b78", mid: "#594638", dark: "#211a16" };
}

function titleCase(slug) {
  return slug.split("-").map((part) => part ? part[0].toUpperCase() + part.slice(1) : part).join(" ");
}

function fontSize(label) {
  if (label.length > 28) return 21;
  if (label.length > 22) return 24;
  if (label.length > 17) return 28;
  return 32;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
