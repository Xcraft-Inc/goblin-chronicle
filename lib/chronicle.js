// @ts-check
const {Elf} = require('xcraft-core-goblin');
const {id} = require('xcraft-core-goblin/lib/types.js');
const {string} = require('xcraft-core-stones');
const fse = require('fs-extra');
const {EventEmitter} = require('node:events');
const {promisify} = require('node:util');
const {
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
  workflowInstanceId = id('workflowInstance');
}

class ChronicleState extends Elf.Sculpt(ChronicleShape) {}

class ChronicleLogic extends Elf.Spirit {
  state = new ChronicleState({
    id: undefined,
    workflowInstanceId: undefined,
  });

  create(id, WorkflowInstanceId) {
    const {state} = this;
    state.id = id;
    state.workflowInstanceId = WorkflowInstanceId;
  }
}

class Chronicle extends Elf {
  logic = Elf.getLogic(ChronicleLogic);
  state = new ChronicleState();

  /** @type {Engine} */ _bpmnEngine;
  _bpmnListener;
  _executionAPI;

  async create(id, desktopId, workflowInstanceId) {
    if (!workflowInstanceId) {
      throw new Error('A chronicle cannot be created without workflow');
    }

    const instanceState = await this.cryo.getState(
      WorkflowInstanceLogic.db,
      workflowInstanceId
    );
    if (!instanceState) {
      throw new Error(`${workflowInstanceId} must exists`);
    }

    const {workflowId, engineState} = instanceState;

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

    this._bpmnEngine = engineState
      ? new Engine().recover(engineState) /* Restore a state machine */
      : new Engine({name, source}); /* New state machine */

    this.logic.create(id, workflowInstanceId);
    return this;
  }

  async scriptTask(name) {
    this.log.dbg('@@@ BEGIN WAIT 1s');
    await new Promise((resolve) => setTimeout(resolve, 1000));
    this.log.dbg('@@@ END WAIT 1s');
  }

  async begin() {
    this._bpmnListener = new EventEmitter();

    this._bpmnListener
      .on('error', () => {
        this.log.dbg('error');
      })
      .on('stop', () => {
        this.log.dbg('stop');
      })
      .on('end', () => {
        this.log.dbg('end');
      })
      .on('activity.enter', (elementAPI, executionAPI) => {
        this.log.dbg('activity.enter', elementAPI.type, elementAPI.name);
      })
      .on('activity.start', async (elementAPI, executionAPI) => {
        this.log.dbg('activity.start', elementAPI.type, elementAPI.name);

        try {
          switch (elementAPI.type) {
            case 'bpmn:ScriptTask': {
              this._bpmnEngine.stop();
              await this.scriptTask(elementAPI.name);
              this._bpmnEngine.resume();
              break;
            }
          }
        } catch (ex) {
          this.log.err(ex.stack);
        }
      })
      .on('activity.wait', (elementAPI, executionAPI) => {
        this.log.dbg('activity.wait');
      })
      .on('activity.end', (elementAPI, executionAPI) => {
        this.log.dbg('activity.end', elementAPI.type, elementAPI.name);
      })
      .on('activity.leave', (elementAPI, executionAPI) => {
        this.log.dbg('activity.leave', elementAPI.type, elementAPI.name);
      })
      .on('activity.stop', (elementAPI, executionAPI) => {
        this.log.dbg('activity.stop');
      })
      .on('activity.throw', () => {
        this.log.dbg('activity.throw');
      })
      .on('activity.error', () => {
        this.log.dbg('activity.error');
      });

    const execute = promisify(this._bpmnEngine.execute).bind(this._bpmnEngine);
    this._executionAPI = await execute({listener: this._bpmnListener});
  }
}

module.exports = {Chronicle, ChronicleLogic};
