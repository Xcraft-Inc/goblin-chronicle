# 📘 goblin-chronicle

## Aperçu

Le module `goblin-chronicle` est un système d'exécution de workflows scriptés dans l'écosystème Xcraft. Il permet de définir, déclencher et suivre l'exécution de scripts métier (workflows) en réponse à divers événements comme des événements métier ou des appels API. Ce module fournit un mécanisme puissant pour orchestrer des processus métier complexes de manière déclarative et réactive.

## Sommaire

- [Structure du module](#structure-du-module)
- [Fonctionnement global](#fonctionnement-global)
- [Exemples d'utilisation](#exemples-dutilisation)
- [Interactions avec d'autres modules](#interactions-avec-dautres-modules)
- [Détails des sources](#détails-des-sources)
- [Licence](#licence)

## Structure du module

Le module est composé de deux acteurs principaux :

1. **Chronicle** — Un acteur Elf instanciable qui exécute un workflow spécifique dans un contexte donné.
2. **Compendium** — Un acteur Elf singleton (`Elf.Alone`) qui gère l'ensemble des workflows et leurs déclencheurs.

Ces acteurs interagissent avec d'autres modules comme `goblin-yennefer` (pour la définition des workflows), [goblin-chest] (pour le stockage de fichiers via GoldFs) et le système d'événements métier de Xcraft.

## Fonctionnement global

Le module `goblin-chronicle` implémente un système de workflows basé sur des scripts JavaScript. Voici comment il fonctionne :

1. **Définition des workflows** : Les workflows sont définis avec un script source (`index.js`), des métadonnées (`workflow.json`) et des déclencheurs (triggers), et stockés dans le système de fichiers Gold sous un namespace `workflows/`.
2. **Chargement automatique** : Le `Compendium` surveille les changements dans le système de fichiers Gold et dans la base de données `workflowTrigger`, puis recharge automatiquement les ressources modifiées via des méthodes debounced (délai de 1000 ms).
3. **Enregistrement des déclencheurs** : Les déclencheurs sont catégorisés et enregistrés selon leur type (`businessEvent` ou `api`) et leur contexte d'exécution (`server` ou `client`).
4. **Exécution des workflows** : Lorsqu'un déclencheur est activé, le `Compendium` crée une instance de `Chronicle` qui exécute le script associé au workflow dans une VM JavaScript isolée.
5. **Suivi du cycle de vie** : Le système enregistre des événements métier pour suivre le cycle de vie des workflows (`workflow-started`, `workflow-ended`, `workflow-canceled`).
6. **Persistance des résultats** : Les résultats des workflows peuvent être persistés sous forme d'événements métier selon la configuration `outputPersistence` (`'events'` ou `'none'`).

### Diagramme de séquence — Déclenchement d'un workflow

```
Compendium             Chronicle              VM Script              BusinessEvents
    |                      |                      |                        |
    |-- trigger() -------->|                      |                        |
    |-- beginChronicle() ->|                      |                        |
    |                      |-- create() --------->|                        |
    |                      |-- begin() ---------->|                        |
    |                      |                      |-- startWorkflow() ---->|
    |                      |                      |   (workflow-started)   |
    |                      |                      |-- _runUserScript() --->|
    |                      |                      |   (VM execution)       |
    |                      |                      |-- endWorkflow() ------>|
    |                      |                      |   (workflow-ended)     |
    |                      |                      |   OR cancelWorkflow()  |
    |                      |                      |   (workflow-canceled)  |
    |                      |<-- result -----------|                        |
    |<-- result -----------|                      |                        |
```

### Détermination du contexte serveur/client

Le module détecte automatiquement s'il s'exécute côté serveur ou côté client en lisant la configuration `xcraft-core-goblin` :

- **Côté serveur** (`IS_SERVER_SIDE = true`) : enregistre les règles `businessEvent/server` et `api/server`.
- **Côté client** (`IS_SERVER_SIDE = false`) : enregistre les règles `businessEvent/client`.

## Exemples d'utilisation

### Déclenchement d'un workflow via un trigger

```javascript
// Depuis un acteur Elf
const compendium = new Compendium(this);
const result = await compendium.trigger(
  'system@compendium',
  'workflowTrigger@create-invoice',
  'context@invoice-creation',
  {customerId: 'customer@123', amount: 1000}
);
```

### Répondre à un appel API

```javascript
// Traiter un appel API POST entrant
const compendium = new Compendium(this);
const result = await compendium.onAPICall('POST', '/api/invoices', req.body);
```

### Exécution directe d'une chronicle

```javascript
// Créer et exécuter une chronicle directement
const chronicle = await new Chronicle(this).create(
  'chronicle@unique-id',
  'system@compendium',
  'workflow@my-workflow'
);

const result = await chronicle.begin(
  'system@compendium',
  'workflow@my-workflow',
  'context@execution',
  new Date().toISOString(),
  'user@admin',
  {inputData: 'value'}
);
```

### Structure d'un workflow dans le système de fichiers Gold

```
workflows/
  my-workflow/
    workflow.json    ← Définition du workflow (id, name, triggers, outputPersistence…)
    index.js         ← Script exécuté par la Chronicle
```

Exemple de script `index.js` exécuté dans la VM :

```javascript
// Signature imposée par le SDK
module.exports = async function main(app, db, context, data) {
  // app : instance App du SDK Yennefer
  // db  : instance Database du SDK Yennefer
  // context : ScriptDataContext (contextId, workflowId, createdBy, createdAt, instanceId)
  // data : données d'entrée du workflow
  const result = await db.query(/* ... */);
  return {output: result};
};
```

## Interactions avec d'autres modules

- **goblin-yennefer** : Fournit les définitions de base pour les workflows (`WorkflowShape`, `WorkflowTriggerShape`), les états persistés et le SDK d'exécution (`Database`, `App`, `ScriptDataContext`, `BusinessEvents`). Ce module est une dépendance interne non publique (FIXME mentionné dans le code).
- **[goblin-chest]** : Utilisé pour stocker et récupérer les scripts des workflows via le système `GoldFs` (résolution de chemins, lecture de répertoires, lecture JSON, calcul de checksum).
- **[xcraft-core-goblin]** : Fournit l'infrastructure Elf pour les acteurs (`Elf`, `Elf.Alone`, `Elf.Spirit`, `Elf.Sculpt`).
- **[xcraft-core-stones]** : Utilisé pour la validation et la déclaration des types de données dans les shapes (`string`, `array`, `option`, `enumeration`, `id`).
- **[xcraft-core-etc]** : Gestion de la configuration pour déterminer le contexte d'exécution (serveur/client) via `xcraft-core-goblin` et `xcraft-core-horde`.
- **[xcraft-core-utils]** : Fournit `fileChecksum` pour le calcul du hash SHA256 des fichiers de workflow, permettant la détection de modifications.

## Détails des sources

### `chronicle.js`

Fichier racine exposant les commandes Xcraft pour l'acteur `Chronicle` via `Elf.birth()`. Il fait le lien entre le système de commandes Xcraft et l'implémentation dans `lib/chronicle.js`.

### `compendium.js`

Fichier racine exposant les commandes Xcraft pour l'acteur `Compendium` via `Elf.birth()`. Il fait le lien entre le système de commandes Xcraft et l'implémentation singleton dans `lib/compendium.js`.

### `lib/chronicle.js`

Définit l'acteur Elf instanciable `Chronicle`, responsable de l'exécution d'un workflow spécifique dans une VM JavaScript isolée.

#### État et modèle de données

L'état est défini par `ChronicleShape` :

| Champ               | Type                            | Description                            |
| ------------------- | ------------------------------- | -------------------------------------- |
| `id`                | `string`                        | Identifiant unique de la chronique     |
| `workflowId`        | `id('workflow')`                | Référence au workflow à exécuter       |
| `outputPersistence` | `enumeration('events', 'none')` | Mode de persistance des résultats      |
| `sourceName`        | `string`                        | Nom/chemin du script source à exécuter |

#### Cycle de vie

L'acteur `Chronicle` est **instanciable** : il expose une quête `create` et se détruit automatiquement à la fin de l'exécution de `begin` (via `this.kill()`). Il n'expose pas de quête `delete` explicite.

#### Méthodes publiques

- **`create(id, desktopId, workflowId)`** — Crée une nouvelle instance de Chronicle pour un workflow donné. Valide l'existence du workflow dans la base de données (`WorkflowLogic.db`) et initialise l'état avec les informations récupérées (`sourceName`, `outputPersistence`). Lève une erreur si `workflowId` est absent ou si le workflow n'existe pas.

- **`begin(desktopId, workflowId, contextId, createdAt, createdBy, initialData)`** — Point d'entrée principal pour l'exécution du workflow. Génère un `instanceId` unique, construit le `ScriptDataContext`, déclenche les événements de cycle de vie et exécute le script via `_runUserScript`. En cas d'erreur, appelle `cancelWorkflow` ; en cas de succès, appelle `endWorkflow`. L'acteur se supprime automatiquement en fin d'exécution (dans le bloc `finally`).

- **`startWorkflow(context, data)`** — Enregistre un événement `workflow-started` dans le système d'événements métier pour marquer le début de l'exécution.

- **`cancelWorkflow(context, data)`** — Enregistre un événement `workflow-canceled` lorsque le script lève une exception, en incluant la stack trace dans les données de résultat.

- **`endWorkflow(context, data)`** — Enregistre un événement `workflow-ended` pour marquer la fin réussie du workflow, avec les données de sortie si `outputPersistence === 'events'`.

### `lib/compendium.js`

Définit l'acteur Elf singleton `Compendium` (dérivant de `Elf.Alone`) qui orchestre l'ensemble des workflows et gère leur cycle de vie global.

#### État et modèle de données

L'état est défini par `CompendiumShape` :

| Champ        | Type                          | Description                                         |
| ------------ | ----------------------------- | --------------------------------------------------- |
| `id`         | `string`                      | Identifiant du compendium (toujours `'compendium'`) |
| `chronicles` | `array(id('chronicle'))`      | Liste des identifiants des chroniques en cours      |
| `triggers`   | `array(WorkflowTriggerShape)` | Liste des déclencheurs de workflow actifs           |

#### État interne (non persisté)

Le `Compendium` maintient trois tableaux de règles en mémoire, réinitialisés à chaque appel de `loadTriggers` :

- **`_serverEventRules`** : Règles pour les événements métier côté serveur
- **`_clientEventRules`** : Règles pour les événements métier côté client
- **`_serverAPIRules`** : Règles pour les appels API côté serveur

#### Cycle de vie

Le `Compendium` est un acteur **singleton** exposant une quête `init` appelée une seule fois au démarrage. Il n'a pas de quête `delete`.

#### Méthodes publiques

- **`init()`** — Initialise le Compendium : configure les abonnements `cryo` sur les namespaces `gold` et `workflowTrigger` (avec debounce de 1000 ms), ajoute une vue et un hook sur les événements métier. Le chargement des workflows depuis Gold n'est effectué que si aucun horde n'est configuré ou si le contexte est serveur.

- **`trigger(desktopId, workflowTriggerId, contextId?, contextData?)`** — Déclenche l'exécution d'un workflow via son identifiant de trigger. Récupère les données du trigger (workflowId, data, waitFor), gère optionnellement l'attente de données via `BusinessEvents.waitEventData`, puis délègue à `beginChronicle`. Retourne les données de résultat du workflow.

- **`onAPICall(verb, route, body, multiMatch?)`** — Traite les appels API entrants en cherchant une correspondance dans `_serverAPIRules` par verb+route. Avec `multiMatch = true`, déclenche tous les workflows correspondants et retourne un tableau de résultats ; sinon retourne le premier résultat.

- **`onBusinessEventCreated(event, callerDesktopId)`** — Traite les événements métier côté client. Évalue chaque règle de `_clientEventRules` via `matchRule` et déclenche les workflows correspondants avec le `desktopId` de l'appelant.

- **`update(events)`** — Traite un tableau d'événements métier côté serveur. Évalue chaque règle de `_serverEventRules` et déclenche les workflows correspondants avec `_desktopId` système.

- **`loadTriggers()`** — Recharge tous les déclencheurs actifs (`enabled = true`) depuis la base de données `workflowTrigger`, réinitialise les trois tableaux de règles et enregistre les nouveaux déclencheurs selon le contexte d'exécution. Disponible aussi sous forme debounced via `loadTriggersDebounced`.

- **`loadWorkflows()`** — Charge les workflows depuis le namespace `workflows/` du système de fichiers Gold via `_resourcesLoader`. Supprime les workflows détachés, détecte les modifications via hash SHA256 et met à jour la base de données pour les workflows modifiés ainsi que leurs triggers associés. Disponible aussi sous forme debounced via `loadWorkflowsDebounced`.

- **`beginChronicle(desktopId, workflowId, meta, data)`** — Crée une nouvelle instance de `Chronicle`, enregistre son identifiant dans l'état du compendium et lance l'exécution via `chronicle.begin()`. Retourne les données de résultat.

#### Fonction utilitaire `matchRule`

La fonction `matchRule(rule, event)` est exportée dans le scope du module pour évaluer si un événement correspond à une règle de déclenchement. Elle compare récursivement les propriétés de l'événement avec celles de la règle, en traitant spécialement le sous-objet `data` pour permettre des correspondances partielles sur les propriétés imbriquées.

## Licence

Ce module est distribué sous [licence MIT](./LICENSE).

[goblin-chest]: https://github.com/Xcraft-Inc/goblin-chest
[xcraft-core-goblin]: https://github.com/Xcraft-Inc/xcraft-core-goblin
[xcraft-core-stones]: https://github.com/Xcraft-Inc/xcraft-core-stones
[xcraft-core-etc]: https://github.com/Xcraft-Inc/xcraft-core-etc
[xcraft-core-utils]: https://github.com/Xcraft-Inc/xcraft-core-utils

---

_Ce contenu a été généré par IA_
