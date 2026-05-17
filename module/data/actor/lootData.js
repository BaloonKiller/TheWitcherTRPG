import currency from "./templates/common/currencyData.js";
import currencyLedgerEntry from "./templates/common/currencyLedgerEntryData.js";

const fields = foundry.data.fields;

export default class LootData extends foundry.abstract.TypeDataModel{

    static defineSchema() {

        return {
          maxWeight: new fields.NumberField({initial: 0}),
          description: new fields.StringField({initial: ''}),
          currency: new fields.SchemaField(currency()),
          currencyLedger: new fields.ArrayField(new fields.SchemaField(currencyLedgerEntry())),
        }
  }
}
