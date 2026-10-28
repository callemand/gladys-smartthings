# SmartThings

## Présentation

Cette intégration connecte Gladys Assistant au cloud **Samsung SmartThings**
pour piloter les appareils SmartThings de votre compte directement depuis
Gladys.

Une fois configurée, tous les appareils compatibles de votre compte SmartThings
apparaissent dans l'écran **Découverte** de Gladys. L'intégration associe chaque
_capability_ SmartThings à une fonctionnalité Gladys : un même appareil peut
donc exposer plusieurs fonctionnalités. Les capabilities prises en charge sont :

- **Interrupteurs, prises et électroménagers** — marche/arrêt (`switch`), et, si
  l'appareil mesure la consommation, puissance instantanée (W) et tension
  (lecture seule) ; les électroménagers Samsung remontent leur puissance via
  `powerConsumptionReport`, et leur sécurité enfant (`samsungce.kidsLock`) est
  exposée en lecture seule. Le compteur d'énergie cumulée n'est
  volontairement pas exposé (un total cumulé n'est pas exploitable par
  appareil) ;
- **Lumières** — marche/arrêt, luminosité, teinte, saturation et température de
  couleur ;
- **Serrures** — verrouiller / déverrouiller (`lock`) ;
- **Volets motorisés** — position 0–100 % (`windowShadeLevel`) ;
- **Thermostats** — mode, consigne de chauffage et consigne de climatisation ;
- **Capteurs** (lecture seule, avec historique) — température, humidité,
  ouverture (contact), mouvement, présence, fuite d'eau, fumée, batterie,
  luminosité, CO2 et indice de qualité d'air.

L'état des appareils est rafraîchi toutes les 10 secondes : un changement fait
depuis l'application SmartThings ou un interrupteur physique apparaît dans
Gladys peu après.

L'intégration lit le **composant principal** (« main ») de chaque appareil (le
composant standard des appareils grand public). Les appareils n'exposant que des
capabilities non prises en charge (par exemple un hub) ne sont pas publiés.

## Prérequis

- Un **compte Samsung SmartThings** avec vos appareils déjà ajoutés dans
  l'application mobile SmartThings.
- Un accès Internet sur votre instance Gladys : cette intégration dialogue avec
  le cloud SmartThings (`api.smartthings.com`).
- Soit une **application OAuth-In SmartThings** (recommandé, voir ci-dessous),
  soit un **Personal Access Token**, qui expire au bout de 24 heures.

## Se connecter en OAuth2 (recommandé)

Les Personal Access Tokens SmartThings créés depuis fin 2024 expirent au bout de
24 heures. Avec OAuth2, l'intégration renouvelle son accès toute seule : vous
vous connectez une fois et ne recollez plus jamais de token.

### 1. Créer une application OAuth-In SmartThings (une seule fois)

Cela se fait avec la [CLI SmartThings](https://developer.smartthings.com/docs/sdks/cli/)
(`npm install -g @smartthings/cli`, ou Homebrew sur macOS) :

```sh
smartthings apps:create
```

Répondez aux questions :

- **Type d'application** → `OAuth-In App` ;
- **Nom affiché** → par exemple `Gladys` ;
- **Autorisations (scopes)** → sélectionnez `r:devices:*`, `x:devices:*` et
  `r:locations:*` ;
- **Redirect URIs** → `https://my.gladysassistant.com/redirect/oauth`.

La CLI affiche un **OAuth Client Id** et un **OAuth Client Secret**. Le secret
n'est affiché **qu'une seule fois** : copiez les deux.

La redirect URI est le relais de Gladys : SmartThings vous y renvoie, et il vous
redirige vers votre propre instance Gladys, quelle que soit son adresse (pas
besoin d'adresse HTTPS publique de votre côté).

Si vous accédez à Gladys en HTTPS (Gladys Plus ou votre propre domaine), l'écran
de Configuration propose sous le bouton Connecter **« Utiliser plutôt l'adresse
de mon instance »**. Si la case est cochée, Gladys envoie l'adresse qu'il affiche
à cet endroit (par exemple
`https://plus.gladysassistant.com/dashboard/integration/device/external/<intégration>/oauth-callback`)
au lieu du relais : déclarez aussi cette adresse exacte dans l'application,
sinon SmartThings répond `'redirect_uri' could not be validated`. Une
application peut déclarer plusieurs redirect URIs.

### 2. Se connecter depuis Gladys

1. Ouvrez l'écran de **Configuration** de l'intégration.
2. Collez le **Client id** et le **Client secret**, puis **enregistrez**.
3. Cliquez sur **Connecter** : la page d'autorisation SmartThings s'ouvre.
   Connectez-vous, choisissez le lieu à partager et validez.
4. Vous revenez dans Gladys : l'intégration enregistre les tokens (jamais
   affichés dans l'interface) et charge vos appareils.

Le token d'accès vit 24 heures ; l'intégration le renouvelle quelques heures
avant son expiration, et vérifie toutes les heures même quand aucun appareil
n'est interrogé. SmartThings annule une autorisation inutilisée pendant 29
jours : tant que l'intégration tourne, cela n'arrive pas.

## Alternative : un Personal Access Token

1. Ouvrez **https://account.smartthings.com/tokens** et connectez-vous avec
   votre compte Samsung / SmartThings.
2. Cliquez sur **Generate new token**.
3. Donnez-lui un nom (par exemple `Gladys`).
4. Sélectionnez au minimum ces autorisations :
   - **Devices** → _List all devices_, _See all devices_, _Control all devices_ ;
   - **Locations** → _See all locations_.
5. Cliquez sur **Generate token**. Le token n'est affiché **qu'une seule
   fois** — copiez-le.

> ⚠️ Depuis fin 2024, les nouveaux Personal Access Tokens SmartThings
> **expirent au bout de 24 heures** : l'intégration s'arrête alors jusqu'à ce
> que vous en colliez un nouveau. Pour un usage permanent, utilisez OAuth2
> (ci-dessus). Dès qu'un compte est connecté en OAuth2, le champ du token est
> ignoré.

## Configuration

1. Installez l'intégration depuis le store Gladys.
2. Ouvrez son écran de **Configuration** et connectez votre compte en OAuth2
   (voir ci-dessus), ou collez un **Personal Access Token** (stocké comme
   secret, jamais réaffiché) et enregistrez.
3. L'intégration se connecte à SmartThings et charge vos appareils.
4. Ouvrez l'écran **Découverte** : vos appareils y sont listés. Ajoutez ceux que
   vous voulez, puis placez-les dans vos pièces et tableaux de bord comme
   n'importe quel appareil Gladys.

Pour utiliser un autre compte SmartThings plus tard, cliquez à nouveau sur
**Connecter** (OAuth2) ou mettez à jour le token : l'intégration se reconnecte
et rafraîchit la liste des appareils automatiquement. Changer de client id fait
oublier les tokens de l'application précédente : cliquez à nouveau sur
**Connecter**.

## Dépannage

- **« SmartThings is not configured » pendant la découverte** — aucun compte
  n'est connecté et aucun token n'est renseigné : connectez-vous en OAuth2, ou
  collez un token, dans l'écran de Configuration.
- **« Fill in and save the client id and client secret » en cliquant sur
  Connecter** — enregistrez d'abord les deux champs, puis cliquez sur
  **Connecter**.
- **`'redirect_uri' could not be validated` sur la page SmartThings** —
  l'application ne déclare pas la redirect URI envoyée par Gladys : le relais
  `https://my.gladysassistant.com/redirect/oauth`, ou, si « Utiliser plutôt
  l'adresse de mon instance » est cochée, l'adresse affichée sous le bouton
  Connecter. Vérifiez l'application avec `smartthings apps:oauth <id de l'app>`
  et ajoutez l'adresse manquante avec `smartthings apps:oauth:update <id de l'app>`.
- **Le statut de connexion demande de cliquer à nouveau sur « Connecter »** —
  SmartThings n'accepte plus l'autorisation (révoquée dans l'application
  SmartThings, ou inutilisée pendant 29 jours) : cliquez sur **Connecter**.
- **Le statut de connexion indique que le token a été rejeté** — le Personal
  Access Token est invalide ou expiré (expiration au bout de 24 heures) : passez
  à OAuth2, ou générez un nouveau token.
- **Un appareil n'apparaît pas dans la Découverte** — vérifiez qu'il est visible
  dans l'application SmartThings avec le même compte, qu'il est en ligne et
  qu'il expose au moins une capability prise en charge, puis relancez la
  découverte.
- **Un appareil affiche moins de fonctionnalités que prévu** — seules les
  capabilities prises en charge du composant _main_ sont associées ; les
  capabilities des autres composants ne sont pas exposées.
- **Les commandes semblent ignorées** — SmartThings peut mettre quelques
  secondes à transmettre une commande à l'appareil ; l'état dans Gladys reflète
  l'état du cloud et se met à jour au rafraîchissement suivant (10 secondes).
