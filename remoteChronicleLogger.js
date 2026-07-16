const {Elf} = require('xcraft-core-goblin');
const {
  RemoteChronicleLogger,
  RemoteChronicleLoggerLogic,
} = require('./lib/remoteChronicleLogger.js');

exports.xcraftCommands = Elf.birth(
  RemoteChronicleLogger,
  RemoteChronicleLoggerLogic
);
