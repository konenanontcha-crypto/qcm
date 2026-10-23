# QCM GESTOCI v2.0

Application web de QCM pour les participants d'une présentation. Les participants scannent un QR code unique, répondent sur leur téléphone aux questions dans un ordre aléatoire, saisissent leur nom et leur matricule, puis reçoivent leur note sur 20 et la correction.

- **Pages web** : hébergées gratuitement sur GitHub Pages.
- **Base de données, notation et comptes admin** : Supabase (offre gratuite).
- **Questions** : importées depuis un modèle Excel, un QCM par présentation.

## Contenu du dépôt

| Fichier | Rôle |
|---|---|
| `index.html`, `app.js` | page participant (celle que le QR code ouvre) |
| `admin.html`, `admin.js` | espace administrateur |
| `qr.html`, `qr.js` | QR code unique du site |
| `config.js` | **à remplir** : adresse et clé publique de votre projet Supabase |
| `api.js` | accès aux données (Supabase, ou mode démo) |
| `xlsx-lecteur.js` | lecture du fichier Excel importé, dans le navigateur |
| `modele_questions_qcm.xlsx` | modèle à remplir pour chaque QCM |
| `supabase/schema.sql` | script à exécuter une fois dans Supabase |

## Installation (environ 20 minutes, une seule fois)

### 1. Supabase

1. Créez un compte sur [supabase.com](https://supabase.com), puis un projet (**New project**). Choisissez une région proche, notez le mot de passe de la base.
2. Ouvrez **SQL Editor > New query**, collez tout le contenu de `supabase/schema.sql`, puis cliquez sur **Run**. Le message doit être « Success ».
3. Ouvrez **Authentication > Users > Add user > Create new user**. Saisissez votre e-mail et un mot de passe solide, cochez **Auto Confirm User**.
4. Revenez dans **SQL Editor** et exécutez, avec votre e-mail :
   ```sql
   insert into public.admins (email) values (lower('votre.email@exemple.com')) on conflict do nothing;
   ```
5. Dans **Authentication > Sign In / Providers**, désactivez **Allow new users to sign up**. Seuls les comptes que vous créez pourront exister.
6. Dans **Project Settings**, copiez :
   - **Project URL** (`https://xxxx.supabase.co`) ;
   - la **Publishable key** (`sb_publishable_…`) ou, sur un ancien projet, la clé **anon public** (`eyJ…`).

   Ne copiez jamais la *secret key* ni la clé *service_role*.

### 2. Configuration

Ouvrez `config.js` et remplacez les deux valeurs :

```js
window.QCM_CONFIG = {
  SUPABASE_URL: "https://xxxx.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_xxxxxxxx",
  DEMO: false
};
```

### 3. GitHub Pages

1. Sur [github.com](https://github.com), créez un dépôt **public** (par exemple `qcm`). GitHub Pages n'est gratuit que pour les dépôts publics. Le code est donc visible, mais pas les questions, les réponses ni les résultats : ils restent dans Supabase.
2. Envoyez tous les fichiers du dossier dans le dépôt (**Add file > Upload files**, glissez le contenu du dossier, puis **Commit changes**).
3. Dans **Settings > Pages**, choisissez **Deploy from a branch**, branche **main**, dossier **/ (root)**, puis **Save**.
4. Après une à deux minutes, le site est en ligne à l'adresse `https://votre-compte.github.io/qcm/`.

## Utilisation

1. Ouvrez `https://votre-compte.github.io/qcm/admin.html` et connectez-vous.
2. **Nouveau QCM** : saisissez le titre et la date, téléchargez le modèle Excel, remplissez-le, importez-le. Le site signale les erreurs ligne par ligne avant l'enregistrement.
3. Le jour de la présentation, cliquez sur **Mettre en cours** pour ce QCM.
4. **QR code du site** : imprimez ou projetez le QR code. Il ne change jamais : il ouvre toujours le QCM mis en cours.
5. **Résultats** : statistiques, tableau, suppression d'un passage, **Exporter en CSV** (s'ouvre dans Excel).
6. Après la séance, cliquez sur **Retirer** : les participants voient « Aucun QCM en cours ».

Un QCM peut être modifié à tout moment (titre, date, seuil, ou nouvel import Excel). Les notes déjà enregistrées ne changent pas. Un participant qui avait commencé avant la modification est invité à recharger la page.

## Bon à savoir

- L'offre gratuite de Supabase met un projet en **pause après 7 jours sans activité**. Avant une présentation, ouvrez le tableau de bord Supabase et réactivez le projet s'il est en pause (**Restore project**).
- Les bonnes réponses ne sont jamais envoyées au téléphone avant la validation : la note est calculée par Supabase.
- Les noms et matricules sont des données personnelles (loi n°2013-450). Supprimez les QCM et résultats qui ne servent plus.
- Mode démo : mettez `DEMO: true` dans `config.js` pour essayer le site sans Supabase (données gardées dans le navigateur).
