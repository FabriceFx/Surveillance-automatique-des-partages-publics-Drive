# Surveillance automatique des partages publics Drive

![License MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Platform](https://img.shields.io/badge/Platform-Google%20Apps%20Script-green)
![Runtime](https://img.shields.io/badge/Google%20Apps%20Script-V8-green)
![Author](https://img.shields.io/badge/Auteur-Fabrice%20Faucheux-orange)

Ce projet Google Apps Script surveille automatiquement l'activité du domaine Google Workspace pour détecter les fichiers ou dossiers partagés publiquement ("Anyone with the link" ou "Public on the web"). Il notifie ensuite individuellement chaque propriétaire par e-mail pour validation.

## Fonctionnalités clés

* **Audit via API Admin SDK** : Utilise les journaux d'audit de Drive (`AdminReports`) pour une détection efficace sans scanner tous les fichiers.
* **Double Vérification** : Vérifie l'état *actuel* du fichier via `DriveApp` avant d'envoyer l'alerte (évite les faux positifs si l'utilisateur a déjà corrigé).
* **Support Fichiers & Dossiers** : Gère intelligemment les différents types d'items Drive.
* **Notifications Groupées** : Envoie un seul e-mail récapitulatif par propriétaire contenant la liste de ses fichiers exposés.
* **Exclusions** : Permet de définir une liste blanche d'IDs de fichiers (ex: logos, conditions générales) à ignorer.

## Prérequis techniques

1.  Être **Super Admin** ou avoir les droits délégués pour accéder aux rapports d'audit Drive.
2.  Avoir accès à l'éditeur de scripts Google Apps Script.

## Installation manuelle

### 1. Création du script
1.  Créez un nouveau projet sur [script.google.com](https://script.google.com).
2.  Copiez le contenu du fichier `Code.js` fourni dans l'éditeur.

### 2. Activation du service avancé (CRITIQUE)
Ce script nécessite l'accès à l'API Admin SDK.
1.  Dans l'éditeur Apps Script, cliquez sur le **+** à côté de **Services** (colonne de gauche).
2.  Recherchez **Admin SDK API**.
3.  Sélectionnez-le et choisissez l'identifiant `AdminReports` (ou assurez-vous de renommer l'appel dans le code si vous gardez `AdminDirectory` par défaut, mais ici nous utilisons `AdminReports`).
4.  Cliquez sur **Ajouter**.

### 3. Configuration
Modifiez l'objet `CONFIGURATION` en haut du script :
```javascript
const CONFIGURATION = {
  EMAIL_ASSISTANCE: "votre-email-support@domaine.com",
  // ...
};
