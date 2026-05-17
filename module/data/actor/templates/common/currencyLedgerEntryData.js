const fields = foundry.data.fields;

export default function currencyLedgerEntry() {
  return {
    id: new fields.StringField({ initial: "" }),
    currency: new fields.StringField({ initial: "crown" }),
    amount: new fields.NumberField({ initial: 0 }),
    direction: new fields.StringField({ initial: "add" }),
    reason: new fields.StringField({ initial: "" }),
    balanceBefore: new fields.NumberField({ initial: 0 }),
    balanceAfter: new fields.NumberField({ initial: 0 }),
    createdAt: new fields.StringField({ initial: "" }),
    userId: new fields.StringField({ initial: "" }),
    userName: new fields.StringField({ initial: "" }),
  };
}
