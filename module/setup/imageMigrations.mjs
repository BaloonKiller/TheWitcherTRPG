const SYSTEM_ID = "thewitchertrpg";
const ASSET_PREFIX = `systems/${SYSTEM_ID}/assets/images/`;
const GENERATED_IMAGE_PREFIX = `systems/${SYSTEM_ID}/assets/images/generated/`;

export const IMAGE_MIGRATION_VERSION = 1.034;

const IMAGE_PATH_REPLACEMENTS = new Map([
  [`${GENERATED_IMAGE_PREFIX}witcher-signs/aard.webp`, `systems/${SYSTEM_ID}/assets/images/witcher-signs/aard.png`],
  [`${GENERATED_IMAGE_PREFIX}witcher-signs/aard-sweep.webp`, `systems/${SYSTEM_ID}/assets/images/witcher-signs/aard.png`],
  [`${GENERATED_IMAGE_PREFIX}witcher-signs/axii.webp`, `systems/${SYSTEM_ID}/assets/images/witcher-signs/axii.png`],
  [`${GENERATED_IMAGE_PREFIX}witcher-signs/puppet.webp`, `systems/${SYSTEM_ID}/assets/images/witcher-signs/axii.png`],
  [`${GENERATED_IMAGE_PREFIX}witcher-signs/igni.webp`, `systems/${SYSTEM_ID}/assets/images/witcher-signs/igni.png`],
  [`${GENERATED_IMAGE_PREFIX}witcher-signs/fire-stream.webp`, `systems/${SYSTEM_ID}/assets/images/witcher-signs/igni.png`],
  [`${GENERATED_IMAGE_PREFIX}witcher-signs/quen.webp`, `systems/${SYSTEM_ID}/assets/images/witcher-signs/quen.png`],
  [`${GENERATED_IMAGE_PREFIX}witcher-signs/active-shield.webp`, `systems/${SYSTEM_ID}/assets/images/witcher-signs/quen.png`],
  [`${GENERATED_IMAGE_PREFIX}witcher-signs/yrden.webp`, `systems/${SYSTEM_ID}/assets/images/witcher-signs/yrden.png`],
  [`${GENERATED_IMAGE_PREFIX}witcher-signs/magic-trap.webp`, `systems/${SYSTEM_ID}/assets/images/witcher-signs/yrden.png`],
  [
    "https://assets.forge-vtt.com/bazaar/core/icons/commodities/metal/ingot-stamped-steel.webp",
    `systems/${SYSTEM_ID}/assets/images/components/mahakam-steel.png`,
  ],
]);

export const CURATED_ITEM_IMAGE_PATHS = new Map([
  [itemKey("mutagen", "Alp Mutagen"), `${ASSET_PREFIX}mutagens/alp-mutagen.png`],
  [itemKey("mutagen", "Arachas Mutagen"), `${ASSET_PREFIX}mutagens/arachas-mutagen.png`],
  [itemKey("mutagen", "Bear Mutagen"), `${ASSET_PREFIX}mutagens/generic-green.png`],
  [itemKey("mutagen", "Botchling Mutagen"), `${ASSET_PREFIX}mutagens/generic-red.png`],
  [itemKey("mutagen", "Bruxa Mutagen"), `${ASSET_PREFIX}mutagens/bruxa-mutagen.png`],
  [itemKey("mutagen", "Bullvore Mutagen"), `${ASSET_PREFIX}mutagens/generic-green.png`],
  [itemKey("mutagen", "Cockatrice Mutagen"), `${ASSET_PREFIX}mutagens/cockatrice-mutagen.png`],
  [itemKey("mutagen", "Elemental (Earth) Mutagen"), `${ASSET_PREFIX}mutagens/earth-elemental-mutagen.png`],
  [itemKey("mutagen", "Elemental (Fire) Mutagen"), `${ASSET_PREFIX}mutagens/fire-elemental-mutagen.png`],
  [itemKey("mutagen", "Elemental (Ice) Mutagen"), `${ASSET_PREFIX}mutagens/generic-blue.png`],
  [itemKey("mutagen", "Fiend Mutagen"), `${ASSET_PREFIX}mutagens/fiend-mutagen.png`],
  [itemKey("mutagen", "Foglet Mutagen"), `${ASSET_PREFIX}mutagens/foglet-mutagen.png`],
  [itemKey("mutagen", "Frightener Mutagen"), `${ASSET_PREFIX}mutagens/frightener-mutagen.png`],
  [itemKey("mutagen", "Garkain Mutagen"), `${ASSET_PREFIX}mutagens/garkain-mutagen.png`],
  [itemKey("mutagen", "Glustyworp Mutagen"), `${ASSET_PREFIX}mutagens/generic-green.png`],
  [itemKey("mutagen", "Golem Mutagen"), `${ASSET_PREFIX}mutagens/generic-green.png`],
  [itemKey("mutagen", "Grave Hag Mutagen"), `${ASSET_PREFIX}mutagens/grave-hag-mutagen.png`],
  [itemKey("mutagen", "Griffin Mutagen"), `${ASSET_PREFIX}mutagens/griffin-mutagen.png`],
  [itemKey("mutagen", "Katakan Mutagen"), `${ASSET_PREFIX}mutagens/katakan-mutagen.png`],
  [itemKey("mutagen", "Manticore Mutagen"), `${ASSET_PREFIX}mutagens/manticore-mutagen.png`],
  [itemKey("mutagen", "Nekker Mutagen"), `${ASSET_PREFIX}mutagens/nekker-mutagen.png`],
  [itemKey("mutagen", "Noon Wraith Mutagen"), `${ASSET_PREFIX}mutagens/noon-wraith-mutagen.png`],
  [itemKey("mutagen", "Penitent Mutagen"), `${ASSET_PREFIX}mutagens/penitent-mutagen.png`],
  [itemKey("mutagen", "Pesta Mutagen"), `${ASSET_PREFIX}mutagens/pesta-mutagen.png`],
  [itemKey("mutagen", "Phoenix Mutagen"), `${ASSET_PREFIX}mutagens/generic-red.png`],
  [itemKey("mutagen", "Shaelmaar Mutagen"), `${ASSET_PREFIX}mutagens/shaelmaar-mutagen.png`],
  [itemKey("mutagen", "Siren Mutagen"), `${ASSET_PREFIX}mutagens/siren-mutagen.png`],
  [itemKey("mutagen", "Succubus Mutagen"), `${ASSET_PREFIX}mutagens/succubus-mutagen.png`],
  [itemKey("mutagen", "Troll Mutagen"), `${ASSET_PREFIX}mutagens/troll-mutagen.png`],
  [itemKey("mutagen", "Vendigo Mutagen"), `${ASSET_PREFIX}mutagens/generic-red.png`],
  [itemKey("mutagen", "Werecat Mutagen"), `${ASSET_PREFIX}mutagens/generic-red.png`],
  [itemKey("mutagen", "Werewolf Mutagen"), `${ASSET_PREFIX}mutagens/werewolf-mutagen.png`],
  [itemKey("mutagen", "Wyvern Mutagen"), `${ASSET_PREFIX}mutagens/wyvern-mutagen.png`],

  [itemKey("alchemical", "Adrenal Elixir"), `${ASSET_PREFIX}potions/stats-elixir.png`],
  [itemKey("alchemical", "Anabolic Steroids"), `${ASSET_PREFIX}potions/stats-elixir.png`],
  [itemKey("alchemical", "Black Blood"), `${ASSET_PREFIX}potions/black-blood.png`],
  [itemKey("alchemical", "Blizzard"), `${ASSET_PREFIX}potions/blizzard.png`],
  [itemKey("alchemical", "Cat"), `${ASSET_PREFIX}potions/cat.png`],
  [itemKey("alchemical", "Cerebral Elixir"), `${ASSET_PREFIX}potions/stats-elixir.png`],
  [itemKey("alchemical", "Endurance Potion"), `${ASSET_PREFIX}potions/restoring-potion.png`],
  [itemKey("alchemical", "Full Moon"), `${ASSET_PREFIX}potions/full-moon.png`],
  [itemKey("alchemical", "Golden Oriole"), `${ASSET_PREFIX}potions/golden-oriole.png`],
  [itemKey("alchemical", "Killer Whale"), `${ASSET_PREFIX}potions/killer-whale.png`],
  [itemKey("alchemical", "Last Hope"), `${ASSET_PREFIX}potions/healing-potion.png`],
  [itemKey("alchemical", "Lightning"), `${ASSET_PREFIX}potions/thunderbolt.png`],
  [itemKey("alchemical", "Maribor Forest"), `${ASSET_PREFIX}potions/maribor-forest.png`],
  [itemKey("alchemical", "Mongoose"), `${ASSET_PREFIX}potions/golden-oriole.png`],
  [itemKey("alchemical", "Mongoose Elixir"), `${ASSET_PREFIX}potions/golden-oriole.png`],
  [itemKey("alchemical", "Pantagran's Elixir"), `${ASSET_PREFIX}potions/stats-elixir.png`],
  [itemKey("alchemical", "Perfume Potion"), `${ASSET_PREFIX}potions/perfume-potion.png`],
  [itemKey("alchemical", "Petri's Filter"), `${ASSET_PREFIX}potions/petris-filter.png`],
  [itemKey("alchemical", "Strider"), `${ASSET_PREFIX}potions/restoring-potion.png`],
  [itemKey("alchemical", "Swallow"), `${ASSET_PREFIX}potions/swallow.png`],
  [itemKey("alchemical", "Tawny Owl"), `${ASSET_PREFIX}potions/tawny-owl.png`],
  [itemKey("alchemical", "Tempest"), `${ASSET_PREFIX}potions/blizzard.png`],
  [itemKey("alchemical", "Thunderbolt"), `${ASSET_PREFIX}potions/thunderbolt.png`],
  [itemKey("alchemical", "Vitality Potion"), `${ASSET_PREFIX}potions/healing-potion.png`],
  [itemKey("alchemical", "White Honey"), `${ASSET_PREFIX}potions/white-honey.png`],
  [itemKey("alchemical", "White Raffard's Decoction"), `${ASSET_PREFIX}potions/white-raffards-decoction.png`],

  [itemKey("alchemical", "Arachas Decoction"), `${ASSET_PREFIX}decoctions/arachas-decoction.png`],
  [itemKey("alchemical", "Fiend Decoction"), `${ASSET_PREFIX}decoctions/fiend-decoction.png`],
  [itemKey("alchemical", "Grave Hag Decoction"), `${ASSET_PREFIX}decoctions/grave-hag-decoction.png`],
  [itemKey("alchemical", "Griffin Decoction"), `${ASSET_PREFIX}decoctions/griffin-decoction.png`],
  [itemKey("alchemical", "Katakan Decoction"), `${ASSET_PREFIX}decoctions/katakan-decoction.png`],
  [itemKey("alchemical", "Nekker Decoction"), `${ASSET_PREFIX}decoctions/nekker-decoction.png`],
  [itemKey("alchemical", "Noon Wraith Decoction"), `${ASSET_PREFIX}decoctions/noon-wraith-decoction.png`],
  [itemKey("alchemical", "Troll Decoction"), `${ASSET_PREFIX}decoctions/troll-decoction.png`],
  [itemKey("alchemical", "Werewolf Decoction"), `${ASSET_PREFIX}decoctions/werewolf-decoction.png`],
  [itemKey("alchemical", "Wyvern Decoction"), `${ASSET_PREFIX}decoctions/wyvern-decoction.png`],

  [itemKey("weapon", "Dancing Star"), `${ASSET_PREFIX}bombs/dancing-star.png`],
  [itemKey("weapon", "Devil's Puffball"), `${ASSET_PREFIX}bombs/devils-puffball.png`],
  [itemKey("weapon", "Dimeritium Bomb"), `${ASSET_PREFIX}bombs/dimeritium-bomb.png`],
  [itemKey("weapon", "Dragon's Dream"), `${ASSET_PREFIX}bombs/dragons-dream.png`],
  [itemKey("weapon", "Grapeshot"), `${ASSET_PREFIX}bombs/grapeshot.png`],
  [itemKey("weapon", "Moon Dust"), `${ASSET_PREFIX}bombs/moon-dust.png`],
  [itemKey("weapon", "Northern Wind"), `${ASSET_PREFIX}bombs/northern-wind.png`],
  [itemKey("weapon", "Samum"), `${ASSET_PREFIX}bombs/samum.png`],
]);

export function normalizeGeneratedImagePath(value) {
  if (typeof value !== "string") return value;

  const normalized = value.startsWith(GENERATED_IMAGE_PREFIX)
    ? value.replace(/\.svg(?=$|\?)/i, ".webp")
    : value;
  return IMAGE_PATH_REPLACEMENTS.get(normalized) ?? normalized;
}

export function getCuratedItemImage(document) {
  if (!document?.type || !document?.name) return null;
  return CURATED_ITEM_IMAGE_PATHS.get(itemKey(document.type, document.name)) ?? null;
}

export function normalizeDocumentImagePath(value, document, field = "img") {
  const imageOwner = field === "system.associatedItem.img"
    ? document?.system?.associatedItem
    : document;
  return getCuratedItemImage(imageOwner) ?? normalizeGeneratedImagePath(value);
}

function itemKey(type, name) {
  return `${type}|${name}`;
}
