/**
 * @fileoverview Script de surveillance des documents rendus publics sur Google Drive.
 * Utilise l'API Admin SDK pour détecter les événements et notifie les propriétaires.
 * @author Fabrice Faucheux
 */

// --- Configuration Globale ---
const CONFIGURATION = {
  EMAIL_ASSISTANCE: "support@domaine.com",
  NOM_EXPEDITEUR: "Alerte Sécurité Workspace",
  IDS_A_EXCLURE: [], // IDs de fichiers légitimement publics
  DELAI_ANALYSE_HEURES: 24 // Période de temps à analyser en arrière
};

const ANNEE_ACTUELLE = new Date().getFullYear();

/**
 * Point d'entrée principal.
 * Orchestre la récupération des logs, le filtrage et l'envoi des notifications.
 */
function notifierProprietairesFichiersPublics() {
  console.time("ExecutionScript");
  Logger.log("Début du processus de surveillance des fichiers publics.");

  try {
    const evenements = recupererEvenementsVisibilite();
    
    if (evenements.length === 0) {
      Logger.log("Aucun événement de changement de visibilité détecté sur la période.");
      return;
    }

    const fichiersConfirmes = filtrerEtConfirmerFichiersPublics(evenements);
    
    if (fichiersConfirmes.length === 0) {
      Logger.log("Aucun fichier actif public nécessitant une alerte n'a été trouvé.");
      return;
    }

    const fichiersParProprietaire = grouperFichiersParProprietaire(fichiersConfirmes);
    envoyerEmailAuxProprietaires(fichiersParProprietaire);
    
  } catch (erreur) {
    console.error(`Erreur critique dans le script principal : ${erreur.message}`);
  } finally {
    Logger.log("Fin du processus.");
    console.timeEnd("ExecutionScript");
  }
}

/**
 * Récupère les logs d'audit Drive via l'Admin SDK pour les changements de visibilité.
 * @return {Array<Object>} Liste des événements bruts de l'API.
 */
function recupererEvenementsVisibilite() {
  const tempsDebut = new Date(new Date().getTime() - CONFIGURATION.DELAI_ANALYSE_HEURES * 60 * 60 * 1000).toISOString();
  const nomEvenement = 'change_document_visibility';
  let tousEvenements = [];
  let pageToken;

  try {
    do {
      // Appel à l'API Admin Reports (Service avancé requis)
      const reponse = AdminReports.Activities.list('all', 'drive', {
        eventName: nomEvenement,
        startTime: tempsDebut,
        maxResults: 500,
        pageToken: pageToken
      });
      
      if (reponse.items) {
        tousEvenements = [...tousEvenements, ...reponse.items];
      }
      pageToken = reponse.nextPageToken;
      
    } while (pageToken);

    Logger.log(`${tousEvenements.length} événements bruts récupérés depuis le ${tempsDebut}.`);
    return tousEvenements;

  } catch (erreur) {
    const messageErreur = `Erreur lors de la récupération des logs Admin SDK : ${erreur.message}`;
    console.error(messageErreur);
    MailApp.sendEmail(CONFIGURATION.EMAIL_ASSISTANCE, "Erreur Critique - Script Surveillance Drive", messageErreur);
    return [];
  }
}

/**
 * Filtre les événements pour ne garder que les fichiers réellement accessibles publiquement.
 * Vérifie l'état actuel via DriveApp (car l'utilisateur a pu corriger le tir entre temps).
 * * @param {Array<Object>} evenements - Liste des événements bruts.
 * @return {Array<Object>} Liste des fichiers confirmés publics et structurés.
 */
function filtrerEtConfirmerFichiersPublics(evenements) {
  const fichiersConfirmes = [];
  const idsTraites = new Set(); // Pour éviter les doublons si plusieurs events sur le même fichier

  evenements.forEach(activite => {
    // Structure de l'objet activity de l'API Reports
    const evenement = activite.events[0];
    
    // Transformation des paramètres (clé/valeur) en objet simple
    const parametres = evenement.parameters.reduce((acc, param) => {
      acc[param.name] = param.value || param.boolValue;
      return acc;
    }, {});

    const { visibility, owner_is_shared_drive, owner, doc_id, doc_title } = parametres;

    // Critères de filtrage initiaux
    const estPublicTheorique = ['public_on_the_web', 'anyone_with_link', 'people_with_link'].includes(visibility);
    const estDisquePartage = owner_is_shared_drive === true; // On exclut souvent les Shared Drives car gérés différemment

    if (estPublicTheorique && !estDisquePartage && owner && doc_id && !idsTraites.has(doc_id)) {
      idsTraites.add(doc_id);

      if (CONFIGURATION.IDS_A_EXCLURE.includes(doc_id)) return;

      // Vérification de l'état RÉEL actuel via DriveApp
      const itemConfirme = recupererItemSiToujoursPublic(doc_id);
      
      if (itemConfirme) {
        const typeAcces = itemConfirme.getSharingAccess();
        const descriptionPartage = (typeAcces === DriveApp.Access.ANYONE) 
          ? "Public sur le Web (Indexable)" 
          : "Tous les utilisateurs avec le lien";

        Logger.log(`[CONFIRMÉ] "${doc_title}" (${owner}) est exposé : ${descriptionPartage}`);

        fichiersConfirmes.push({
          idDocument: doc_id,
          titreDocument: doc_title,
          proprietaire: owner,
          urlFichier: itemConfirme.getUrl(),
          typePartage: descriptionPartage
        });
      }
    }
  });

  return fichiersConfirmes;
}

/**
 * Tente de récupérer un fichier ou un dossier et vérifie son accès public actuel.
 * Gère la distinction Fichier/Dossier via try/catch.
 * * @param {string} idDocument - L'ID du fichier ou dossier Drive.
 * @return {GoogleAppsScript.Drive.File|GoogleAppsScript.Drive.Folder|null} L'objet Drive si public, sinon null.
 */
function recupererItemSiToujoursPublic(idDocument) {
  try {
    let item;
    // DriveApp ne permet pas de savoir si c'est un fichier ou dossier juste avec l'ID sans tester
    try {
      item = DriveApp.getFileById(idDocument);
    } catch (e) {
      item = DriveApp.getFolderById(idDocument);
    }

    const acces = item.getSharingAccess();
    const estPublic = (acces === DriveApp.Access.ANYONE || acces === DriveApp.Access.ANYONE_WITH_LINK);
    
    return estPublic ? item : null;

  } catch (erreur) {
    // L'item a peut-être été supprimé ou l'ID est invalide
    // Logger.log(`Impossible d'accéder à l'ID ${idDocument} : ${erreur.message}`);
    return null;
  }
}

/**
 * Regroupe la liste des fichiers par adresse email du propriétaire.
 * * @param {Array<Object>} fichiers - Liste plate des fichiers.
 * @return {Object} Objet indexé par email contenant les tableaux de fichiers.
 */
function grouperFichiersParProprietaire(fichiers) {
  return fichiers.reduce((acc, fichier) => {
    if (!acc[fichier.proprietaire]) {
      acc[fichier.proprietaire] = [];
    }
    acc[fichier.proprietaire].push(fichier);
    return acc;
  }, {});
}

/**
 * Envoie un email récapitulatif à chaque propriétaire concerné.
 * * @param {Object} fichiersParProprietaire - Objet groupé par email.
 */
function envoyerEmailAuxProprietaires(fichiersParProprietaire) {
  Object.entries(fichiersParProprietaire).forEach(([emailProprietaire, fichiers]) => {
    
    const sujet = `⚠️ Action requise : ${fichiers.length} document(s) détecté(s) public(s)`;
    
    // Construction des lignes du tableau HTML
    const lignesTableau = fichiers.map(f => `
      <tr>
        <td style="padding: 8px; border-bottom: 1px solid #ddd;">
          <a href="${f.urlFichier}" target="_blank" style="color: #1a73e8; text-decoration: none; font-weight: bold;">
            ${f.titreDocument}
          </a>
        </td>
        <td style="padding: 8px; border-bottom: 1px solid #ddd; color: #d93025;">
          ${f.typePartage}
        </td>
      </tr>
    `).join('');

    const contenuEmail = `
      <p>Bonjour,</p>
      <p>Le système de sécurité a détecté que les éléments suivants sont configurés avec un accès <strong>public</strong> (accessibles hors de l'organisation).</p>
      
      <table style="width: 100%; border-collapse: collapse; margin-top: 15px; margin-bottom: 15px;">
        <thead>
          <tr style="background-color: #f1f3f4; text-align: left;">
            <th style="padding: 10px; border-bottom: 2px solid #ddd;">Nom du Document</th>
            <th style="padding: 10px; border-bottom: 2px solid #ddd;">Niveau d'exposition</th>
          </tr>
        </thead>
        <tbody>
          ${lignesTableau}
        </tbody>
      </table>

      <div style="background-color: #e8f0fe; padding: 15px; border-radius: 5px; border-left: 5px solid #1967d2;">
        <strong>Action recommandée :</strong><br>
        Veuillez cliquer sur les liens ci-dessus et modifier les paramètres de partage (bouton "Partager") pour restreindre l'accès si cette visibilité n'est pas nécessaire.
      </div>
      
      <p style="font-size: 12px; color: #5f6368; margin-top: 20px;">
        Pour toute question, contactez le support : <a href="mailto:${CONFIGURATION.EMAIL_ASSISTANCE}">${CONFIGURATION.EMAIL_ASSISTANCE}</a>
      </p>
    `;

    const corpsHtmlFinal = genererGabaritEmail(sujet, contenuEmail);

    try {
      MailApp.sendEmail({
        to: emailProprietaire,
        subject: sujet,
        htmlBody: corpsHtmlFinal,
        replyTo: CONFIGURATION.EMAIL_ASSISTANCE,
        name: CONFIGURATION.NOM_EXPEDITEUR
      });
      Logger.log(`Notification envoyée à ${emailProprietaire}.`);
    } catch (e) {
      console.error(`Échec d'envoi à ${emailProprietaire}: ${e.message}`);
    }
  });
}

/**
 * Génère un template HTML propre pour les emails.
 * * @param {string} titre - Titre de l'email.
 * @param {string} contenuHtml - Contenu du corps.
 * @return {string} HTML complet.
 */
function genererGabaritEmail(titre, contenuHtml) {
  return `
    <!DOCTYPE html>
    <html lang="fr">
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f5f7; color: #3c4043; margin: 0; padding: 0; }
        .container { background-color: #ffffff; max-width: 600px; margin: 20px auto; padding: 30px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.12); border: 1px solid #dadce0; }
        h1 { font-size: 22px; color: #202124; margin-top: 0; }
        .footer { margin-top: 30px; font-size: 11px; color: #9aa0a6; text-align: center; border-top: 1px solid #f1f3f4; padding-top: 10px; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>${titre}</h1>
        <div class="content">${contenuHtml}</div>
        <div class="footer">
          &copy; ${ANNEE_ACTUELLE} Sécurité Informatique - Notification Automatique
        </div>
      </div>
    </body>
    </html>
  `;
}
