// @ts-check
const {Elf} = require('xcraft-core-goblin');
const goblinConfig = require('xcraft-core-etc')().load('xcraft-core-goblin');
const syncClientEnabled = goblinConfig.actionsSync?.enable;
const IS_SERVER_SIDE = !syncClientEnabled;
const {id} = require('xcraft-core-goblin/lib/types.js');
const {string, array} = require('xcraft-core-stones');
const {Chronicle} = require('./chronicle.js');
const {Chest} = require('goblin-chest');
const {
  WorkflowState,
  WorkflowTriggerState,
  WorkflowTriggerShape,
} = require('goblin-yennefer/lib/workflow/shapes.js');
const {
  Workflow,
  WorkflowLogic,
} = require('goblin-yennefer/lib/workflow/workflow.js');
const {
  WorkflowTrigger,
  WorkflowTriggerLogic,
} = require('goblin-yennefer/lib/workflow/workflowTrigger.js');
const {
  BusinessEvents,
} = require('goblin-yennefer/lib/businessEvents/businessEvents.js');

const matchRule = (rule, event) => {
  for (const key in rule) {
    if (key === 'data') {
      for (const dataKey in rule.data) {
        if (rule.data[dataKey] !== event.data[dataKey]) {
          return false;
        }
      }
    } else if (rule[key] !== event[key]) {
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
  _serverEventRules;
  _clientEventRules;
  _serverAPIRules;

  async init(workspacePath) {
    if (workspacePath) {
      await this.loadFromResources(workspacePath);
    }
    await this.loadTriggers();
    const businessEvents = new BusinessEvents(this);
    await businessEvents.addView(this.id, undefined, true);
    await businessEvents.addHook(this.id);
  }

  async registerServerBusinessEventTrigger(triggerId) {
    const {id, events} = await this.cryo.getState(
      WorkflowTriggerLogic.db,
      triggerId,
      WorkflowTriggerShape
    );
    if (events) {
      for (const rule of events) {
        this._serverEventRules.push({id, rule});
        this.log.dbg('Server business event rule added');
      }
    }
  }

  async registerServerAPITrigger(triggerId) {
    const {id, apiEndpoint} = await this.cryo.getState(
      WorkflowTriggerLogic.db,
      triggerId,
      WorkflowTriggerShape
    );
    if (apiEndpoint) {
      this._serverAPIRules.push({id, apiEndpoint});
      this.log.dbg('Server API endpoint rule added :', apiEndpoint);
    }
  }

  async registerClientBusinessEventTrigger(triggerId) {
    const {id, events} = await this.cryo.getState(
      WorkflowTriggerLogic.db,
      triggerId,
      WorkflowTriggerShape
    );
    if (events) {
      for (const rule of events) {
        this._clientEventRules.push({id, rule});
        this.log.dbg('Client business event rule added');
      }
    }
  }

  async onAPICall(verb, route, body, multiMatch = false) {
    const results = [];
    for (const {id, apiEndpoint} of this._serverAPIRules) {
      if (apiEndpoint.startsWith(verb) && apiEndpoint.endsWith(route)) {
        const result = await this.trigger(this._desktopId, id, null, body);
        results.push(result);
        if (!multiMatch) {
          break;
        }
      }
    }
    if (multiMatch) {
      return results;
    } else {
      return results[0];
    }
  }

  async onBusinessEventCreated(event) {
    if (!this._clientEventRules?.length) {
      return;
    }
    const matchedTriggers = [];
    const {data} = event;
    //Check triggers event rules
    for (const {id, rule} of this._clientEventRules) {
      if (matchRule(rule, event)) {
        matchedTriggers.push({id, data});
      }
    }
    for (const {id, data} of matchedTriggers) {
      await this.trigger(this._desktopId, id, event.id, data);
    }
  }

  async update(events) {
    const matchedTriggers = [];
    for (const event of events) {
      if (event.type === 'workflow-trigger-changed') {
        await this.loadTriggers();
      }
      const {data} = event;
      //Check triggers event rules
      for (const {id, rule} of this._serverEventRules) {
        if (matchRule(rule, event)) {
          matchedTriggers.push({id, data, contextId: event.id});
        }
      }
    }
    for (const {id, data, contextId} of matchedTriggers) {
      await this.trigger(this._desktopId, id, contextId, data);
    }
  }

  async loadTriggers() {
    this.log.dbg('Loading triggers...');
    const triggers = await this.cryo.reader(WorkflowTriggerLogic.db);
    const existingTriggers = triggers
      .queryArchetype('workflowTrigger', WorkflowTriggerShape)
      .fields([
        'id',
        'name',
        'description',
        'icon',
        'type',
        'contextType',
        'workflowId',
        'data',
        'isMainAction',
      ])
      .where((t) => t.get('enabled').eq(true))
      .all();
    this.logic.loadTriggers(existingTriggers);
    //reset eventRules
    this._serverEventRules = [];
    this._clientEventRules = [];
    this._serverAPIRules = [];

    if (IS_SERVER_SIDE) {
      for (const trigger of this.state.triggers) {
        if (
          trigger.type === 'businessEvent' &&
          trigger.contextType === 'server'
        ) {
          await this.registerServerBusinessEventTrigger(trigger.id);
        }
        if (trigger.type === 'api' && trigger.contextType === 'server') {
          await this.registerServerAPITrigger(trigger.id);
        }
      }
    } else {
      for (const trigger of this.state.triggers) {
        if (
          trigger.type === 'businessEvent' &&
          trigger.contextType === 'client'
        ) {
          await this.registerClientBusinessEventTrigger(trigger.id);
        }
      }
    }
  }

  async loadFromResources(workspacePath, forceUpgrade = false) {
    const path = require('node:path');
    const load = require('goblin-yennefer/lib/workflow/resourcesLoader.js');
    const workflows = load(workspacePath);

    const feedId = await this.newQuestFeed();

    for (const {
      id,
      name,
      sourceName,
      description,
      sourceFilePath,
      jsScriptFiles,
      triggers,
      outputPersistence,
    } of workflows) {
      const exist = await WorkflowLogic.exist(this.cryo, id);
      if (exist && !forceUpgrade) {
        //already loaded from ressources
        continue;
      }
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
        sourceUpdatedAt: new Date().toISOString(),
        description,
        outputPersistence: outputPersistence || 'events',
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
        icon,
        contextType,
        data,
        waitFor,
        events,
        apiEndpoint,
        isMainAction,
      } of triggers) {
        const state = new WorkflowTriggerState({
          id,
          enabled,
          workflowId,
          type,
          name,
          description,
          icon,
          contextType,
          data,
          waitFor,
          events,
          apiEndpoint,
          isMainAction,
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
   * @returns {Promise<object>} workflow result data object
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

    return await this.beginChronicle(desktopId, workflowId, meta, {
      ...data,
      ...contextData,
    });
  }

  async beginChronicle(desktopId, workflowId, meta, data) {
    const date = new Date().toISOString();
    const chronicleId = Elf.newId('chronicle');
    const chronicle = await new Chronicle(this).create(
      chronicleId,
      this._desktopId,
      workflowId
    );

    this.logic.beginChronicle(chronicleId);
    return await chronicle.begin(
      desktopId,
      workflowId,
      meta.contextId,
      date,
      meta.createdBy,
      data
    );
  }
}

module.exports = {Compendium, CompendiumLogic};
