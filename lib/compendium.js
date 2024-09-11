// @ts-check
const {Elf} = require('xcraft-core-goblin');
const {id} = require('xcraft-core-goblin/lib/types.js');
const {string, array, enumeration, option} = require('xcraft-core-stones');
const {Chronicle} = require('./chronicle.js');
const {Chest} = require('goblin-chest');
const {
  WorkflowState,
  WorkflowInstanceState,
  WorkflowInstanceShape,
  WorkflowTriggerState,
  WorkflowTriggerShape,
} = require('goblin-yennefer/lib/workflow/shapes.js');
const {
  WorkflowInstanceLogic,
  WorkflowInstance,
} = require('goblin-yennefer/lib/workflow/workflowInstance.js');
const {Workflow} = require('goblin-yennefer/lib/workflow/workflow.js');
const {
  WorkflowTrigger,
  WorkflowTriggerLogic,
} = require('goblin-yennefer/lib/workflow/workflowTrigger.js');

class TriggerDefinitionShape {
  id = id('worfklowTrigger');
  type = enumeration('manual', 'cron', 'businessEvent', 'api');
  contextType = enumeration('contact', 'customerFolder', 'any');
  name = string;
  description = option(string);
}

class CompendiumShape {
  id = string;
  chronicles = array(id('chronicle'));
  triggers = array(TriggerDefinitionShape);
}

class CompendiumState extends Elf.Sculpt(CompendiumShape) {}

class CompendiumLogic extends Elf.Spirit {
  state = new CompendiumState({
    id: 'compendium',
    chronicles: [],
    triggers: [],
  });

  beginChronicle(chronicleId) {
    const {state} = this;
    state.chronicles.push(chronicleId);
  }

  loadTriggers(triggers) {
    const {state} = this;
    state.triggers = triggers;
  }
}

class Compendium extends Elf.Alone {
  logic = Elf.getLogic(CompendiumLogic);

  _desktopId = 'system@compendium';

  async init() {
    await this.loadFromResources();
    await this.loadTriggers();
    const instances = await this.cryo.reader(WorkflowInstanceLogic.db);
    const instanceIds = instances
      .queryArchetype('workflowInstance', WorkflowInstanceShape)
      .field('id')
      .where((instance, $) =>
        $.and(
          instance.get('status').neq('completed'),
          instance.get('status').neq('failed')
        )
      )
      .iterate();

    for (const workflowInstanceId of instanceIds) {
      const chronicle = await new Chronicle(this).create(
        `chronicle@${workflowInstanceId}`,
        this._desktopId,
        workflowInstanceId
      );
      // TODO: something with the chronicle
      await chronicle.begin(this._desktopId);
    }
  }

  async loadTriggers() {
    const triggers = await this.cryo.reader(WorkflowTriggerLogic.db);
    const existingTriggers = triggers
      .queryArchetype('workflowTrigger', WorkflowTriggerShape)
      .fields(['id', 'name', 'description', 'type', 'contextType'])
      .all();
    this.logic.loadTriggers(existingTriggers);
  }

  async loadFromResources() {
    const path = require('node:path');
    const load = require('goblin-yennefer/lib/workflow/resourcesLoader.js');
    const worflows = load();

    const feedId = Elf.createFeed();
    this.quest.defer(async () => await this.killFeed(feedId));

    for (const {
      id,
      name,
      sourceName,
      description,
      sourceFilePath,
      jsScriptFiles,
      triggers,
    } of worflows) {
      const chest = new Chest(this);
      const workflowNameSpace = id.split('@')[1];
      const finalSourceName = `${workflowNameSpace}.${sourceName}`;
      await chest.supply(sourceFilePath, finalSourceName);
      for (const jsFilePath of jsScriptFiles) {
        const fileName = path.basename(jsFilePath);
        await chest.supply(jsFilePath, `${workflowNameSpace}.${fileName}`);
      }
      const state = new WorkflowState({
        id,
        name,
        sourceName: finalSourceName,
        description,
        meta: {index: name, status: 'published'},
      });
      await new Workflow(this).insertOrReplace(id, feedId, state);
      this.log.dbg(`Loaded "${name}" workflow from resources`);
      const workflowId = id;
      for (const {id, type, name, description, contextType, data} of triggers) {
        const state = new WorkflowTriggerState({
          id,
          workflowId,
          type,
          name,
          description,
          contextType,
          data,
          meta: {index: name, status: 'published'},
        });
        await new WorkflowTrigger(this).insertOrReplace(id, feedId, state);
        this.log.dbg(`Loaded "${name}" workflow trigger from resources`);
      }
    }
  }

  async trigger(desktopId, workflowTriggerId) {
    const meta = {
      contextId: null,
      createdBy: `user@${this.user.id}`,
    };
    const {workflowId, data} = await this.cryo.getState(
      WorkflowTriggerLogic.db,
      workflowTriggerId,
      WorkflowTriggerShape
    );
    await this.beginChronicle(desktopId, workflowId, meta, data);
  }

  async beginChronicle(desktopId, workflowId, meta, data) {
    const workflowInstanceId = Elf.newId('workflowInstance');
    const date = new Date().toISOString();
    const state = new WorkflowInstanceState({
      id: workflowInstanceId,
      workflowId,
      status: 'pending',
      contextId: meta.contextId,
      data: {},
      createdBy: meta.createdBy,
      createdAt: date,
      updatedAt: date,
      completedAt: undefined,
      meta: {index: workflowInstanceId, status: 'published'},
    });
    await new WorkflowInstance(this).insertOrReplace(
      workflowInstanceId,
      this._desktopId,
      state
    );

    const chronicleId = `chronicle@${workflowInstanceId}`;
    const chronicle = await new Chronicle(this).create(
      chronicleId,
      this._desktopId,
      workflowInstanceId
    );

    this.logic.beginChronicle(chronicleId);

    await chronicle.begin(desktopId);
  }
}

module.exports = {Compendium, CompendiumLogic};
