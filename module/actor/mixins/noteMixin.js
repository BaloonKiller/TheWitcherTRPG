export let noteMixin = {

  async _onNoteAdd() {
    let notes = foundry.utils.deepClone(this.actor.system.notes ?? [])
    notes.push({
      title: '',
      details: ''
    })
    await this.actor.update({ "system.notes": notes });
  },

  async _onNoteDelete(event) {
    let noteIndex = event.currentTarget.dataset.noteIndex;
    let notes = foundry.utils.deepClone(this.actor.system.notes ?? [])
    if (noteIndex < 0 || noteIndex >= notes.length) return;
    notes.splice(noteIndex, 1)
    await this.actor.update({ "system.notes": notes });
  },

  noteListener(html) {
    html.find(".add-note").on("click", this._onNoteAdd.bind(this));
    html.find(".delete-note").on("click", this._onNoteDelete.bind(this));
  }

}
