import { buttonDialog, extendedRoll } from "./chat.js";
import { addModifiers } from "./witcher.js";
import { addActorSkillEffectModifiers } from "./actorSkillEffects.mjs";
import { RollConfig } from "./rollConfig.js";
import { WITCHER } from "../setup/config.js";
import { WitcherDialog, renderApplication } from "../setup/foundry-compat.js";
import { applySuccessfulDamageStatusEffects } from "./damageEffects.mjs";
import { applyDamageCriticalWound, getCriticalWoundBonusDamage } from "./criticalWounds.mjs";
import { buildDamageResourceUpdate, shouldApplyCriticalWound, shouldApplyDamageEffects } from "./damageApplication.mjs";
import { restrictDefenceButtons } from "./spellResolution.mjs";
import { updateSpellAreaTargetDefence } from "./spellArea.mjs";

async function ApplyNormalDamage(actor, totalDamage, messageId) {
  return applyDamage(actor, totalDamage, messageId, "hp")
}

async function ApplyNonLethalDamage(actor, totalDamage, messageId) {
  return applyDamage(actor, totalDamage, messageId, "sta")
}

async function applyDamage(actor, totalDamage, messageId, derivedStat) {
  if (!actor) {
    return ui.notifications.error(game.i18n.localize("WITCHER.Context.SelectActor"));
  }

  const message = getDamageMessage(messageId, totalDamage);
  if (!message) {
    return ui.notifications.error(game.i18n.localize("WITCHER.Context.applyDmg") + ": missing chat message data.");
  }

  totalDamage = Number(totalDamage);
  if (!Number.isFinite(totalDamage)) {
    totalDamage = Number(message.rolls?.at(-1)?.total);
  }

  if (!Number.isFinite(totalDamage)) {
    return ui.notifications.error(game.i18n.localize("WITCHER.Context.applyDmg") + ": invalid damage total.");
  }
  totalDamage = Math.max(0, totalDamage);
  const rolledDamage = totalDamage;

  let damageOptions = message.getFlag('thewitchertrpg', 'damageOptions') ?? {}
  let damage = message.getFlag('thewitchertrpg', 'damage')
  if (!damage) {
    return ui.notifications.error(game.i18n.localize("WITCHER.Context.applyDmg") + ": missing damage data.");
  }

  const existingApplication = findDamageApplication(message, actor);
  if (existingApplication) {
    ui.notifications.warn(game.i18n.format("WITCHER.Chat.DamageAlreadyResolved", { target: actor.name }));
    return { status: "alreadyApplied", application: existingApplication };
  }

  let criticalBonusDamage = getCriticalWoundBonusDamage(damage, actor);

  let armors = actor.getList("armor").filter(isArmorEquipped);

  let headArmors = armors.filter(armor => armorProtectsLocation(armor, "Head", "FullCover"))
  let torsoArmors = armors.filter(armor => armorProtectsLocation(armor, "Torso", "FullCover"))
  let legArmors = armors.filter(armor => armorProtectsLocation(armor, "Leg", "FullCover"))

  let naturalArmors = armors.filter(n => n.system.type == "Natural")

  let damageTypeloc = `WITCHER.Armor.${damage.type}`;

  const locationOptions = `
    <option value="Empty"></option>
    <option value="Head"> ${game.i18n.localize("WITCHER.Dialog.attackHead")} </option>
    <option value="Torso"> ${game.i18n.localize("WITCHER.Dialog.attackTorso")} </option>
    <option value="L. Arm"> ${game.i18n.localize("WITCHER.Dialog.attackLArm")} </option>
    <option value="R. Arm"> ${game.i18n.localize("WITCHER.Dialog.attackRArm")} </option>
    <option value="L. Leg"> ${game.i18n.localize("WITCHER.Dialog.attackLLeg")} </option>
    <option value="R. Leg"> ${game.i18n.localize("WITCHER.Dialog.attackRLeg")} </option>
    <option value="Tail/Wing"> ${game.i18n.localize("WITCHER.Dialog.attackTail")} </option>
    `;

  const silverOptions = `
    <option></option>
    <option value="1d6">1d6</option>
    <option value="2d6">2d6</option>
    <option value="3d6">3d6</option>
    <option value="4d6">4d6</option>
    <option value="5d6">5d6</option>
    `;

  let location = damage.location;
  let content = `<label>${game.i18n.localize("WITCHER.Damage.damageType")}: <b>${game.i18n.localize(damageTypeloc)}</b></label> <br />
      <label>${game.i18n.localize("WITCHER.Damage.CurrentLocation")}: <b>${location.alias}</b></label> <br />
      <label>${game.i18n.localize("WITCHER.Damage.ChangeLocation")}: <select name="changeLocation">${locationOptions}</select></label> <br />`

  if (actor.type == "monster") {
    content += `<label>${game.i18n.localize("WITCHER.Damage.resistSilver")}: <input type="checkbox" name="resistNonSilver"></label><br />
                    <label>${game.i18n.localize("WITCHER.Damage.resistMeteorite")}: <input type="checkbox" name="resistNonMeteorite"></label><br />`
  }

  content += `<label>${game.i18n.localize("WITCHER.Damage.isVulnerable")}: <input type="checkbox" name="vulnerable"></label><br />
    <label>${game.i18n.localize("WITCHER.Damage.oilDmg")}: <input type="checkbox" name="oilDmg"></label><br />
    <label>${game.i18n.localize("WITCHER.Damage.silverDmg")}: <select name="silverDmg">${silverOptions}</select></label><br />`

  if (criticalBonusDamage > 0) {
    content += `<div class="damage-dialog-critical"><b>${game.i18n.localize("WITCHER.Damage.criticalBonus")}:</b> +${criticalBonusDamage}</div>`;
  }

  let cancel = true;
  let resistSilver = false;
  let resistMeteorite = false;
  let newLocation = false;
  let isVulnerable = false;
  let addOilDmg = false;
  let silverDmg;

  let infoTotalDmg = totalDamage

  let dialogData = {
    buttons: [
      [`${game.i18n.localize("WITCHER.Button.Continue")}`,
      (html) => {
        newLocation = html.find("[name=changeLocation]")[0].value;
        resistSilver = html.find("[name=resistNonSilver]").prop("checked");
        resistMeteorite = html.find("[name=resistNonMeteorite]").prop("checked");
        isVulnerable = html.find("[name=vulnerable]").prop("checked");
        addOilDmg = html.find("[name=oilDmg]").prop("checked");
        silverDmg = html.find("[name=silverDmg]")[0].value;
        cancel = false
      }]],
    title: game.i18n.localize(derivedStat === "sta"
      ? "WITCHER.Context.applyNonLethal"
      : "WITCHER.Context.applyDmg"),
    content: content
  }

  await buttonDialog(dialogData)

  if (cancel) {
    return { status: "cancelled" };
  }

  if (silverDmg) {
    let silverRoll = await new Roll(silverDmg).evaluate()
    totalDamage = Number(totalDamage) + silverRoll.total
    infoTotalDmg += `+${silverRoll.total}[${game.i18n.localize("WITCHER.Damage.silver")}]`
  }

  if (newLocation != "Empty") {
    location = actor.getLocationObject(newLocation);
  }

  if (addOilDmg) {
    totalDamage = Number(totalDamage) + 5
    infoTotalDmg += `+5[${game.i18n.localize("WITCHER.Damage.oil")}]`
  }

  let shield = Math.max(0, Number(actor.system.derivedStats.shield.value) || 0);
  const incomingDamage = totalDamage + criticalBonusDamage;
  if (incomingDamage <= shield) {
    await actor.update({ 'system.derivedStats.shield.value': shield - incomingDamage });
    const applicationResult = await recordDamageApplication(message, actor, derivedStat);
    const messageContent = buildDamageResolutionContent({
      actor,
      derivedStat,
      adjustedDamage: infoTotalDmg !== rolledDamage ? infoTotalDmg : null,
      location: `${location.alias} x${location.locationFormula}`,
      criticalBonusDamage,
      shieldBefore: shield,
      shieldAfter: shield - incomingDamage,
      appliedDamage: 0,
      statusKey: "WITCHER.Damage.ToMuchShield",
    });
    await appendDamageResolution(message, messageContent);
    return applicationResult;
  }
  else {
    await actor.update({ 'system.derivedStats.shield.value': 0 });
    const absorbedBaseDamage = Math.min(totalDamage, shield);
    totalDamage -= absorbedBaseDamage;
    criticalBonusDamage = Math.max(0, criticalBonusDamage - (shield - absorbedBaseDamage));
  }

  let armorSet = { lightArmor: undefined, mediumArmor: undefined, heavyArmor: undefined };
  let totalSP = 0
  let displaySP = ""
  let values;
  let armorSpField;

  //todo refactor
  switch (location.name) {
    case "Head":
      armorSet = getArmors(headArmors)
      if (!armorSet) return;
      armorSpField = "headStopping";
      values = getArmorSp(armorSet, armorSpField)
      displaySP = values[0]
      totalSP = values[1]
      break;
    case "Torso":
      armorSet = getArmors(torsoArmors)
      if (!armorSet) return;
      armorSpField = "torsoStopping";
      values = getArmorSp(armorSet, armorSpField)
      displaySP = values[0]
      totalSP = values[1]
      break;
    case "R. Arm":
      armorSet = getArmors(torsoArmors)
      if (!armorSet) return;
      armorSpField = "rightArmStopping";
      values = getArmorSp(armorSet, armorSpField)
      displaySP = values[0]
      totalSP = values[1]
      break;
    case "L. Arm":
      armorSet = getArmors(torsoArmors)
      if (!armorSet) return;
      armorSpField = "leftArmStopping";
      values = getArmorSp(armorSet, armorSpField)
      displaySP = values[0]
      totalSP = values[1]
      break;
    case "R. Leg":
      armorSet = getArmors(legArmors)
      if (!armorSet) return;
      armorSpField = "rightLegStopping";
      values = getArmorSp(armorSet, armorSpField)
      displaySP = values[0]
      totalSP = values[1]
      break;
    case "L. Leg":
      armorSet = getArmors(legArmors)
      if (!armorSet) return;
      armorSpField = "leftLegStopping";
      values = getArmorSp(armorSet, armorSpField)
      displaySP = values[0]
      totalSP = values[1]
      break;
  }

  const monsterArmorField = {
    Head: "armorHead",
    Torso: "armorUpper",
    "R. Arm": "armorUpper",
    "L. Arm": "armorUpper",
    "R. Leg": "armorLower",
    "L. Leg": "armorLower",
    "Tail/Wing": "armorTailWing"
  }[location.name];

  // Legacy monster SP is used only when the actor has no equipped armor at all.
  const usesMonsterArmor = actor.type == "monster" && monsterArmorField && armors.length === 0;
  if (usesMonsterArmor) {
    const monsterSP = normalizeSp(actor.system[monsterArmorField]);
    totalSP += monsterSP;
    displaySP = appendSp(displaySP, monsterSP);
  }

  naturalArmors.forEach(armor => {
    //todo refactor
    switch (location.name) {
      case "Head": totalSP = Number(totalSP) + Number(armor?.system.headStopping); displaySP += `+${armor?.system.headStopping}`; break;
      case "Torso": totalSP = Number(totalSP) + Number(armor?.system.torsoStopping); displaySP += `+${armor?.system.torsoStopping}`; break;
      case "R. Arm": totalSP = Number(totalSP) + Number(armor?.system.rightArmStopping); displaySP += `+${armor?.system.rightArmStopping}`; break;
      case "L. Arm": totalSP = Number(totalSP) + Number(armor?.system.leftArmStopping); displaySP += `+${armor?.system.leftArmStopping}`; break;
      case "R. Leg": totalSP = Number(totalSP) + Number(armor?.system.rightLegStopping); displaySP += `+${armor?.system.rightLegStopping}`; break;
      case "L. Leg": totalSP = Number(totalSP) + Number(armor?.system.leftLegStopping); displaySP += `+${armor?.system.leftLegStopping}`; break;
    }
    displaySP += `[${game.i18n.localize("WITCHER.Armor.Natural")}]`;
  })

  totalSP = Number(totalSP);
  if (!Number.isFinite(totalSP)) {
    totalSP = 0;
  }
  if (displaySP === "" || displaySP == null) {
    displaySP = 0;
  }

  const ignoresArmor = Boolean(damageOptions.ignoreArmor);

  if (ignoresArmor) {
    totalSP = 0;
    displaySP = 0;
  } else if (damageOptions.improvedArmorPiercing) {
    totalSP = totalSP / 2;
    displaySP = `${displaySP} / 2`;
  }

  totalDamage = Math.max(0, totalDamage - (totalSP < 0 ? 0 : totalSP));

  const infoAfterSPReduction = totalDamage;
  const baseDamagePenetratedArmor = totalDamage > 0;

  if (!baseDamagePenetratedArmor && criticalBonusDamage <= 0) {
    const applicationResult = await recordDamageApplication(message, actor, derivedStat);
    const messageContent = buildDamageResolutionContent({
      actor,
      derivedStat,
      adjustedDamage: infoTotalDmg !== rolledDamage ? infoTotalDmg : null,
      location: `${location.alias} x${location.locationFormula}`,
      stoppingPower: displaySP,
      damageAfterArmor: infoAfterSPReduction,
      appliedDamage: 0,
      statusKey: "WITCHER.Damage.NotEnough",
      notes: [game.i18n.localize("WITCHER.Damage.notAblated")],
    });
    await appendDamageResolution(message, messageContent);
    return applicationResult;
  }

  let infoAfterLocation = 0;
  let infoAfterResistance = 0;
  let armorAblation = [];

  if (baseDamagePenetratedArmor) {
    totalDamage *= location.locationFormula;
    infoAfterLocation = totalDamage;

    const ignoreArmorResistance = ignoresArmor || damageOptions.armorPiercing || damageOptions.improvedArmorPiercing;
    if (!ignoreArmorResistance && (armorSet["lightArmor"]?.system[damage.type] || armorSet["mediumArmor"]?.system[damage.type] || armorSet["heavyArmor"]?.system[damage.type] || naturalArmors.find(armor => armor.system[damage.type]))) {
      totalDamage *= 0.5;
    }

    if (resistSilver || resistMeteorite) {
      totalDamage *= 0.5;
    }
    if (isVulnerable) {
      totalDamage *= 2;
    }
    infoAfterResistance = totalDamage;

    if (!ignoresArmor) {
      const spDamage = damageOptions.ablating ? Math.floor((await new Roll("1d6/2+1").evaluate()).total) : 1;
      armorAblation = await ablateArmorSet(actor, armorSet, location.name, spDamage);
      if (usesMonsterArmor) {
        armorAblation.push(...await ablateMonsterArmor(actor, monsterArmorField, spDamage));
      }
    }
  }

  const normalAppliedDamage = Math.floor(Math.max(0, totalDamage));
  const appliedCriticalBonus = Math.floor(Math.max(0, criticalBonusDamage));
  const appliedDamage = normalAppliedDamage + appliedCriticalBonus;

  const notes = [];
  if (!baseDamagePenetratedArmor) {
    notes.push(game.i18n.localize("WITCHER.Damage.notAblated"));
  }

  const currentValue = Number(actor.system.derivedStats[derivedStat]?.value);
  const resourceUpdate = buildDamageResourceUpdate(
    derivedStat,
    currentValue,
    normalAppliedDamage,
    appliedCriticalBonus
  );
  if (!resourceUpdate) {
    return ui.notifications.error(game.i18n.localize("WITCHER.Context.applyDmg") + ": invalid actor damage state.");
  }

  await actor.update(resourceUpdate.updates);
  const applicationResult = await recordDamageApplication(message, actor, derivedStat);

  let appliedEffects = [];
  if (shouldApplyDamageEffects(derivedStat, normalAppliedDamage, damage)) {
    appliedEffects = (await applySuccessfulDamageStatusEffects(actor, damage))
      .filter(result => result.applied)
      .map(result => getStatusEffectLabel(result.statusId));
  }

  let appliedCriticalWound = null;
  if (shouldApplyCriticalWound(derivedStat, appliedCriticalBonus)) {
    appliedCriticalWound = await applyDamageCriticalWound(actor, damage);
  }
  const criticalWoundSuppressed = derivedStat === "sta" && appliedCriticalBonus > 0;

  const armorNote = damageOptions.improvedArmorPiercing
    ? game.i18n.localize("WITCHER.Damage.improvedArmorPiercing")
    : "";
  const penetrationNote = ignoresArmor
    ? game.i18n.localize("WITCHER.Damage.ignoreArmor")
    : (damageOptions.improvedArmorPiercing || damageOptions.armorPiercing)
      ? game.i18n.localize("WITCHER.Damage.armorPiercing")
      : "";
  const messageContent = buildDamageResolutionContent({
    actor,
    derivedStat,
    adjustedDamage: infoTotalDmg !== rolledDamage ? infoTotalDmg : null,
    location: `${location.alias} x${location.locationFormula}`,
    stoppingPower: [displaySP, armorNote].filter(Boolean).join(" "),
    damageAfterArmor: [infoAfterSPReduction, penetrationNote].filter(Boolean).join(" "),
    damageAfterLocation: infoAfterLocation,
    damageAfterResistances: infoAfterResistance !== infoAfterLocation ? infoAfterResistance : null,
    criticalBonusDamage: appliedCriticalBonus,
    shieldBefore: shield > 0 ? shield : null,
    shieldAfter: shield > 0 ? 0 : null,
    appliedDamage,
    armorAblation,
    appliedEffects,
    appliedCriticalWound: appliedCriticalWound ? getCriticalWoundLabel(appliedCriticalWound.effect) : null,
    criticalWoundSuppressed,
    notes,
  });
  await appendDamageResolution(message, messageContent);
  return applicationResult;
}

function findDamageApplication(message, actor) {
  const actorUuid = actor?.uuid ?? actor?.id;
  const storedApplications = message.getFlag('thewitchertrpg', 'damageApplications');
  const applications = Array.isArray(storedApplications) ? storedApplications : [];
  return applications.find(application => application.actorUuid === actorUuid);
}

async function recordDamageApplication(message, actor, derivedStat) {
  const application = {
    actorUuid: actor?.uuid ?? actor?.id ?? null,
    derivedStat,
    resultMessageId: message?.id ?? null,
    appliedAt: Date.now(),
    userId: game.user.id,
  };
  const storedApplications = message.getFlag('thewitchertrpg', 'damageApplications');
  const applications = Array.isArray(storedApplications) ? storedApplications : [];

  try {
    await message.setFlag('thewitchertrpg', 'damageApplications', [...applications, application]);
  } catch (error) {
    console.warn("TheWitcherTRPG | Damage was applied, but its chat message could not be marked as resolved.", error);
  }

  return { status: "applied", application };
}

async function appendDamageResolution(message, resolutionContent) {
  try {
    await message.update({
      content: `${message.content ?? ""}${resolutionContent}`,
    });
  } catch (error) {
    console.warn("TheWitcherTRPG | Damage was applied, but its chat message could not be updated.", error);
  }
}

function buildDamageResolutionContent({
  actor,
  derivedStat,
  adjustedDamage = null,
  location,
  stoppingPower = null,
  damageAfterArmor = null,
  damageAfterLocation = null,
  damageAfterResistances = null,
  criticalBonusDamage = 0,
  shieldBefore = null,
  shieldAfter = null,
  appliedDamage = 0,
  armorAblation = [],
  appliedEffects = [],
  appliedCriticalWound = null,
  criticalWoundSuppressed = false,
  statusKey = null,
  notes = [],
}) {
  const rows = [
    damageResolutionRow("WITCHER.Damage.adjusted", adjustedDamage, adjustedDamage != null),
    damageResolutionRow("WITCHER.Damage.shield", `${shieldBefore} -> ${shieldAfter}`, shieldBefore != null),
    damageResolutionRow("WITCHER.Damage.CurrentLocation", location),
    damageResolutionRow("WITCHER.Damage.totalSP", stoppingPower, stoppingPower != null),
    damageResolutionRow("WITCHER.Damage.afterSPReduct", damageAfterArmor, damageAfterArmor != null),
    damageResolutionRow("WITCHER.Damage.afterLocationModifier", damageAfterLocation, damageAfterLocation != null),
    damageResolutionRow("WITCHER.Damage.afterResistances", damageAfterResistances, damageAfterResistances != null),
    damageResolutionRow("WITCHER.Damage.criticalBonus", `+${criticalBonusDamage}`, criticalBonusDamage > 0),
  ].filter(Boolean).join("");

  const resourceRows = [];
  if (armorAblation.length > 0) {
    const changes = armorAblation
      .map(change => `${change.name} (${location}): ${change.before} -> ${change.after}`)
      .join(", ");
    resourceRows.push(damageResolutionRow("WITCHER.Damage.ablated", changes));
  }
  if (appliedEffects.length > 0) {
    resourceRows.push(damageResolutionRow("WITCHER.Damage.appliedEffects", appliedEffects.join(", ")));
  }
  if (appliedCriticalWound) {
    resourceRows.push(damageResolutionRow("WITCHER.Damage.appliedCriticalWound", appliedCriticalWound));
  }
  if (criticalWoundSuppressed) {
    resourceRows.push(damageResolutionRow(
      "WITCHER.Chat.CriticalWound",
      game.i18n.localize("WITCHER.Damage.criticalWoundSuppressed")
    ));
  }

  const outcome = statusKey ? `
    <div class="damage-resolution-outcome">
      <i class="fas fa-shield-alt" aria-hidden="true"></i>
      <strong>${escapeHtml(game.i18n.localize(statusKey))}</strong>
    </div>` : "";
  const noteContent = notes.length > 0
    ? `<div class="damage-resolution-notes">${notes.map(note => `<span>${escapeHtml(note)}</span>`).join("")}</div>`
    : "";
  const details = resourceRows.length > 0
    ? `<div class="damage-resolution-details">${resourceRows.join("")}</div>`
    : "";

  return `
    <section class="damage-resolution-card ${appliedDamage > 0 ? "is-applied" : "is-absorbed"}" data-application-actor-uuid="${escapeHtml(actor?.uuid ?? actor?.id ?? "")}">
      <header class="damage-resolution-heading">
        <div class="damage-resolution-title">
          <i class="fas ${appliedDamage > 0 ? "fa-heart-broken" : "fa-shield-alt"}" aria-hidden="true"></i>
          <span>
            <strong>${escapeHtml(game.i18n.localize("WITCHER.Damage.resolution"))}</strong>
            <small>${escapeHtml(actor?.name ?? game.i18n.localize("WITCHER.Context.unavailable"))}</small>
          </span>
        </div>
        <div class="damage-resolution-total">
          <strong>${escapeHtml(appliedDamage)}</strong>
          <span>${escapeHtml(game.i18n.localize(derivedStat === "hp" ? "WITCHER.Damage.appliedToHealth" : "WITCHER.Damage.appliedToStamina"))}</span>
        </div>
      </header>
      <div class="damage-resolution-calculation">${rows}</div>
      ${outcome}
      ${details}
      ${noteContent}
    </section>`;
}

function damageResolutionRow(labelKey, value, visible = true) {
  if (!visible || value == null) return "";

  return `
    <div class="damage-resolution-row">
      <span>${escapeHtml(game.i18n.localize(labelKey))}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character]);
}

function getStatusEffectLabel(statusId) {
  const status = CONFIG.WITCHER.statusEffects.find(effect => effect.id === statusId);
  return game.i18n.localize(status?.name ?? status?.label ?? statusId);
}

function getCriticalWoundLabel(effect) {
  const label = WITCHER.CritSimple[effect]
    ?? WITCHER.CritComplex[effect]
    ?? WITCHER.CritDifficult[effect]
    ?? WITCHER.CritDeadly[effect]
    ?? effect;
  return game.i18n.localize(label);
}

function getDamageMessage(messageId, totalDamage) {
  const message = messageId ? game.messages.get(messageId) : null;
  if (message?.getFlag('thewitchertrpg', 'damage')) {
    return message;
  }

  const expectedTotal = Number(totalDamage);
  const messages = game.messages.contents ?? Array.from(game.messages);
  const damageMessages = messages
    .filter(message => message?.getFlag?.('thewitchertrpg', 'damage'))
    .reverse();

  const matchingMessage = damageMessages.find(message => {
    if (!Number.isFinite(expectedTotal)) return true;
    return message.rolls?.some(roll => Number(roll.total) === expectedTotal);
  });
  return matchingMessage ?? (!Number.isFinite(expectedTotal) ? damageMessages[0] : null);
}

function getArmors(armors) {
  let lightCount = 0, mediumCount = 0, heavyCount = 0;
  let lightArmor, mediumArmor, heavyArmor;
  armors.forEach(item => {
    if (item.system.type == "Light") {
      lightCount++;
      lightArmor = item
    }
    if (item.system.type == "Medium") {
      mediumCount++;
      mediumArmor = item
    }
    if (item.system.type == "Heavy") {
      heavyCount++;
      heavyArmor = item
    }
  });
  if (lightCount > 1 || mediumCount > 1 || heavyCount > 1) {
    ui.notifications.error(game.i18n.localize("WITCHER.Armor.tooMuch"))
    return
  }
  return {
    lightArmor: lightArmor,
    mediumArmor: mediumArmor,
    heavyArmor: heavyArmor
  };
}

function getArmorSp(armorSet, location) {
  return getStackedArmorSp(armorSet["lightArmor"]?.system[location], armorSet["mediumArmor"]?.system[location], armorSet["heavyArmor"]?.system[location])
}

async function ablateArmorSet(actor, armorSet, location, amount) {
  const locationFields = {
    "Head": "headStopping",
    "Torso": "torsoStopping",
    "R. Arm": "rightArmStopping",
    "L. Arm": "leftArmStopping",
    "R. Leg": "rightLegStopping",
    "L. Leg": "leftLegStopping",
  };
  const field = locationFields[location];
  amount = Math.max(0, normalizeSp(amount));
  if (!field || amount === 0) return [];

  const changes = [];
  const updates = [];
  for (const armor of Object.values(armorSet).filter(Boolean)) {
    const before = Math.max(0, normalizeSp(armor.system[field]));
    const after = Math.max(0, before - amount);
    if (after === before) continue;

    changes.push({ name: armor.name, field, before, after });
    updates.push({ _id: armor.id, [`system.${field}`]: after });
  }

  if (updates.length > 0) {
    await actor.updateEmbeddedDocuments("Item", updates);
  }

  return changes;
}

async function ablateMonsterArmor(actor, field, amount) {
  amount = Math.max(0, normalizeSp(amount));
  const before = Math.max(0, normalizeSp(actor.system[field]));
  const after = Math.max(0, before - amount);
  if (!field || amount === 0 || after === before) return [];

  await actor.update({ [`system.${field}`]: after });
  return [{
    name: game.i18n.localize("WITCHER.Armor.Natural"),
    field,
    before,
    after
  }];
}

function getStackedArmorSp(lightArmorSP, mediumArmorSP, heavyArmorSP) {
  let totalSP = 0
  let displaySP = 0
  lightArmorSP = normalizeSp(lightArmorSP)
  mediumArmorSP = normalizeSp(mediumArmorSP)
  heavyArmorSP = normalizeSp(heavyArmorSP)

  if (heavyArmorSP > 0) {
    totalSP = heavyArmorSP
    displaySP = heavyArmorSP
  }

  if (mediumArmorSP > 0) {
    if (heavyArmorSP > 0) {
      let diff = getArmorDiffBonus(heavyArmorSP, mediumArmorSP)
      totalSP = Number(totalSP) + Number(diff)
      displaySP += "+" + diff
    }
    else {
      displaySP = mediumArmorSP
      totalSP = mediumArmorSP
    }
  }

  if (lightArmorSP > 0) {
    if (mediumArmorSP > 0) {
      let diff = getArmorDiffBonus(mediumArmorSP, lightArmorSP)
      totalSP = Number(totalSP) + Number(diff)
      displaySP += `+${diff}[${game.i18n.localize("WITCHER.Armor.LayerBonus")}]`
    }
    else if (heavyArmorSP > 0) {
      let diff = getArmorDiffBonus(heavyArmorSP, lightArmorSP)
      totalSP = Number(totalSP) + Number(diff)
      displaySP += `+${diff}[${game.i18n.localize("WITCHER.Armor.LayerBonus")}]`
    }
    else {
      totalSP = lightArmorSP
      displaySP = lightArmorSP
    }
  }
  return [displaySP, totalSP]
}

function isArmorEquipped(armor) {
  const equipped = armor.system.equipped;
  return equipped === true || equipped === "true" || equipped === "checked" || equipped === 1 || equipped === "1";
}

function armorProtectsLocation(armor, ...locations) {
  return locations.includes(String(armor.system.location ?? "").trim());
}

function normalizeSp(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function appendSp(displaySp, value) {
  const numeric = normalizeSp(value);
  if (numeric <= 0) return displaySp;
  return displaySp === "" || displaySp === 0 ? String(numeric) : `${displaySp}+${numeric}`;
}

function getArmorDiffBonus(OverArmor, UnderArmor) {
  let diff = OverArmor - UnderArmor

  if (UnderArmor <= 0 || OverArmor <= 0) {
    return 0
  }

  if (diff < 0) { diff *= -1 }

  if (diff > 20) {
    return 0
  } else if (diff > 15) {
    return 2
  } else if (diff > 9) {
    return 3
  } else if (diff > 5) {
    return 4
  } else if (diff >= 0) {
    return 5
  }
  return 0

}

function ExecuteDefence(actor, attackType, location, totalAttack, attackMessageId, spellDefence = "", resolutionContext = {}) {
  if (!actor) {
    return ui.notifications.error(game.i18n.localize("WITCHER.Context.SelectActor"));
  }

  let displayRollDetails = game.settings.get("thewitchertrpg", "displayRollsDetails")
  totalAttack = Number(totalAttack);

  let weapons = actor.items.filter(function (item) { return item.type == "weapon" && !item.system.isAmmo && WITCHER.meleeSkills.includes(item.system.attackSkill) });
  let shields = actor.items.filter(function (item) { return item.type == "armor" && item.system.location == "Shield" });
  let options = `<option value="Brawling"> ${game.i18n.localize("WITCHER.SkRefBrawling")} </option>`;
  weapons.forEach(item => options += `<option value="${item.system.attackSkill}" itemId="${item.id}" type="Weapon"> ${item.name} (${item.getItemAttackSkill().alias})</option>`);
  shields.forEach(item => options += `<option value="Melee" itemId="${item.id}" type="Shield"> ${item.name} (${game.i18n.localize("WITCHER.SkRefMelee")})</option>`);

  const content = `
    <div class="witcher-defence-dialog-content">
      <div class="flex">
        <label>${game.i18n.localize("WITCHER.Dialog.DefenseExtra")}: <input type="checkbox" name="isExtraDefense"></label> <br />
      </div>
      <label>${game.i18n.localize("WITCHER.Dialog.DefenseWith")}: </label><select name="form">${options}</select><br />
      <label>${game.i18n.localize("WITCHER.Dialog.attackCustom")}: <input type="Number" class="small" name="customDef" value=0></label> <br />
    </div>`;

  let messageData = {
    speaker: ChatMessage.getSpeaker({ actor: actor }),
    flavor: `<h1>${game.i18n.localize("WITCHER.Dialog.Defense")}</h1>`,
  }

  return renderApplication(new WitcherDialog({
    title: `${game.i18n.localize("WITCHER.Dialog.DefenseTitle")}`,
    content,
    buttons: restrictDefenceButtons({
      Dodge: {
        label: `${game.i18n.localize("WITCHER.Dialog.ButtonDodge")}`,
        callback: async html => {
          let isExtraDefence = html.find("[name=isExtraDefense]").prop("checked");
          let customDef = html.find("[name=customDef]")[0].value;
          if (isExtraDefence) {
            let newSta = actor.system.derivedStats.sta.value - 1
            if (newSta < 0) {
              return ui.notifications.error(game.i18n.localize("WITCHER.Spell.notEnoughSta"));
            }
            await actor.update({
              'system.derivedStats.sta.value': newSta
            });
          }
          let stat = actor.system.stats.ref.current;
          let skill = actor.system.skills.ref.dodge;
          let skillValue = skill.value;
          let displayFormula = `1d10 + ${game.i18n.localize("WITCHER.Actor.Stat.Ref")} + ${game.i18n.localize("WITCHER.SkRefDodge")}`;
          messageData.flavor = `<h1>${game.i18n.localize("WITCHER.Dialog.Defense")}: ${game.i18n.localize("WITCHER.Dialog.ButtonDodge")}</h1><p>${displayFormula}</p>`;
          let rollFormula = !displayRollDetails ? `1d10+${stat}+${skillValue}` : `1d10+${stat}[${game.i18n.localize("WITCHER.Actor.Stat.Ref")}]+${skillValue}[${game.i18n.localize("WITCHER.SkRefDodge")}]`;

          if (customDef != "0") {
            rollFormula += !displayRollDetails ? `+${customDef}` : `+${customDef}[${game.i18n.localize("WITCHER.Settings.Custom")}]`;
          }

          rollFormula = addModifiers(skill.modifiers, rollFormula)
          rollFormula = addActorSkillEffectModifiers(actor, skill, rollFormula)

          let config = new RollConfig()
          config.showCrit = true
          config.showSuccess = true
          config.defence = true
          config.threshold = Number.isFinite(totalAttack) ? totalAttack : -1
          config.thresholdDesc = skill.label
          config.flagsOnSuccess = actor.getDefenceSuccessFlags(skill)
          config.flagsOnFailure = actor.getDefenceFailFlags(skill)
          config.hitLocation = location
          configureDefenceSource(config, actor, attackMessageId, resolutionContext)

          await extendedRoll(rollFormula, messageData, config)
        }
      },
      Reposition: {
        label: `${game.i18n.localize("WITCHER.Dialog.ButtonReposition")}`,
        callback: async html => {
          let isExtraDefence = html.find("[name=isExtraDefense]").prop("checked");
          let customDef = html.find("[name=customDef]")[0].value;
          if (isExtraDefence) {
            let newSta = actor.system.derivedStats.sta.value - 1
            if (newSta < 0) {
              return ui.notifications.error(game.i18n.localize("WITCHER.Spell.notEnoughSta"));
            }
            await actor.update({
              'system.derivedStats.sta.value': newSta
            });
          }
          let stat = actor.system.stats.dex.current;
          let skill = actor.system.skills.dex.athletics;
          let skillValue = skill.value;
          let displayFormula = `1d10 + ${game.i18n.localize("WITCHER.StDex")} + ${game.i18n.localize("WITCHER.SkDexAthletics")}`;
          messageData.flavor = `<h1>${game.i18n.localize("WITCHER.Dialog.Defense")}: ${game.i18n.localize("WITCHER.Dialog.ButtonReposition")}</h1><p>${displayFormula}</p>`;
          let rollFormula = !displayRollDetails ? `1d10+${stat}+${skillValue}` : `1d10+${stat}[${game.i18n.localize("WITCHER.StDex")}]+${skillValue}[${game.i18n.localize("WITCHER.SkDexAthletics")}]`;

          if (customDef != "0") {
            rollFormula += !displayRollDetails ? `+${customDef}` : `+${customDef}[${game.i18n.localize("WITCHER.Settings.Custom")}]`;
          }

          rollFormula = addModifiers(skill.modifiers, rollFormula)
          rollFormula = addActorSkillEffectModifiers(actor, skill, rollFormula)

          let config = new RollConfig()
          config.showCrit = true
          config.showSuccess = true
          config.defence = true
          config.threshold = Number.isFinite(totalAttack) ? totalAttack : -1
          config.thresholdDesc = skill.label
          config.flagsOnSuccess = actor.getDefenceSuccessFlags(skill)
          config.flagsOnFailure = actor.getDefenceFailFlags(skill)
          config.hitLocation = location
          configureDefenceSource(config, actor, attackMessageId, resolutionContext)

          await extendedRoll(rollFormula, messageData, config)
        }
      },
      Block: {
        label: `${game.i18n.localize("WITCHER.Dialog.ButtonBlock")}`,
        callback: async html => {
          let isExtraDefence = html.find("[name=isExtraDefense]").prop("checked");
          let customDef = html.find("[name=customDef]")[0].value;
          if (isExtraDefence) {
            let newSta = actor.system.derivedStats.sta.value - 1
            if (newSta < 0) {
              return ui.notifications.error(game.i18n.localize("WITCHER.Spell.notEnoughSta"));
            }
            await actor.update({
              'system.derivedStats.sta.value': newSta
            });
          }
          let defence = html.find("[name=form]")[0].value;
          const selectedBlockOption = html.find("[name=form]")[0].selectedOptions[0];
          const blockItemId = selectedBlockOption.getAttribute('itemid');
          const blockItemType = selectedBlockOption.getAttribute('type');
          let stat = actor.system.stats.ref.current;
          let skill = actor.system.skills.ref[defence.toLowerCase().replace('/', '').replace(' ', '')];
          let skillValue = skill.value;
          let skillName = skill.label;
          let modifiers = skill.modifiers
          let displayFormula = `1d10 + ${game.i18n.localize("WITCHER.Actor.Stat.Ref")}`;
          switch (defence) {
            case "Brawling":
              displayFormula += `${game.i18n.localize("WITCHER.SkRefBrawling")}`;
              break;
            case "Melee":
              displayFormula = `${game.i18n.localize("WITCHER.SkRefMelee")}`;
              break;
            case "Swordsmanship":
              displayFormula = `${game.i18n.localize("WITCHER.SkRefSwordsmanship")}`;
              break;
            case "Small Blades":
              displayFormula = `${game.i18n.localize("WITCHER.SkRefSmall")}`;
              break;
            case "Staff/Spear":
              displayFormula = `${game.i18n.localize("WITCHER.SkRefStaff")}`;
              break;
          }

          messageData.flavor = `<h1>${game.i18n.localize("WITCHER.Dialog.Defense")}: ${game.i18n.localize("WITCHER.Dialog.ButtonBlock")}</h1><p>${displayFormula}</p>`;
          let rollFormula = !displayRollDetails ? `1d10+${stat}+${skillValue}` : `1d10+${stat}[${game.i18n.localize("WITCHER.Actor.Stat.Ref")}]+${skillValue}[${game.i18n.localize(skillName)}]`;

          if (customDef != "0") {
            rollFormula += !displayRollDetails ? `+${customDef}` : `+${customDef}[${game.i18n.localize("WITCHER.Settings.Custom")}]`;
          }

          rollFormula = addModifiers(modifiers, rollFormula)
          rollFormula = addActorSkillEffectModifiers(actor, skill, rollFormula)

          let config = new RollConfig()
          config.showCrit = true
          config.showSuccess = true
          config.defence = true
          config.threshold = Number.isFinite(totalAttack) ? totalAttack : -1
          config.thresholdDesc = skill.label
          config.flagsOnSuccess = actor.getDefenceSuccessFlags(skill)
          config.flagsOnFailure = actor.getDefenceFailFlags(skill)
          config.hitLocation = location
          configureDefenceSource(config, actor, attackMessageId, resolutionContext)
          config.rerollData.blockItemId = blockItemId;
          config.rerollData.blockItemType = blockItemType;
          appendOnResolved(config, async ({ messageData, success }) => {
            if (success) {
              await applySuccessfulBlockWear(actor, blockItemId, blockItemType, messageData);
            }
          })

          await extendedRoll(rollFormula, messageData, config)
        }
      },
      Parry: {
        label: `${game.i18n.localize("WITCHER.Dialog.ButtonParry")}`,
        callback: async html => {
          let isExtraDefence = html.find("[name=isExtraDefense]").prop("checked");
          let customDef = html.find("[name=customDef]")[0].value;
          if (isExtraDefence) {
            let newSta = actor.system.derivedStats.sta.value - 1
            if (newSta < 0) {
              return ui.notifications.error(game.i18n.localize("WITCHER.Spell.notEnoughSta"));
            }
            await actor.update({
              'system.derivedStats.sta.value': newSta
            });
          }
          let defence = html.find("[name=form]")[0].value;
          let stat = actor.system.stats.ref.current;
          let skill = actor.system.skills.ref[defence.toLowerCase().replace('/', '').replace(' ', '')];
          let skillValue = skill.value;
          let skillName = skill.label;
          let modifiers = skill.modifiers
          let displayFormula = `1d10 + ${game.i18n.localize("WITCHER.Actor.Stat.Ref")} + ${game.i18n.localize("WITCHER.Dialog.ButtonParry")}`;
          switch (defence) {
            case "Brawling":
              displayFormula = `1d10 + ${game.i18n.localize("WITCHER.Actor.Stat.Ref")} + ${game.i18n.localize("WITCHER.SkRefBrawling")} - 3`;
              break;
            case "Melee":
              displayFormula = `1d10 + ${game.i18n.localize("WITCHER.Actor.Stat.Ref")} + ${game.i18n.localize("WITCHER.SkRefMelee")} - 3`;
              break;
            case "Small Blades":
              displayFormula = `1d10 + ${game.i18n.localize("WITCHER.Actor.Stat.Ref")} + ${game.i18n.localize("WITCHER.SkRefSmall")} - 3`;
              break;
            case "Staff/Spear":
              displayFormula = `1d10 + ${game.i18n.localize("WITCHER.Actor.Stat.Ref")} + ${game.i18n.localize("WITCHER.SkRefStaff")} - 3`;
              break;
            case "Swordsmanship":
              displayFormula = `1d10 + ${game.i18n.localize("WITCHER.Actor.Stat.Ref")} + ${game.i18n.localize("WITCHER.SkRefSwordsmanship")} - 3`;
              break;
          }

          messageData.flavor = `<h1>${game.i18n.localize("WITCHER.Dialog.Defense")}: ${game.i18n.localize("WITCHER.Dialog.ButtonParry")}</h1><p>${displayFormula}</p>`;
          let rollFormula = !displayRollDetails ? `1d10+${stat}+${skillValue}-3` : `1d10+${stat}[${game.i18n.localize("WITCHER.Actor.Stat.Ref")}]+${skillValue}[${game.i18n.localize(skillName)}]-3[${game.i18n.localize("WITCHER.Dialog.ButtonParry")}]`;

          if (customDef != "0") {
            rollFormula += !displayRollDetails ? `+${customDef}` : `+${customDef}[${game.i18n.localize("WITCHER.Settings.Custom")}]`;
          }

          rollFormula = addModifiers(modifiers, rollFormula)
          rollFormula = addActorSkillEffectModifiers(actor, skill, rollFormula)

          let config = new RollConfig()
          config.showCrit = true
          config.showSuccess = true
          config.defence = true
          config.threshold = Number.isFinite(totalAttack) ? totalAttack : -1
          config.thresholdDesc = skill.label
          config.flagsOnSuccess = actor.getDefenceSuccessFlags(skill)
          config.flagsOnFailure = actor.getDefenceFailFlags(skill)
          config.hitLocation = location
          configureDefenceSource(config, actor, attackMessageId, resolutionContext)

          await extendedRoll(rollFormula, messageData, config)
        }
      },
      ParryAgainstThrown: {
        label: `${game.i18n.localize("WITCHER.Dialog.ButtonParryThrown")}`,
        callback: async html => {
          let isExtraDefence = html.find("[name=isExtraDefense]").prop("checked");
          let customDef = html.find("[name=customDef]")[0].value;
          if (isExtraDefence) {
            let newSta = actor.system.derivedStats.sta.value - 1
            if (newSta < 0) {
              return ui.notifications.error(game.i18n.localize("WITCHER.Spell.notEnoughSta"));
            }
            await actor.update({
              'system.derivedStats.sta.value': newSta
            });
          }
          let defence = html.find("[name=form]")[0].value;
          let stat = actor.system.stats.ref.current;
          let skill = actor.system.skills.ref[defence.toLowerCase().replace('/', '').replace(' ', '')];
          let skillValue = skill.value;
          let skillName = skill.label;
          let modifiers = skill.modifiers
          let displayFormula = `1d10 + ${game.i18n.localize("WITCHER.Actor.Stat.Ref")} + ${game.i18n.localize("WITCHER.Dialog.ButtonParryThrown")}`;
          switch (defence) {
            case "Brawling":
              displayFormula = `1d10 + ${game.i18n.localize("WITCHER.Actor.Stat.Ref")} + ${game.i18n.localize("WITCHER.SkRefBrawling")} - 5`;
              break;
            case "Melee":
              displayFormula = `1d10 + ${game.i18n.localize("WITCHER.Actor.Stat.Ref")} + ${game.i18n.localize("WITCHER.SkRefMelee")} - 5`;
              break;
            case "Small Blades":
              displayFormula = `1d10 + ${game.i18n.localize("WITCHER.Actor.Stat.Ref")} + ${game.i18n.localize("WITCHER.SkRefSmall")} - 5`;
              break;
            case "Staff/Spear":
              displayFormula = `1d10 + ${game.i18n.localize("WITCHER.Actor.Stat.Ref")} + ${game.i18n.localize("WITCHER.SkRefStaff")} - 5`;
              break;
            case "Swordsmanship":
              displayFormula = `1d10 + ${game.i18n.localize("WITCHER.Actor.Stat.Ref")} + ${game.i18n.localize("WITCHER.SkRefSwordsmanship")} - 5`;
              break;
          }

          messageData.flavor = `<h1>${game.i18n.localize("WITCHER.Dialog.Defense")}: ${game.i18n.localize("WITCHER.Dialog.ButtonParryThrown")}</h1><p>${displayFormula}</p>`;
          let rollFormula = !displayRollDetails ? `1d10+${stat}+${skillValue}-5` : `1d10+${stat}[${game.i18n.localize("WITCHER.Actor.Stat.Ref")}]+${skillValue}[${game.i18n.localize(skillName)}]-5[${game.i18n.localize("WITCHER.Dialog.ButtonParryThrown")}]`;

          if (customDef != "0") {
            rollFormula += !displayRollDetails ? `+${customDef}` : `+${customDef}[${game.i18n.localize("WITCHER.Settings.Custom")}]`;
          }

          rollFormula = addModifiers(modifiers, rollFormula)
          rollFormula = addActorSkillEffectModifiers(actor, skill, rollFormula)

          let config = new RollConfig()
          config.showCrit = true
          config.showSuccess = true
          config.defence = true
          config.threshold = Number.isFinite(totalAttack) ? totalAttack : -1
          config.thresholdDesc = skill.label
          config.flagsOnSuccess = actor.getDefenceSuccessFlags(skill)
          config.flagsOnFailure = actor.getDefenceFailFlags(skill)
          config.hitLocation = location
          configureDefenceSource(config, actor, attackMessageId, resolutionContext)

          await extendedRoll(rollFormula, messageData, config)
        }
      },
      MagicResist: {
        label: `${game.i18n.localize("WITCHER.Dialog.ButtonMagicResist")}`,
        callback: async html => {
          let isExtraDefence = html.find("[name=isExtraDefense]").prop("checked");
          let customDef = html.find("[name=customDef]")[0].value;
          if (isExtraDefence) {
            let newSta = actor.system.derivedStats.sta.value - 1
            if (newSta < 0) {
              return ui.notifications.error(game.i18n.localize("WITCHER.Spell.notEnoughSta"));
            }
            await actor.update({
              'system.derivedStats.sta.value': newSta
            });
          }
          let stat = actor.system.stats.will.current;
          let skill = actor.system.skills.will.resistmagic;
          let skillValue = skill.value;
          let displayFormula = `1d10 + ${game.i18n.localize("WITCHER.Actor.Stat.Will")} + ${game.i18n.localize("WITCHER.SkWillResistMagLable")}`;
          messageData.flavor = `<h1>${game.i18n.localize("WITCHER.Dialog.Defense")}: ${game.i18n.localize("WITCHER.Dialog.ButtonMagicResist")}</h1><p>${displayFormula}</p>`;
          let rollFormula = !displayRollDetails ? `1d10+${stat}+${skillValue}` : `1d10+${stat}[${game.i18n.localize("WITCHER.Actor.Stat.Will")}]+${skillValue}[${game.i18n.localize("WITCHER.SkWillResistMagLable")}]`;

          if (customDef != "0") {
            rollFormula += !displayRollDetails ? `+${customDef}` : `+${customDef}[${game.i18n.localize("WITCHER.Settings.Custom")}]`;
          }

          rollFormula = addModifiers(skill.modifiers, rollFormula)
          rollFormula = addActorSkillEffectModifiers(actor, "WITCHER.SkWillResistMagLable", rollFormula)

          let config = new RollConfig()
          config.showCrit = true
          config.showSuccess = true
          config.defence = true
          config.threshold = Number.isFinite(totalAttack) ? totalAttack : -1
          config.thresholdDesc = skill.label
          config.flagsOnSuccess = actor.getDefenceSuccessFlags(skill)
          config.flagsOnFailure = actor.getDefenceFailFlags(skill)
          config.hitLocation = location
          configureDefenceSource(config, actor, attackMessageId, resolutionContext)

          await extendedRoll(rollFormula, messageData, config)
        }
      },
      SpellCasting: {
        label: `${game.i18n.localize("WITCHER.SkWillSpellcastLable")}`,
        callback: async html => {
          let isExtraDefence = html.find("[name=isExtraDefense]").prop("checked");
          let customDef = html.find("[name=customDef]")[0].value;
          if (isExtraDefence) {
            let newSta = actor.system.derivedStats.sta.value - 1
            if (newSta < 0) {
              return ui.notifications.error(game.i18n.localize("WITCHER.Spell.notEnoughSta"));
            }
            await actor.update({ 'system.derivedStats.sta.value': newSta });
          }
          let stat = actor.system.stats.will.current;
          let skill = actor.system.skills.will.spellcast;
          let skillValue = skill.value;
          let displayFormula = `1d10 + ${game.i18n.localize("WITCHER.Actor.Stat.Will")} + ${game.i18n.localize("WITCHER.SkWillSpellcastLable")}`;
          messageData.flavor = `<h1>${game.i18n.localize("WITCHER.Dialog.Defense")}: ${game.i18n.localize("WITCHER.SkWillSpellcastLable")}</h1><p>${displayFormula}</p>`;
          let rollFormula = !displayRollDetails ? `1d10+${stat}+${skillValue}` : `1d10+${stat}[${game.i18n.localize("WITCHER.Actor.Stat.Will")}]+${skillValue}[${game.i18n.localize("WITCHER.SkWillSpellcastLable")}]`;

          if (customDef != "0") {
            rollFormula += !displayRollDetails ? `+${customDef}` : `+${customDef}[${game.i18n.localize("WITCHER.Settings.Custom")}]`;
          }

          rollFormula = addModifiers(skill.modifiers, rollFormula)
          rollFormula = addActorSkillEffectModifiers(actor, "WITCHER.SkWillSpellcastLable", rollFormula)

          let config = new RollConfig()
          config.showCrit = true
          config.showSuccess = true
          config.defence = true
          config.threshold = Number.isFinite(totalAttack) ? totalAttack : -1
          config.thresholdDesc = skill.label
          config.flagsOnSuccess = actor.getDefenceSuccessFlags(skill)
          config.flagsOnFailure = actor.getDefenceFailFlags(skill)
          config.hitLocation = location
          configureDefenceSource(config, actor, attackMessageId, resolutionContext)

          await extendedRoll(rollFormula, messageData, config)
        }
      },
    }, spellDefence)
  }, {
    width: Math.min(760, Math.max(360, Number(globalThis.innerWidth ?? 792) - 32)),
    resizable: true,
    classes: ["dialog", "witcher-defence-dialog"],
  }))
}

async function applySuccessfulBlockWear(actor, itemId, itemType, messageData) {
  if (!itemId) return null;

  const item = actor.items.get(itemId);
  const reliabilityField = itemType === "Weapon" ? "reliable" : "reliability";
  const currentReliability = Number(item?.system?.[reliabilityField]);
  if (!item || !Number.isFinite(currentReliability)) {
    ui.notifications.error(game.i18n.localize("WITCHER.Chat.BlockWearFailed"));
    return null;
  }

  const remainingReliability = Math.max(0, currentReliability - 1);
  try {
    await item.update({ [`system.${reliabilityField}`]: remainingReliability });
  } catch (error) {
    console.error("TheWitcherTRPG | Failed to reduce reliability after a successful block.", error);
    ui.notifications.error(game.i18n.localize("WITCHER.Chat.BlockWearFailed"));
    return null;
  }

  const broken = remainingReliability <= 0;
  const blockWear = {
    actorUuid: actor.uuid ?? actor.id ?? null,
    itemId: item.id,
    itemName: item.name,
    itemType,
    reliabilityBefore: currentReliability,
    reliabilityAfter: remainingReliability,
    broken,
  };

  messageData.flags ??= {};
  messageData.flags.thewitchertrpg ??= {};
  messageData.flags.thewitchertrpg.blockWear = blockWear;
  messageData.flavor += `
    <div class="block-wear-result${broken ? " is-broken" : ""}">
      <div class="block-wear-heading">
        <i class="fas fa-shield-alt" aria-hidden="true"></i>
        <strong>${game.i18n.localize("WITCHER.Chat.BlockEquipment")}: ${item.name}</strong>
      </div>
      <div class="block-wear-line">
        <span>${game.i18n.localize("WITCHER.Weapon.Reliability")}</span>
        <strong>${currentReliability} -> ${remainingReliability}</strong>
      </div>
      ${broken ? `<div class="block-wear-broken">${game.i18n.localize(itemType === "Weapon" ? "WITCHER.Weapon.Broken" : "WITCHER.Shield.Broken")}</div>` : ""}
    </div>`;

  if (broken) {
    ui.notifications.error(game.i18n.localize(itemType === "Weapon" ? "WITCHER.Weapon.Broken" : "WITCHER.Shield.Broken"));
  }

  return blockWear;
}

function configureDefenceSource(config, actor, attackMessageId, resolutionContext = {}) {
  config.sourceAttackMessageId = attackMessageId ?? null;
  config.targetActorUuid = actor?.uuid ?? actor?.id ?? null;
  config.targetTokenUuid = resolutionContext.targetTokenUuid ?? null;
  config.rerollData = {
    kind: "defence",
    sourceAttackMessageId: config.sourceAttackMessageId,
    targetActorUuid: config.targetActorUuid,
    targetTokenUuid: config.targetTokenUuid,
  };
  if (config.sourceAttackMessageId && config.targetTokenUuid) {
    appendOnResolved(config, async ({ messageData }) => {
      const resolution = messageData.flags?.thewitchertrpg?.defenceResolution;
      if (resolution) {
        await updateSpellAreaTargetDefence(config.sourceAttackMessageId, config.targetTokenUuid, resolution);
      }
    });
  }
}

function appendOnResolved(config, callback) {
  const previous = config.onResolved;
  config.onResolved = async payload => {
    if (typeof previous === "function") await previous(payload);
    await callback(payload);
  };
}

export { ExecuteDefence, ApplyNormalDamage, ApplyNonLethalDamage, applySuccessfulBlockWear };
