# Apple WeatherKit pour Gladys

Connecteur **non officiel**, sans lien avec Apple. Il fait d'**Apple WeatherKit** le fournisseur météo de
Gladys : conditions actuelles, prévisions sur 24 heures et 8 jours, et alertes officielles du pays saisi. Le
widget météo, l'assistant et les déclencheurs de scène d'alerte météo de Gladys s'en servent directement.

> Ce module n'a **jamais été testé avec un vrai compte** Apple Developer : il est écrit d'après la
> documentation de l'API REST WeatherKit. Vos retours sont les bienvenus.

## Ce qu'il faut

- Un abonnement **Apple Developer Program** à votre nom (payant : 99 USD par an). Il inclut **500 000 appels
  WeatherKit par mois** pour toute l'équipe ; au-delà, Apple propose des forfaits payants dans votre compte
  développeur.
- Gladys 5.1 ou plus récent, et au moins une maison localisée (Paramètres → Maisons) pour le bouton de test.

## Obtenir les identifiants

Sur [developer.apple.com/account](https://developer.apple.com/account) :

1. **Team ID** : _Membership details_, 10 caractères.
2. **Service ID** : _Certificates, Identifiers & Profiles_ → _Identifiers_ → **+** → _Services IDs_, par exemple
   `com.exemple.meteo`.
3. **Clé** : _Keys_ → **+** → cochez **WeatherKit** → enregistrez, puis téléchargez le fichier
   `AuthKey_XXXXXXXXXX.p8` (Apple ne le donne qu'une fois). Les 10 caractères après `AuthKey_` sont le **Key ID**.

Voir aussi [WeatherKit : premiers pas](https://developer.apple.com/weatherkit/get-started/).

## Configuration

| Champ                       | Rôle                                                                                                                                                                                                                                                                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Team ID, Key ID, Service ID | Les identifiants ci-dessus.                                                                                                                                                                                                                                                                                                                 |
| Clé privée (.p8)            | Tout le contenu du fichier `.p8`, lignes `-----BEGIN/END PRIVATE KEY-----` comprises (collée sur une ligne, elle est aussi acceptée). Gardée par Gladys dans sa base, jamais réaffichée, utilisée seulement pour signer les requêtes envoyées à Apple WeatherKit. Elle n'apparaît ni dans les journaux, ni dans le statut, ni dans `/data`. |
| Pays des alertes            | Code à deux lettres (FR, BE, US…). WeatherKit ne donne les alertes qu'avec lui. Vide : pas d'alertes.                                                                                                                                                                                                                                       |
| Alertes météo               | Activées par défaut (si un pays est saisi).                                                                                                                                                                                                                                                                                                 |
| Intervalle de lecture       | 15 minutes par défaut (10 à 120). Un lieu est lu chez Apple au plus une fois par intervalle.                                                                                                                                                                                                                                                |
| Budget mensuel              | 50 000 appels par défaut (1 000 à 500 000), par mois civil UTC.                                                                                                                                                                                                                                                                             |

Le bouton **Tester WeatherKit** fait un appel (données disponibles à votre première maison localisée, ou à
Cupertino si aucune maison n'a de position) : il dit si Apple accepte les identifiants, si les alertes existent
pour votre pays, et le nombre d'appels du mois. Il fonctionne au plus une fois toutes les 30 secondes, et pas
pendant une pause demandée par Apple ni une fois le budget atteint.

## Coûts, quotas et rythme

- Gladys demande la météo quand un tableau de bord s'affiche, quand l'assistant répond, et toutes les
  30 minutes pour les alertes. Le module répond avec la copie gardée tant qu'elle a moins d'un intervalle :
  avec 15 minutes, comptez **environ 3 000 appels par mois et par lieu**.
- Chaque appel est compté dans `/data` avant de partir. Le budget atteint, plus rien n'est envoyé jusqu'au
  1er du mois suivant (UTC). Apple compte aussi les appels de vos autres applications dans le même quota.
- **HTTP 429** : pause selon l'en-tête `Retry-After` (comparé à l'en-tête `Date` d'Apple), entre 60 s et
  6 heures ; sans en-tête, 60 s puis doublée.
- **Erreur serveur, réponse illisible, trop grande (plus de 1 Mo) ou absente** : pause de 60 s, doublée à
  chaque échec jusqu'à 1 heure.
- **Autre 4xx (400, 404…)** : le lieu ou le pays n'est pas servi ; seul ce lieu est retenu pendant un intervalle
  de lecture, les autres continuent.
- Gladys attend 15 s une réponse : un appel (ou sa reprise après un 401) qui ne peut pas finir à temps ne part
  pas.
- Pendant une pause ou une panne, Gladys reçoit la dernière copie si elle a moins d'une heure, avec sa propre
  date (jamais présentée comme neuve) ; sinon une erreur, et Gladys passe à son fournisseur suivant.
- Les pauses, le compteur et les copies sont gardés dans `/data` : un redémarrage ne relance pas d'appel.

## Identifiants refusés

Un 401 ou 403 isolé n'arrête rien : la requête est refaite une fois avec un jeton neuf. Refusés **deux fois de
suite**, les identifiants sont notés comme refusés et plus aucune requête ne part avec eux. `/data` ne garde
qu'**un octet** d'une empreinte salée des identifiants et de la clé **publique** : rien de secret, et rien contre
quoi vérifier une hypothèse (une sur 256 correspond). Enregistrer d'autres identifiants pendant que le module
tourne lève le refus tout de suite. Après un redémarrage, seul cet octet est connu : de nouveaux identifiants
dont l'octet tombe pareil (1 chance sur 256) restent retenus jusqu'à un succès du bouton **Tester WeatherKit**,
qui fait toujours son appel.

## Ce qui est envoyé à Apple

Les coordonnées de la maison arrondies à 3 décimales (environ 100 m), la langue de l'utilisateur (sa base :
`pt-BR` → `pt`), le pays des alertes, et un jeton signé valable une heure. `/data/state.json` contient le
compteur du mois, la pause, un octet qui marque des identifiants refusés, et les dernières réponses. Elles ne
contiennent pas de coordonnées, mais chacune est rangée sous une empreinte salée du lieu arrondi : avec le sel à
côté, le lieu peut être retrouvé par force brute, et les alertes nomment leur zone. `/data` reste sur votre
Gladys.

## Correspondances

| WeatherKit                           | Gladys                   |
| ------------------------------------ | ------------------------ |
| Clear, MostlyClear, Hot, Frigid      | clear                    |
| PartlyCloudy / MostlyCloudy, Cloudy  | partly-cloudy / cloud    |
| Fog, Haze, Smoke                     | fog                      |
| Drizzle / Rain, Showers… / HeavyRain | drizzle / rain / pouring |
| FreezingDrizzle, FreezingRain        | freezing-rain            |
| Sleet, WintryMix, MixedRainAndSnow…  | sleet                    |
| Snow, Flurries, Blizzard…            | snow                     |
| Hail                                 | hail                     |
| Thunderstorms, StrongStorms…         | thunderstorm             |
| Breezy, Windy / Dust, BlowingDust    | wind / sandstorm         |
| TropicalStorm, Hurricane / Tornado   | hurricane / tornado      |
| autre code                           | unknown                  |

Unités : WeatherKit répond en métrique ; le module convertit en m/s, km (métrique) ou °F, mph, pouces, miles
(US) ; la pression reste en hPa ; humidité, nébulosité et probabilité de pluie en pourcentage. Une valeur absente
reste absente, jamais 0.

Alertes : la gravité CAP d'Apple est reprise ; « unknown » devient « minor » (l'alerte est gardée). Le type de
phénomène (orage, vent, neige…) est déduit du titre en anglais, français, allemand ou espagnol ; sans
correspondance, l'alerte est montrée avec son titre seul. La description donne la zone et la source ; le texte
long n'est pas demandé (un appel de plus par alerte). Les alertes expirées selon l'heure d'Apple sont retirées.

## Attribution

Apple demande d'afficher la marque Apple Météo et un lien vers les sources de ses données :
<https://weatherkit.apple.com/legal-attribution.html>. Le widget météo de Gladys ne sait pas encore l'afficher :
le lien est dans l'écran de configuration et ici.

## Statuts

- « Saisissez le Team ID… » : rien de configuré.
- « Configuration invalide : … » : nomme les champs fautifs (jamais leur valeur) ; rien n'est envoyé.
- « Prêt » puis « WeatherKit répond ».
- « Apple a refusé ces identifiants… », « WeatherKit a demandé de ralentir… », « n'a pas répondu
  correctement… », « Budget mensuel atteint… ».
- « /data/state.json est illisible » : relu toutes les 10 s, rien n'est envoyé en attendant (un fichier
  illisible n'est pas traité comme vide).
- « La configuration n'a pas pu être lue » : nouvel essai après 5 s, puis doublé jusqu'à 5 minutes.

## Limites

Pas de prévision minute par minute, pas d'image radar, pas de qualité de l'air. Licence Apache-2.0.
