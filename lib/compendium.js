// @ts-check
const {Elf} = require('xcraft-core-goblin');
const goblinConfig = require('xcraft-core-etc')().load('xcraft-core-goblin');
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
const {
  BusinessEvents,
} = require('goblin-yennefer/lib/businessEvents/businessEvents.js');

const matchRule = (rule, event) => {
  for (const key in rule) {
    if (rule[key] !== event[key]) {
      return false;
    }
  }
  return true;
};

class CompendiumShape {
  id = string;
  chronicles = array(id('chronicle'));
  triggers = array(WorkflowTriggerShape);
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
  state = new CompendiumState();

  _desktopId = 'system@compendium';
  _eventRules;

  async init(workspacePath) {
    await this.loadFromResources(workspacePath);
    await this.loadTriggers();
    await new BusinessEvents(this).addView(this.id, undefined, true);
  }

  async registerBusinessEventTrigger(triggerId) {
    const {id, events} = await this.cryo.getState(
      WorkflowTriggerLogic.db,
      triggerId,
      WorkflowTriggerShape
    );
    if (events) {
      for (const rule of events) {
        this._eventRules.push({id, rule});
      }
    }
  }

  async update(events) {
    const matchedTriggers = [];
    for (const event of events) {
      if (event.type === 'worflow-trigger-changed') {
        await this.loadTriggers();
      }
      const {data} = event;
      //Check triggers event rules
      for (const {id, rule} of this._eventRules) {
        if (matchRule(rule, event)) {
          matchedTriggers.push({id, data});
        }
      }
    }
    for (const {id, data} of matchedTriggers) {
      await this.trigger(this._desktopId, id, null, data);
    }
  }

  async retryAll() {
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
      await chronicle.begin(this._desktopId);
    }
  }

  async loadTriggers() {
    const triggers = await this.cryo.reader(WorkflowTriggerLogic.db);
    const existingTriggers = triggers
      .queryArchetype('workflowTrigger', WorkflowTriggerShape)
      .fields([
        'id',
        'name',
        'description',
        'type',
        'contextType',
        'workflowId',
      ])
      .where((t) => t.get('enabled').eq(true))
      .all();
    this.logic.loadTriggers(existingTriggers);
    //reset eventRules
    this._eventRules = [];
    const syncClientEnabled = goblinConfig.actionsSync?.enable;
    const isServerSide = !syncClientEnabled;
    if (isServerSide) {
      for (const trigger of this.state.triggers) {
        if (
          trigger.type === 'businessEvent' &&
          trigger.contextType === 'server'
        ) {
          await this.registerBusinessEventTrigger(trigger.id);
        }
      }
    }
  }

  async loadFromResources(workspacePath) {
    const path = require('node:path');
    const load = require('goblin-yennefer/lib/workflow/resourcesLoader.js');
    const worflows = load(workspacePath);

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
      for (const {
        id,
        enabled,
        type,
        name,
        description,
        contextType,
        data,
        waitFor,
        events,
      } of triggers) {
        const state = new WorkflowTriggerState({
          id,
          enabled,
          workflowId,
          type,
          name,
          description,
          contextType,
          data,
          waitFor,
          events,
          meta: {index: name, status: 'published'},
        });
        await new WorkflowTrigger(this).insertOrReplace(id, feedId, state);
        this.log.dbg(`Loaded "${name}" workflow trigger from resources`);
      }
    }
  }

  /**
   * Trigger a "chronicle"
   * @param {`desktop@${string}`} desktopId
   * @param {`workflowTrigger@${string}`} workflowTriggerId
   * @param {`${string}@${string}`|undefined} contextId
   * @param {object|undefined} contextData
   */
  async trigger(
    desktopId,
    workflowTriggerId,
    contextId = undefined,
    contextData = {}
  ) {
    const meta = {
      contextId,
      createdBy: `user@${this.user.id}`,
    };
    const {workflowId, data, waitFor} = await this.cryo.getState(
      WorkflowTriggerLogic.db,
      workflowTriggerId,
      WorkflowTriggerShape
    );

    //avoid undefined context
    if (!meta.contextId) {
      meta.contextId = workflowId;
    }

    //some trigger need to wait data before starting
    if (waitFor) {
      const actorIds = [];
      for (const property of waitFor) {
        if (contextData[property]) {
          actorIds.push(contextData[property]);
        }
      }
      if (actorIds.length > 0) {
        const businessEvents = new BusinessEvents(this);
        const available = await businessEvents.waitEventData(actorIds, 1);
        if (!available) {
          return;
        }
      }
    }

    await this.beginChronicle(desktopId, workflowId, meta, {
      ...data,
      ...contextData,
    });
  }

  async beginChronicle(desktopId, workflowId, meta, data) {
    const workflowInstanceId = Elf.newId('workflowInstance');
    const date = new Date().toISOString();
    const state = new WorkflowInstanceState({
      id: workflowInstanceId,
      workflowId,
      status: 'pending',
      contextId: meta.contextId,
      data,
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
