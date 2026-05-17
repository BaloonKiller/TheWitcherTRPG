// @ts-check
export var RollConfig = (function () {
    class RollConfig {
        constructor() {
            this.defence = false;
            this.opposedDefence = false;
            this.threshold = -1;
            this.showCrit = true;
            this.showSuccess = true;
            this.showResult = true;
            this.reversal = false;
            this.tiesSucceed = false;
            this.thresholdDesc = "";
            this.messageOnSuccess = "";
            this.messageOnFailure = "";
            this.flagsOnSuccess = "";
            this.flagsOnFailure = "";
            this.hitLocation = "";
            this.sourceAttackMessageId = null;
            this.targetActorUuid = null;
            this.targetTokenUuid = null;
            this.onResolved = null;
            this.rerollable = null;
            this.rerollData = null;
            this.rerollChain = null;
            this.returnMessage = false;
        }
    }
    return RollConfig;
})();
