// @ts-check
const {
  WorkflowInstanceShape,
} = require('goblin-yennefer/lib/workflow/shapes.js');
const {
  WorkflowInstanceLogic,
} = require('goblin-yennefer/lib/workflow/workflowInstance.js');
const {Elf} = require('xcraft-core-goblin');
const {string} = require('xcraft-core-stones');
const {Chronicle} = require('./chronicle.js');

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
}

module.exports = {Compendium, CompendiumLogic};
