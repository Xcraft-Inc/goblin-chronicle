// @ts-check
const {record, array, object} = require('xcraft-core-stones');
const {Elf, SmartId} = require('xcraft-core-goblin');
const {id, MetaShape} = require('xcraft-core-goblin/lib/types.js');
const fse = require('fs-extra');
const xConfig = require('xcraft-core-etc')().load('xcraft');
const goblinConfig = require('xcraft-core-etc')().load('xcraft-core-goblin');
const path = require('node:path');
const {appendFile} = require('node:fs/promises');

const DBNAME = 'chronicle';
const syncClientEnabled = goblinConfig.actionsSync?.enable;
const isServerSide = !syncClientEnabled;

/**
 * Ajoute un objet JSON dans un fichier JSONL.
 *
 * @param {string} filePath
 * @param {any} record
 * @returns {Promise<void>}
 */
async function appendJsonLine(filePath, record) {
  const line = `${JSON.stringify(record)}\n`;
  await appendFile(filePath, line, 'utf8');
}

class RemoteChronicleLoggerShape {
  id = id('remoteChronicleLogger');
  writeQueue = record(id('workflow'), array(object));
  meta = MetaShape;
}

class RemoteChronicleLoggerState extends Elf.Sculpt(
  RemoteChronicleLoggerShape
) {}

class RemoteChronicleLoggerLogic extends Elf.Archetype {
  static db = DBNAME;
  static logDir = path.join(xConfig.xcraftRoot, 'var/log/chronicle');

  state = new RemoteChronicleLoggerState({
    id: undefined,
    writeQueue: {},
    meta: {index: '', status: 'published'},
  });

  create(id) {
    const {state} = this;
    state.id = id;
  }

  appendTo(workflowId, record) {
    const {state} = this;
    if (!state.writeQueue[workflowId]) {
      state.writeQueue[workflowId] = [];
    }
    state.writeQueue[workflowId].push(record);
  }

  _flushQueue() {
    this.state.writeQueue = {};
  }
}

//Ensure xcraft root 'var/log/chronicle'
fse.ensureDirSync(RemoteChronicleLoggerLogic.logDir);

class RemoteChronicleLogger extends Elf {
  logic = Elf.getLogic(RemoteChronicleLoggerLogic);
  state = new RemoteChronicleLoggerState();

  async create(id, desktopId) {
    this.logic.create(id);
    return this;
  }

  async beforePersistOnServer() {
    await this._flushQueue();
  }

  async appendTo(workflowId, record = {}) {
    this.logic.appendTo(workflowId, record);
    if (isServerSide) {
      await this._flushQueue();
    }
    await this.persist();
  }

  async _flushQueue() {
    const {state} = this;
    for (const [workflowId, records] of Object.entries(state.writeQueue)) {
      const workflowName = SmartId.getUid(workflowId);
      const logFilePath = path.join(
        RemoteChronicleLoggerLogic.logDir,
        `${workflowName}.jsonl`
      );
      for (const record of Array.from(records)) {
        await appendJsonLine(logFilePath, record._state.toJS());
      }
    }
    this.logic._flushQueue();
  }

  delete() {}
}

module.exports = {
  RemoteChronicleLogger,
  RemoteChronicleLoggerLogic,
  RemoteChronicleLoggerShape,
  RemoteChronicleLoggerState,
  DBNAME,
};
