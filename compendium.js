const {Elf} = require('xcraft-core-goblin');
const {Compendium, CompendiumLogic} = require('./lib/compendium.js');

exports.xcraftCommands = Elf.birth(Compendium, CompendiumLogic);
