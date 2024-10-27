// @ts-check
const {Elf} = require('xcraft-core-goblin');
const {id} = require('xcraft-core-goblin/lib/types.js');
const {string} = require('xcraft-core-stones');
const {
  WorkflowInstanceLogic,
  WorkflowInstance,
} = require('goblin-yennefer/lib/workflow/workflowInstance.js');
const {WorkflowLogic} = require('goblin-yennefer/lib/workflow/workflow.js');
const {Chest} = require('goblin-chest/lib/chest.js');
const {
  WorkflowShape,
  WorkflowInstanceShape,
} = require('goblin-yennefer/lib/workflow/shapes.js');
const {
  Database,
  App,
  ScriptDataContext,
} = require('goblin-yennefer/lib/sdk.js');
const {
  BusinessEvents,
} = require('goblin-yennefer/lib/businessEvents/businessEvents.js');

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
   * @returns {Promise<string>} location
   */
  async _getFileSource(name) {
    const chest = await new Chest(this);

    /* Retrieve the chestObjectId according to the name */
    const chestObjectId = await chest.getObjectIdFromName(name);
    if (!chestObjectId) {
      throw new Error(`Impossible to retrieve the chestObjectId of ${name}`);
    }

    /* Retrieve the file according to the chestObjectId */
    return await chest.locationTry(chestObjectId);
  }

  /**
   * @private
   * @param {string} desktopId
   * @param {ScriptDataContext} context
   * @param {object} data
   * @returns {Promise<object>}
   */
  async _runUserScript(desktopId, context, data) {
    const vm = require('node:vm');

    const {sourceName} = this.state;
    const sdkVersion = App.sdkVersion;

    const scriptPath = await this._getFileSource(sourceName);
    const code = `
    (async function() {
      const main = loadScript();
      return await main(app, db, context, data);
    })();`;

    //Create a feed for the App
    const feedId = Elf.createFeed();
    this.quest.defer(async () => await this.killFeed(feedId));
    //attach itself to feed
    await new Chronicle(this).create(this.id, feedId);
    try {
      //Prepare context
      const vmContext = {
        db: new Database(this.cryo),
        app: new App(feedId, this),
        loadScript: () => {
          return require(scriptPath);
        },
        context,
        data,
        console: {log: (fmt, ...args) => this.log.dbg(fmt, ...args)},
      };

      vm.createContext(vmContext);
      this.log.dbg(`Running "${sourceName}" with SDKv${sdkVersion}...`);
      const returnData = await vm.runInContext(code, vmContext);
      this.log.dbg(`Running "${sourceName}" SDKv${sdkVersion}...[DONE]`);
      return {error: null, data: returnData};
    } catch (ex) {
      this.log.err(ex.stack || ex.message || ex);
      this.log.dbg(`Running "${sourceName}" SDKv${sdkVersion}...[FAILED]`);
      return {error: ex.stack || ex.message || ex, data};
    }
  }

  async begin(desktopId) {
    let result = {};
    try {
      const instance = await this.cryo.getState(
        WorkflowInstanceLogic.db,
        this.state.workflowInstanceId,
        WorkflowInstanceShape
      );
      const {id, workflowId, contextId, createdAt, createdBy} = instance;
      const context = new ScriptDataContext({
        workflowInstanceId: id,
        contextId,
        workflowId,
        createdBy,
        createdAt,
      });
      await this.startWorkflow(context, instance.data);
      const {error, data} = await this._runUserScript(
        desktopId,
        context,
        instance.data
      );
      await this._workflowInstance.change('data', data);
      if (error) {
        result = {error, data};
        await this.cancelWorkflow(context, result);
      } else {
        result = data;
        await this.endWorkflow(context, data);
      }
    } finally {
      await this.kill(this.id, 'compendium', this._desktopId);
    }
    return result;
  }

  /**
   * Start the workflow
   * Add a 'workflow-started' event in the good context
   * @param {ScriptDataContext} context
   * @param {object} data payload
   */
  async startWorkflow(context, data) {
    const businessEvents = new BusinessEvents(this);
    const {contextId, workflowId, workflowInstanceId, createdBy} = context;
    await businessEvents.add(
      'workflow-started',
      contextId,
      workflowId,
      workflowInstanceId,
      data,
      undefined,
      undefined,
      createdBy
    );
  }

  /**
   * Cancel the worflow
   * Add a 'workflow-canceled' event in the good context
   * @param {ScriptDataContext} context
   * @param {object} data payload
   */
  async cancelWorkflow(context, data) {
    const businessEvents = new BusinessEvents(this);
    const {contextId, workflowId, workflowInstanceId, createdBy} = context;
    await businessEvents.add(
      'workflow-canceled',
      contextId,
      workflowId,
      workflowInstanceId,
      data,
      undefined,
      undefined,
      createdBy
    );
  }

  /**
   * Terminate the workflow
   * Add a 'workflow-ended' event in the good context
   * @param {ScriptDataContext} context
   * @param {object} data payload
   */
  async endWorkflow(context, data) {
    const businessEvents = new BusinessEvents(this);
    const {contextId, workflowId, workflowInstanceId, createdBy} = context;
    await businessEvents.add(
      'workflow-ended',
      contextId,
      workflowId,
      workflowInstanceId,
      data,
      undefined,
      undefined,
      createdBy
    );
  }
}

module.exports = {Chronicle, ChronicleLogic};
