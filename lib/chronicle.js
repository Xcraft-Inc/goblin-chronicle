// @ts-check
const {Elf} = require('xcraft-core-goblin');
const {id} = require('xcraft-core-goblin/lib/types.js');
const {string} = require('xcraft-core-stones');
const fse = require('fs-extra');
const {
  WorkflowInstanceLogic,
  WorkflowInstance,
} = require('goblin-yennefer/lib/workflow/workflowInstance.js');
const {WorkflowLogic} = require('goblin-yennefer/lib/workflow/workflow.js');
const {Chest} = require('goblin-chest/lib/chest.js');
const {
  ChestObjectLogic,
  ChestObjectShape,
} = require('goblin-chest/lib/chestObject.js');
const {
  WorkflowShape,
  WorkflowInstanceShape,
} = require('goblin-yennefer/lib/workflow/shapes.js');

class ChronicleShape {
  id = string;
  workflowInstanceId = id('workflowInstance');
  sourceName = string;
}

class ChronicleState extends Elf.Sculpt(ChronicleShape) {}

class ChronicleLogic extends Elf.Spirit {
  state = new ChronicleState({
    id: undefined,
    workflowInstanceId: undefined,
    sourceName: undefined,
  });

  create(id, WorkflowInstanceId, sourceName) {
    const {state} = this;
    state.id = id;
    state.workflowInstanceId = WorkflowInstanceId;
    state.sourceName = sourceName;
  }
}

class Chronicle extends Elf {
  logic = Elf.getLogic(ChronicleLogic);
  state = new ChronicleState();

  _desktopId;
  /** @type {WorkflowInstance} */ _workflowInstance;

  async create(id, desktopId, workflowInstanceId) {
    if (!workflowInstanceId) {
      throw new Error('A chronicle cannot be created without workflow');
    }

    this._desktopId = desktopId;

    const instanceState = await this.cryo.getState(
      WorkflowInstanceLogic.db,
      workflowInstanceId,
      WorkflowInstanceShape
    );
    if (!instanceState) {
      throw new Error(`${workflowInstanceId} must exists`);
    }

    const {workflowId} = instanceState;

    const workflowState = await this.cryo.getState(
      WorkflowLogic.db,
      workflowId,
      WorkflowShape
    );
    if (!workflowState) {
      throw new Error(`${workflowId} must exists`);
    }

    const {sourceName} = workflowState;
    this.logic.create(id, workflowInstanceId, sourceName);

    this._workflowInstance = await new WorkflowInstance(this).create(
      workflowInstanceId,
      desktopId
    );

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
   * @param {string} desktopId
   * @returns {Promise<object>}
   */
  async _userTask(desktopId) {
    const vm = require('node:vm');
    const instance = await this.cryo.getState(
      WorkflowInstanceLogic.db,
      this.state.workflowInstanceId,
      WorkflowInstanceShape
    );

    const {sourceName} = this.state;
    const script = await this._getFileSource(sourceName);
    const code = `(async function() {
    ${script}
    })();`;
    const context = {
      context: instance,
      data: instance.data,
      debug: (message) => this.log.dbg(message),
      getEntity: (entityId) => this.getEntity(entityId),
      form: (definition, initialForm) =>
        this.openFormDialog(desktopId, definition, initialForm),
    };
    vm.createContext(context);
    try {
      this.log.dbg(`Running "${sourceName}" script...`);
      this.log.dbg(code);
      this.log.dbg(`Context before :`);
      this.log.dbg(JSON.stringify(context, null, 2));
      await vm.runInContext(code, context);
      this.log.dbg(`Context after :`);
      this.log.dbg(JSON.stringify(context, null, 2));
      this.log.dbg(`Running "${sourceName}" script...[DONE]`);
    } catch (ex) {
      this.log.err(ex.stack || ex.message || ex);
    }
    return context.data;
  }

  async getEntity(entityId) {
    const resp = this.quest.resp;
    //todo: better hosting for getEntity
    let yetiLib = 'goblin-yeti/lib/yeti.js';
    if (!resp.hasCommand('yeti.getEntity')) {
      yetiLib = 'goblin-yeti-server/lib/yetiServer.js';
      if (!resp.hasCommand('yetiServer.getEntity')) {
        throw new Error('Cannot use getEntity');
      }
    }

    const Yeti = require(yetiLib);
    const yeti = new Yeti(this);
    return await yeti.getEntity(entityId);
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
    try {
      const data = await this._userTask(desktopId);
      await this._workflowInstance.change('data', data);
    } finally {
      await this.kill(this.id, 'compendium', this._desktopId);
    }
  }
}

module.exports = {Chronicle, ChronicleLogic};
