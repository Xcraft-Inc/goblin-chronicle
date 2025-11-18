// @ts-check
const {Elf} = require('xcraft-core-goblin');
const {id} = require('xcraft-core-goblin/lib/types.js');
const {string, enumeration} = require('xcraft-core-stones');
const {WorkflowLogic} = require('goblin-yennefer/lib/workflow/workflow.js');
const {WorkflowShape} = require('goblin-yennefer/lib/workflow/shapes.js');
const {
  Database,
  App,
  ScriptDataContext,
} = require('goblin-yennefer/lib/sdk.js');
const {
  BusinessEvents,
} = require('goblin-yennefer/lib/businessEvents/businessEvents.js');
const GoldFs = require('goblin-chest/lib/goldFs.js');

class ChronicleShape {
  id = string;
  workflowId = id('workflow');
  outputPersistence = enumeration('events', 'none');
  sourceName = string;
}

class ChronicleState extends Elf.Sculpt(ChronicleShape) {}

class ChronicleLogic extends Elf.Spirit {
  state = new ChronicleState({
    id: undefined,
    workflowId: undefined,
    sourceName: undefined,
    outputPersistence: 'events',
  });

  create(id, workflowId, sourceName, outputPersistence) {
    const {state} = this;
    state.id = id;
    state.workflowId = workflowId;
    state.sourceName = sourceName;
    state.outputPersistence = outputPersistence;
  }
}

class Chronicle extends Elf {
  logic = Elf.getLogic(ChronicleLogic);
  state = new ChronicleState();

  _outputPersistance;

  async create(id, desktopId, workflowId) {
    if (!workflowId) {
      throw new Error('A chronicle cannot be created without workflow');
    }

    const workflowState = await this.cryo.getState(
      WorkflowLogic.db,
      workflowId,
      WorkflowShape
    );
    if (!workflowState) {
      throw new Error(`${workflowId} must exists`);
    }

    const {sourceName, outputPersistence} = workflowState;
    this.logic.create(id, workflowId, sourceName, outputPersistence);
    return this;
  }

  /**
   * @private
   * @param {string} sourceName
   * @returns {Promise<string>} location
   */
  async _getFileSource(sourceName) {
    const goldFs = new GoldFs(this);

    const resolvedPath = await goldFs.resolve(sourceName);
    if (!resolvedPath) {
      throw new Error(`Impossible to retrieve the resource: ${sourceName}`);
    }

    return resolvedPath;
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
    const feedId = await this.newQuestFeed();
    try {
      //Prepare context
      const vmContext = {
        db: new Database(this.cryo),
        app: new App(feedId, this, context, desktopId),
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

  async begin(
    desktopId,
    workflowId,
    contextId,
    createdAt,
    createdBy,
    initialData
  ) {
    let result = {};
    try {
      const instanceId = await this.quest.uuidV4();
      const context = new ScriptDataContext({
        contextId,
        workflowId,
        createdBy,
        createdAt,
        instanceId,
      });
      await this.startWorkflow(context, initialData);
      const {error, data} = await this._runUserScript(
        desktopId,
        context,
        initialData
      );
      let eventsOutputData = null;
      if (this.state.outputPersistence === 'events') {
        eventsOutputData = data;
      }
      if (error) {
        result = {
          error: error.replace(/(at .*)/, `${this.state.sourceName}\n    $1`),
          data: eventsOutputData,
        };
        await this.cancelWorkflow(context, result);
      } else {
        result = data;
        await this.endWorkflow(context, eventsOutputData);
      }
    } finally {
      await this.kill(this.id, 'compendium', this.quest.goblin.feed);
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
    const {contextId, workflowId, createdBy} = context;
    await businessEvents.add(
      'workflow-started',
      contextId,
      workflowId,
      workflowId,
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
    const {contextId, workflowId, createdBy} = context;
    await businessEvents.add(
      'workflow-canceled',
      contextId,
      workflowId,
      workflowId,
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
    const {contextId, workflowId, createdBy} = context;
    await businessEvents.add(
      'workflow-ended',
      contextId,
      workflowId,
      workflowId,
      data,
      undefined,
      undefined,
      createdBy
    );
  }
}

module.exports = {Chronicle, ChronicleLogic};
