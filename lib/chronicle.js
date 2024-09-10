// @ts-check
const {Elf} = require('xcraft-core-goblin');
const {id} = require('xcraft-core-goblin/lib/types.js');
const {string} = require('xcraft-core-stones');
const fse = require('fs-extra');
const {
  WorkflowInstance,
  WorkflowInstanceLogic,
} = require('goblin-yennefer/lib/workflow/workflowInstance.js');
const {WorkflowLogic} = require('goblin-yennefer/lib/workflow/workflow.js');
const {Engine} = require('bpmn-engine');
const {Chest} = require('goblin-chest/lib/chest.js');
const {
  ChestObjectLogic,
  ChestObjectShape,
} = require('goblin-chest/lib/chestObject.js');

class ChronicleShape {
  id = string;
  WorkflowInstanceId = id('workflowInstance');
}

class ChronicleState extends Elf.Sculpt(ChronicleShape) {}

class ChronicleLogic extends Elf.Spirit {
  state = new ChronicleState({
    id: undefined,
    WorkflowInstanceId: undefined,
  });

  create(id, WorkflowInstanceId) {
    const {state} = this;
    state.id = id;
    state.WorkflowInstanceId = WorkflowInstanceId;
  }
}

class Chronicle extends Elf {
  logic = Elf.getLogic(ChronicleLogic);
  state = new ChronicleState();

  /** @type {WorkflowInstance} */ _workflowInstance;
  _bpmnEngine;

  async create(id, desktopId, workflowInstanceId) {
    if (!workflowInstanceId) {
      throw new Error('A chronicle cannot be created without workflow');
    }

    const feedId = Elf.createFeed();
    this.quest.goblin.defer(async () => await this.killFeed(feedId));

    this._workflowInstance = await new WorkflowInstance(this).create(
      workflowInstanceId,
      feedId
    );
    this.logic.create(id, workflowInstanceId);

    const instanceState = await this.cryo.getState(
      WorkflowInstanceLogic.db,
      workflowInstanceId
    );
    if (!instanceState) {
      throw new Error(`${workflowInstanceId} must exists`);
    }

    const {workflowId, data} = instanceState;

    const workflowState = await this.cryo.getState(
      WorkflowLogic.db,
      workflowId
    );
    if (!workflowState) {
      throw new Error(`${workflowId} must exists`);
    }

    const {name, sourceName} = workflowState;

    /* Retrieve the chestObjectId according to the sourceName */
    const bpmns = await this.cryo.reader(ChestObjectLogic.db);
    const chestObjectId = bpmns
      .queryArchetype('chestObject', ChestObjectShape)
      .field('id')
      .where((object) => object.get('name').eq(sourceName))
      .get();
    if (!chestObjectId) {
      throw new Error(
        `Impossible to retrieve the chestObjectId of ${sourceName}`
      );
    }

    /* Retrieve the BPMN file according to the chestObjectId */
    const chest = await new Chest(this);
    const location = await chest.locationTry(chestObjectId);
    const source = fse.readFileSync(location, 'utf8');

    this._bpmnEngine = data
      ? new Engine().recover(data) /* Restore a state machine */
      : new Engine({name, source}); /* New state machine */

    return this;
  }
}

module.exports = {Chronicle, ChronicleLogic};
