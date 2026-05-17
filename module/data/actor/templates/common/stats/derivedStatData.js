import modifier from "../modifierData.js";

const fields = foundry.data.fields;

export default function derivedStat(label, options = {}) {
    const valueOptions = { initial: 0 };
    if (Number.isFinite(options.min)) valueOptions.min = options.min;

    return {
        max: new fields.NumberField({ initial: 0}),
        unmodifiedMax: new fields.NumberField({ initial: 0}),
        value: new fields.NumberField(valueOptions),
        label: new fields.StringField({ initial: label}),
        modifiers: new fields.ArrayField(new fields.SchemaField(modifier()))
    };
  }
