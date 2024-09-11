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
const {
  WorkflowShape,
  WorkflowInstanceShape,
} = require('goblin-yennefer/lib/workflow/shapes.js');
const {UserLogic} = require('goblin-yennefer/lib/cms/user.js');
const {UserShape} = require('goblin-yennefer/lib/cms/shapes.js');

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
  _resume = false;

  async create(id, desktopId, workflowInstanceId) {
    if (!workflowInstanceId) {
      throw new Error('A chronicle cannot be created without workflow');
    }

    this.logic.create(id, workflowInstanceId);

    const instanceState = await this.cryo.getState(
      WorkflowInstanceLogic.db,
      workflowInstanceId,
      WorkflowInstanceShape
    );
    if (!instanceState) {
      throw new Error(`${workflowInstanceId} must exists`);
    }

    const {workflowId, engineState} = instanceState;

    const workflowState = await this.cryo.getState(
      WorkflowLogic.db,
      workflowId,
      WorkflowShape
    );
    if (!workflowState) {
      throw new Error(`${workflowId} must exists`);
    }

    const {name, sourceName} = workflowState;
    const source = await this._getFileSource(sourceName);

    this._resume = !!engineState;
    this._bpmnEngine = engineState
      ? new Engine().recover(engineState) /* Restore a state machine */
      : new Engine({name, source}); /* New state machine */

    return this;
  }

  /**
   * @private
   * @param {string} name
   * @returns {Promise<string>}
   */
  async _getFileSource(name) {
    /* Retrieve the chestObjectId according to the name */
    const objects = await this.cryo.reader(ChestObjectLogic.db);
    const chestObjectId = objects
      .queryArchetype('chestObject', ChestObjectShape)
      .field('id')
      .where((object) => object.get('name').eq(name))
      .orderBy((object, $) => $.desc(object.get('generation')))
      .limit(1)
      .get();
    if (!chestObjectId) {
      throw new Error(`Impossible to retrieve the chestObjectId of ${name}`);
    }

    /* Retrieve the file according to the chestObjectId */
    const chest = await new Chest(this);
    const location = await chest.locationTry(chestObjectId);
    return fse.readFileSync(location, 'utf8');
  }

  /**
   * @private
   * @param {string} workflowId
   * @param {string} name
   * @returns {Promise<string>}
   */
  async _getScriptSource(workflowId, name) {
    const namespace = workflowId.split('@')[1];
    const sourceName = `${namespace}.${name}.js`;
    return await this._getFileSource(sourceName);
  }

  /**
   * @private
   * @param {string} desktopId
   * @param {string} name
   */
  async _scriptTask(desktopId, name) {
    const vm = require('node:vm');
    const instance = await this.cryo.getState(
      WorkflowInstanceLogic.db,
      this.state.workflowInstanceId,
      WorkflowInstanceShape
    );
    const {workflowId} = instance;
    const script = await this._getScriptSource(workflowId, name);
    const code = `(async function() {
    ${script}
    })();`;
    const context = {
      context: instance,
      data: instance.data,
      debug: (message) => this.log.dbg(message),
      getUser: (userId) => this.cryo.getState(UserLogic.db, userId, UserShape),
      form: (definition, initialForm) =>
        this.openFormDialog(desktopId, definition, initialForm),
    };
    vm.createContext(context);
    try {
      this.log.dbg(`Running "${name}" script...`);
      this.log.dbg(code);
      this.log.dbg(`Context before :`);
      this.log.dbg(JSON.stringify(context, null, 2));
      await vm.runInContext(code, context);
      this.log.dbg(`Context after :`);
      this.log.dbg(JSON.stringify(context, null, 2));
      this.log.dbg(`Running "${name}" script...[DONE]`);
    } catch (ex) {
      this.log.err(ex.stack || ex.message || ex);
    }
  }

  async openFormDialog(desktopId, definition, initialForm) {
    const resp = this.quest.resp;
    if (!resp.hasCommand('yeti.openFormDialog')) {
      throw new Error('Cannot use form server side');
    }

    const Yeti = require('goblin-yeti/lib/yeti.js');
    const yeti = new Yeti(this);
    return await yeti.openFormDialog(desktopId, definition, initialForm);
  }

  async begin(desktopId) {
    this._bpmnListener = new EventEmitter();

    const onActivity = (step) => async (element, execution) => {
      this.log.dbg(`Begin activity.${step}`, element.type, element.name);

      try {
        switch (step) {
          case 'start': {
            switch (element.type) {
              case 'bpmn:ScriptTask': {
                const state = await this._bpmnEngine.getState();
                this._bpmnEngine.stop();
                await this._scriptTask(desktopId, element.name);
                await this._bpmnEngine.recover(state);
                await this._bpmnEngine.resume({listener: this._bpmnListener});
                break;
              }
            }
            break;
          }
        }
      } catch (ex) {
        this.log.err(ex.stack || ex.message || ex);
      } finally {
        this.log.dbg(`End activity.${step}`, element.type, element.name);
      }
    };

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
      .on('activity.enter', onActivity('enter'))
      .on('activity.start', onActivity('start'))
      .on('activity.wait', onActivity('wait'))
      .on('activity.end', onActivity('end'))
      .on('activity.leave', onActivity('leave'))
      .on('activity.stop', onActivity('stop'))
      .on('activity.throw', onActivity('throw'))
      .on('activity.error', onActivity('error'));

    const execute = promisify(this._bpmnEngine.execute).bind(this._bpmnEngine);
    this._executionAPI = this._resume
      ? await this._bpmnEngine.resume({listener: this._bpmnListener})
      : await execute({listener: this._bpmnListener});
  }
}

module.exports = {Chronicle, ChronicleLogic};
