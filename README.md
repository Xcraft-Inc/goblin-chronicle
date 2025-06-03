# 📘 Documentation du module goblin-chronicle

## Aperçu

Le module `goblin-chronicle` est un système d'exécution de workflows scriptés dans l'écosystème Xcraft. Il permet de définir, déclencher et suivre l'exécution de scripts métier (workflows) en réponse à divers événements comme des événements métier ou des appels API. Ce module fournit un mécanisme puissant pour orchestrer des processus métier complexes de manière déclarative et réactive.

## Sommaire

- [Structure du module](#structure-du-module)
- [Fonctionnement global](#fonctionnement-global)
- [Exemples d'utilisation](#exemples-dutilisation)
- [Interactions avec d'autres modules](#interactions-avec-dautres-modules)
- [Détails des sources](#détails-des-sources)

## Structure du module

Le module est composé de deux acteurs principaux :

1. **Chronicle** - Un acteur instanciable qui exécute un workflow spécifique dans un contexte donné
2. **Compendium** - Un acteur singleton qui gère l'ensemble des workflows et leurs déclencheurs

Ces acteurs interagissent avec d'autres modules comme goblin-yennefer (pour la définition des workflows), [goblin-chest] (pour le stockage de fichiers) et le système d'événements métier de Xcraft.

## Fonctionnement global

Le module `goblin-chronicle` implémente un système de workflows basé sur des scripts JavaScript. Voici comment il fonctionne :

1. **Définition des workflows** : Les workflows sont définis avec un script source, des métadonnées et des déclencheurs (triggers).
2. **Chargement automatique** : Le `Compendium` surveille les changements dans le système de fichiers Gold et recharge automatiquement les workflows modifiés.
3. **Enregistrement des déclencheurs** : Les déclencheurs (triggers) sont enregistrés pour réagir à des événements métier ou des appels API selon le contexte (serveur/client).
4. **Exécution des workflows** : Lorsqu'un déclencheur est activé, le `Compendium` crée une instance de `Chronicle` qui exécute le script associé au workflow.
5. **Suivi du cycle de vie** : Le système enregistre des événements métier pour suivre le cycle de vie des workflows (démarrage, fin, annulation).
6. **Persistance des résultats** : Les résultats des workflows peuvent être persistés sous forme d'événements métier selon la configuration.

Le module utilise une machine virtuelle JavaScript (VM) pour exécuter les scripts des workflows dans un environnement contrôlé, avec accès à un SDK spécifique qui fournit des fonctionnalités comme l'accès à la base de données et les interactions avec l'application.

## Exemples d'utilisation

### Déclenchement d'un workflow

```javascript
// Déclencher un workflow via son trigger
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
// Dans un middleware API
const compendium = new Compendium(this);
const result = await compendium.onAPICall('POST', '/api/invoices', req.body);
```

### Exécution directe d'un workflow

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

## Interactions avec d'autres modules

- **goblin-yennefer** : Fournit les définitions de base pour les workflows, leurs déclencheurs et les événements métier
- **[goblin-chest]** : Utilisé pour stocker et récupérer les scripts des workflows via le système GoldFs
- **[xcraft-core-goblin]** : Fournit l'infrastructure Elf pour les acteurs
- **[xcraft-core-stones]** : Utilisé pour la validation des types de données
- **[xcraft-core-etc]** : Gestion de la configuration pour déterminer le contexte d'exécution (serveur/client)

## Détails des sources

### `chronicle.js` (point d'entrée)

Ce fichier expose les commandes Xcraft pour l'acteur `Chronicle` via `Elf.birth()`. Il fait le lien entre le système de commandes Xcraft et l'implémentation de l'acteur.

### `compendium.js` (point d'entrée)

Ce fichier expose les commandes Xcraft pour l'acteur `Compendium` via `Elf.birth()`. Il fait le lien entre le système de commandes Xcraft et l'implémentation de l'acteur singleton.

### `lib/chronicle.js`

Ce fichier définit l'acteur `Chronicle` qui est responsable de l'exécution d'un workflow spécifique.

#### État et modèle de données

L'état de l'acteur `Chronicle` est défini par `ChronicleShape` :

- **`id`** (string) : Identifiant unique de la chronique
- **`workflowId`** (id) : Référence au workflow à exécuter
- **`outputPersistence`** (enumeration) : Mode de persistance des résultats ('events' ou 'none')
- **`sourceName`** (string) : Nom du script source à exécuter

#### Méthodes publiques

**`create(id, desktopId, workflowId)`** - Crée une nouvelle instance de Chronicle pour exécuter un workflow spécifique. Valide l'existence du workflow et initialise l'état de l'acteur avec les informations du workflow récupérées depuis la base de données.

**`begin(desktopId, workflowId, contextId, createdAt, createdBy, initialData)`** - Point d'entrée principal pour l'exécution d'un workflow. Orchestre l'ensemble du processus : création du contexte, exécution du script, gestion des événements de cycle de vie et nettoyage final. L'acteur se supprime automatiquement à la fin de l'exécution.

**`startWorkflow(context, data)`** - Enregistre un événement 'workflow-started' pour marquer le début de l'exécution du workflow dans le système d'événements métier.

**`cancelWorkflow(context, data)`** - Enregistre un événement 'workflow-canceled' lorsque le workflow échoue ou est annulé, incluant les détails de l'erreur.

**`endWorkflow(context, data)`** - Enregistre un événement 'workflow-ended' pour marquer la fin réussie du workflow avec les données de sortie si configuré.

#### Méthodes privées

**`_getFileSource(sourceName)`** - Récupère l'emplacement physique d'un fichier script via le système GoldFs de goblin-chest.

**`_runUserScript(desktopId, context, data)`** - Exécute le script utilisateur dans une VM JavaScript sécurisée avec accès au SDK Yennefer (Database, App, etc.). Gère les erreurs d'exécution et retourne un objet avec les propriétés `error` et `data`.

### `lib/compendium.js`

Ce fichier définit l'acteur singleton `Compendium` qui gère l'ensemble des workflows et leurs déclencheurs.

#### État et modèle de données

L'état de l'acteur `Compendium` est défini par `CompendiumShape` :

- **`id`** (string) : Identifiant du compendium (toujours 'compendium')
- **`chronicles`** (array) : Liste des identifiants des chroniques actives
- **`triggers`** (array) : Liste des déclencheurs de workflow actifs

#### Méthodes publiques

**`init()`** - Initialise le Compendium en configurant les abonnements aux événements de mise à jour des workflows et triggers. Configure également les hooks pour les événements métier et détermine le contexte d'exécution (serveur/client) selon la configuration.

**`trigger(desktopId, workflowTriggerId, contextId, contextData)`** - Déclenche l'exécution d'un workflow via son trigger. Gère la logique d'attente de données si nécessaire (propriété `waitFor`) et crée une nouvelle Chronicle pour l'exécution.

**`onAPICall(verb, route, body, multiMatch)`** - Traite les appels API entrants et déclenche les workflows correspondants selon les règles d'endpoint configurées. Supporte l'exécution multiple si `multiMatch` est activé.

**`onBusinessEventCreated(event)`** - Traite les événements métier côté client et déclenche les workflows correspondants selon les règles d'événements configurées.

**`update(events)`** - Traite les événements métier côté serveur et déclenche les workflows correspondants selon les règles d'événements. Méthode appelée par le système d'événements métier.

**`loadTriggers()`** - Charge et enregistre tous les déclencheurs actifs depuis la base de données, en les catégorisant selon leur type (businessEvent/api) et contexte d'exécution (server/client). Utilise un debounce pour éviter les rechargements trop fréquents.

**`loadWorkflows()`** - Charge les workflows depuis les ressources du système de fichiers Gold et les enregistre dans la base de données. Gère la détection des changements via un hash SHA256 et supprime les workflows détachés. Utilise un debounce pour optimiser les performances.

**`beginChronicle(desktopId, workflowId, meta, data)`** - Crée et démarre une nouvelle instance de Chronicle pour exécuter un workflow avec les données fournies. Enregistre la chronicle dans l'état du compendium.

#### Méthodes privées

**`registerServerBusinessEventTrigger(triggerId)`** - Enregistre un déclencheur d'événement métier côté serveur dans `_serverEventRules`.

**`registerServerAPITrigger(triggerId)`** - Enregistre un déclencheur d'API côté serveur dans `_serverAPIRules`.

**`registerClientBusinessEventTrigger(triggerId)`** - Enregistre un déclencheur d'événement métier côté client dans `_clientEventRules`.

**`_resourcesLoader(namespace)`** - Charge les définitions de workflows depuis le système de fichiers Gold. Recherche les dossiers contenant un fichier `workflow.json` et un script `index.js` dans le namespace spécifié.

**`_trashDetachedWorkflows(workflows)`** - Supprime les workflows et triggers qui ne sont plus présents dans les ressources, maintenant ainsi la cohérence entre le système de fichiers et la base de données.

#### Gestion des règles de déclenchement

Le `Compendium` maintient trois types de règles selon le contexte d'exécution :

1. **`_serverEventRules`** : Règles pour les événements métier côté serveur
2. **`_clientEventRules`** : Règles pour les événements métier côté client
3. **`_serverAPIRules`** : Règles pour les appels API côté serveur

La fonction utilitaire `matchRule(rule, event)` détermine si un événement correspond à une règle de déclenchement en comparant récursivement les propriétés de l'événement avec celles définies dans la règle, incluant les propriétés imbriquées dans `data`.

#### Cycle de vie et surveillance

Le Compendium utilise un système de surveillance automatique :

- **Surveillance des workflows** : Écoute les changements dans le système Gold via `<compendium-gold-updated>`
- **Surveillance des triggers** : Écoute les changements dans la base de données via `<compendium-workflowTrigger-updated>`
- **Debouncing** : Les méthodes `loadWorkflowsDebounced` et `loadTriggersDebounced` évitent les rechargements trop fréquents

_Ce document est une mise à jour de la documentation précédente._

[goblin-chest]: https://github.com/Xcraft-Inc/goblin-chest
[xcraft-core-goblin]: https://github.com/Xcraft-Inc/xcraft-core-goblin
[xcraft-core-stones]: https://github.com/Xcraft-Inc/xcraft-core-stones
[xcraft-core-etc]: https://github.com/Xcraft-Inc/xcraft-core-etc
