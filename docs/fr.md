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
- Un **Personal Access Token** (voir ci-dessous).

## Obtenir un Personal Access Token

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
> **expirent au bout de 24 heures**. C'est suffisant pour tester ; pour un usage
> permanent, il faudra régénérer le token ou passer à une configuration basée
> sur OAuth2 dans une future version de l'intégration.

## Configuration

1. Installez l'intégration depuis le store Gladys.
2. Ouvrez son écran de **Configuration** et collez votre **Personal Access
   Token** (stocké comme secret, jamais réaffiché).
3. Enregistrez. L'intégration se connecte à SmartThings et charge vos appareils.
4. Ouvrez l'écran **Découverte** : vos appareils y sont listés. Ajoutez ceux que
   vous voulez, puis placez-les dans vos pièces et tableaux de bord comme
   n'importe quel appareil Gladys.

Pour utiliser un autre compte SmartThings ou un nouveau token plus tard, mettez
simplement à jour le token dans l'écran de Configuration : l'intégration se
reconnecte et rafraîchit la liste des appareils automatiquement.

## Dépannage

- **« SmartThings is not configured » pendant la découverte** — le token
  manque : collez-le dans l'écran de Configuration et enregistrez.
- **Le statut de connexion indique que le token a été rejeté** — le token est
  invalide ou expiré (rappelez-vous de l'expiration au bout de 24 heures) :
  générez-en un nouveau et mettez à jour la configuration.
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
