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
const {Database, App} = require('goblin-yennefer/lib/sdk.js');

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
   * @returns {string} location
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
    return await chest.locationTry(chestObjectId);
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
    const scriptPath = await this._getFileSource(sourceName);
    const code = `
    const main = loadScript();
    main(app,db,context,data).then();`;

    //Prepare context
    const {id, workflowId, contextId, createdBy, createdAt, data} = instance;
    const context = {
      db: new Database(this.cryo),
      app: new App(desktopId, this),
      loadScript: () => {
        return require(scriptPath);
      },
      context: {
        workflowInstanceId: id,
        workflowId,
        contextId,
        createdBy,
        createdAt,
      },
      data,
      console: {log: (...args) => this.log.dbg(...args)},
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
