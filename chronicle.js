const {Elf} = require('xcraft-core-goblin');
const {Chronicle, ChronicleLogic} = require('./lib/chronicle.js');

exports.xcraftCommands = Elf.birth(Chronicle, ChronicleLogic);
