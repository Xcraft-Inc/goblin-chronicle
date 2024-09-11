// @ts-check
const {
  WorkflowInstanceShape,
  WorkflowState,
  WorkflowTriggerState,
} = require('goblin-yennefer/lib/workflow/shapes.js');
const {
  WorkflowInstanceLogic,
} = require('goblin-yennefer/lib/workflow/workflowInstance.js');
const {Elf} = require('xcraft-core-goblin');
const {string} = require('xcraft-core-stones');
const {Chronicle} = require('./chronicle.js');
const {Chest} = require('goblin-chest');
const {Workflow} = require('goblin-yennefer/lib/workflow/workflow.js');
const {
  WorkflowTrigger,
} = require('goblin-yennefer/lib/workflow/workflowTrigger.js');

class CompendiumShape {
  id = string;
}

class CompendiumState extends Elf.Sculpt(CompendiumShape) {}

class CompendiumLogic extends Elf.Spirit {
  state = new CompendiumState({
    id: 'compendium',
  });
}

class Compendium extends Elf.Alone {
  _desktopId = 'system@compendium';

  async init() {
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
        Elf.newId('chronicle'),
        this._desktopId,
        workflowInstanceId
      );
      // TODO: something with the chronicle
    }
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
}

module.exports = {Compendium, CompendiumLogic};
