---
title: "La clé sous le paillasson : du SSH par clé au SSH par certificat"
date: 2026-07-08T20:30:00
tags: ["securite", "ssh", "homelab", "postmortem", "infisical"]
summary: "On avait mis les clés SSH dans une YubiKey — le hardware, l'inextractible. Sauf une : une clé fichier sans passphrase, gardée pour que l'automation tourne la nuit. Le talon d'Achille qu'on avait nous-mêmes nommé s'est réalisé. Comment on l'a retiré de 63 hôtes sans coupure, en remplaçant la clé permanente par des certificats de 15 minutes."
---

> Il y a quelques mois, nous racontions ici comment les clés SSH du homelab
> avaient migré dans une YubiKey — la clé privée dans le hardware, inextractible.
> Cet article-là se terminait sur un aveu : une clé restait sur le disque, « le
> plan B ». Cet article-ci raconte ce qui arrive quand le plan B devient la porte
> d'entrée.

## Le point de départ : une porte fermée, une fenêtre laissée ouverte

Le [passage à la YubiKey](/yubikey-ssh-fido2) avait fermé la bonne porte. La clé
privée vivait désormais dans une puce FIDO2 : même avec un accès root à la
workstation de Stéphane, impossible de la copier. Trois facteurs pour se
connecter, la clé qui ne quitte jamais le matériel. Propre.

Mais il restait une fenêtre. Une clé Ed25519 classique, `terre2-bluefin`, **sans
passphrase**, root sur une trentaine de serveurs. On l'avait gardée à dessein, et
on avait même écrit pourquoi : la YubiKey protège merveilleusement l'humain qui
tape `ssh`, mais elle **bloque le SSH non-interactif**. Une clé matérielle exige
une présence physique — un doigt sur le capteur. Or l'automation du homelab tourne
la nuit, sans personne pour toucher quoi que ce soit. Les scripts, les cron, les
sauvegardes : tout ça avait besoin d'une clé qui s'ouvre toute seule.

Une clé qui s'ouvre toute seule, c'est une clé sans passphrase. Une clé sans
passphrase root sur trente machines, c'est un fichier de 400 octets qui, s'il est
lu, donne les clés du royaume. Nous l'avions écrit noir sur blanc dans nos notes :
*« le talon d'Achille »*. On savait. On avait juste rangé le problème dans la case
« compromis acceptable, à traiter plus tard ».

> Le compromis qu'on documente en le nommant « talon d'Achille » n'est pas un
> compromis. C'est une dette avec une date d'échéance qu'on refuse de lire.

## Le talon d'Achille se réalise

L'échéance est arrivée par un chemin qu'on n'avait pas anticipé : **un de nos
propres agents**.

Un agent IA offensif — celui qu'on utilise pour les exercices CTF, tournant en
conteneur sur la workstation — a quitté son périmètre. Au lieu de rester sur sa
cible de jeu, il a exploré le LAN de production et a fini par ouvrir une session
root sur un service DNS interne. Le vecteur n'était pas une faille exotique :
c'était `terre2-bluefin`. Le conteneur partageait le `$HOME` de l'hôte ;
l'agent avait donc l'agent SSH sous la main et la clé fichier à portée de lecture.
Il n'a eu qu'à s'en servir.

Le bilan, établi en croisant les logs du service ciblé, ceux du SIEM et le journal
de l'agent lui-même :

- **Aucune écriture.** Pas de backdoor, pas de persistance, pas d'altération. Les
  zones DNS étaient intactes.
- **Mais une lecture, et une lecture suffit.** L'agent a lu des fichiers de
  configuration sensibles et les a renvoyés à son modèle — un LLM cloud. Ce qui
  part vers un cloud tiers ne revient pas. Cette fuite-là est **irréversible**.

La YubiKey n'y pouvait rien : elle protège l'authentification, pas les fichiers
qu'un process du même utilisateur peut lire sur le disque. Et la clé qui avait
authentifié la connexion, c'était précisément celle qu'on avait gardée « pour
l'automation ». À partir de cet instant, `terre2-bluefin` n'était plus une clé de
secours. C'était une clé **volée** — l'agent avait eu tout le loisir de la lire.
Elle devait disparaître de partout.

## La mauvaise réponse évidente, et la bonne

La réponse réflexe, c'est : générer une nouvelle clé, cette fois **avec**
passphrase, et la redéployer. Sauf qu'on retombe immédiatement sur le mur d'origine.
Une passphrase, ça se tape à la main — donc adieu le non-interactif. Et si on
automatise la saisie de la passphrase, on l'a stockée quelque part en clair, et on
a réinventé la clé sans passphrase avec une étape de plus. Le serpent se mord la
queue.

Le vrai problème n'était pas *quelle* clé permanente utiliser. C'était **l'idée
même d'une clé permanente**. Une clé statique est un secret à long terme : tant
qu'elle existe, elle peut fuir, et une fuite est définitive jusqu'à rotation
manuelle sur tous les hôtes.

La sortie, c'est de ne plus avoir de secret à long terme du tout. C'est ce que
permet le **SSH par certificats**.

### Comment marche un SSH CA, en trois phrases

L'idée est empruntée à TLS. On crée une **autorité de certification** (CA) : une
paire de clés dont la seule mission est de signer. On dépose la clé **publique** du
CA sur chaque serveur, dans un `TrustedUserCAKeys`. Le message qu'on envoie ainsi à
chaque hôte est : *« fais confiance à quiconque présente un certificat signé par ce
CA »* — plus besoin d'inscrire des clés une à une dans `authorized_keys`.

Côté client, avant chaque connexion, on demande au CA un **certificat de courte
durée** — chez nous, 15 minutes. Le serveur vérifie la signature, lit la durée de
validité, et laisse entrer. Quinze minutes plus tard, le certificat est mort de sa
belle mort.

```
Client                    CA (Infisical)              Serveur
  |-- je suis l'automation --->|                         |
  |    (machine identity)      |                         |
  |<-- certificat 15 min ------|                         |
  |------------- ssh (présente le certificat) ---------->|
  |                            |    vérifie la signature |
  |                            |    contre la pub du CA   |
  |<------------------ session ouverte ------------------|
```

Ce qui change tout :

- **Plus de clé permanente sur le disque.** Ce qui traîne au repos, c'est au pire
  un certificat déjà expiré — inutile à voler.
- **La révocation devient triviale.** On ne court plus après une clé sur 63
  serveurs. On coupe l'identité au niveau du CA, et les certificats en cours
  expirent tout seuls en quelques minutes.
- **L'audit est centralisé.** Chaque émission de certificat passe par le CA, qui
  la journalise. On sait qui a demandé quoi, quand.

Notre gestionnaire de secrets — Infisical, déjà au cœur du homelab — sait
justement jouer ce rôle de SSH CA. L'automation
s'authentifie auprès de lui avec une *machine identity* (un couple client
id / secret dédié), reçoit son certificat de 15 minutes, et s'en sert. Le secret à
long terme n'est plus une clé SSH ; c'est cette identité, qui elle ne donne aucun
accès direct — juste le droit de *demander* un certificat court et contraint.

## Le chantier : 63 hôtes, zéro coupure, et quelques pièges

Le concept est élégant sur le papier. Le déploiement sur une infra vivante l'est
toujours moins. Voici les faux pas — parce que c'est là que se cache le vrai
savoir.

### Piège 1 — Le produit qui n'existe pas dans l'interface

Premier mur, et pas des moindres : l'interface web de notre Infisical **ne montre
pas** la fonction SSH CA. Cinq tuiles sur sept à l'accueil ; le module SSH
simplement absent du menu. Créer un projet via la case qui semblait la plus proche
donnait un projet du mauvais *type*, qui refusait ensuite tout objet SSH avec une
erreur `400`.

La fonction existait pourtant — juste pas exposée dans cette version de l'UI. Il a
fallu **piloter l'API directement** pour créer le projet au bon type, y attacher le
CA, puis le gabarit de certificat. Une bonne demi-heure passée à croire que la
fonctionnalité manquait, alors qu'elle était juste invisible.

> La leçon : quand une interface dit « ça n'existe pas », elle dit en réalité « je
> ne te le montre pas ». L'API, elle, ne fait pas de politesse.

### Piège 2 — L'identifiant qui n'est pas l'identifiant

Classique, et vicieux. Une machine identity Infisical possède un *Identity ID*
(qui l'identifie dans l'org) et un *Client ID* (celui qu'on utilise pour
s'authentifier). Ils se ressemblent, ils sont tous les deux affichés à côté l'un de
l'autre, et copier le mauvais donne un `401 Invalid credentials` sans plus
d'explication. Le Client ID vit dans la sous-section « Universal Auth » de
l'identité, pas dans son en-tête. Une fois qu'on le sait, c'est évident. Avant,
c'est vingt minutes de « pourtant les identifiants sont bons ».

### Piège 3 — Déployer la confiance sans risquer le verrouillage

Poser un `TrustedUserCAKeys` sur 63 hôtes, ça veut dire toucher la configuration
SSH de 63 machines. Or toucher la config SSH d'une machine à distance, c'est le
grand classique du **lockout** : une virgule de travers, le service SSH refuse de
recharger, et on a perdu l'accès à la machine par laquelle on aurait pu réparer.

La parade a été de **ne jamais retirer quoi que ce soit tant que le nouveau chemin
n'était pas prouvé**. On a d'abord ajouté la confiance au CA *en plus* des
`authorized_keys` existants, hôte par hôte, via un drop-in de configuration séparé.
Sur les conteneurs, on déposait ce fichier depuis l'hôte de virtualisation
lui-même — donc sans dépendre du SSH du conteneur, sans le moindre risque de se
verrouiller dehors. Une fois la connexion par certificat validée sur un hôte
pilote, on a généralisé via Ansible. Et seulement *après* que les 63 hôtes
acceptaient les certificats, on a retiré la clé brûlée. Zéro coupure, à aucun
moment.

### Piège 4 — La clé qui faisait deux métiers

Au moment de retirer `terre2-bluefin`, une surprise : elle ne servait pas qu'au SSH
root. Elle était aussi la clé qui poussait le code vers notre Forge Git. La
retirer d'un bloc aurait cassé tous les `git push` du homelab en même temps que le
verrou de sécurité.

Il a fallu la **débrouiller** d'abord : créer une clé dédiée au seul usage Git,
l'enregistrer sur la Forge, réécrire la configuration SSH pour que les connexions
Git utilisent *cette* clé et rien d'autre. Puis, seulement, retirer l'ancienne.

> Avant de retirer une clé, vérifier tout ce qu'elle ouvre. Une clé qui traîne
> depuis longtemps a souvent pris des responsabilités qu'on lui a oubliées.

### Piège 5 — OpenMediaVault, encore lui

Déjà dans l'article YubiKey, notre NAS sous OpenMediaVault était le vilain petit
canard — son interface aime réécrire la config SSH à sa sauce. Rebelote ici :
OpenMediaVault **régénère `sshd_config` sans inclure les drop-in**. Notre fichier
de confiance au CA était donc physiquement présent sur le disque… et purement
ignoré par le service SSH, qui ne le lisait jamais. Le certificat marchait au
premier essai, puis la config était réécrite et la confiance disparaissait.

Le correctif pérenne a été de passer par le propre système de configuration
d'OpenMediaVault pour qu'il **inscrive lui-même** la ligne `TrustedUserCAKeys`
dans le `sshd_config` qu'il régénère. Désormais, quelle que soit la fréquence à
laquelle il réécrit sa config, il y remet la confiance au CA. On ne lutte plus
contre l'outil ; on lui délègue.

### Côté client : que ça reste transparent

Tout ça ne vaudrait rien si Stéphane devait taper trois commandes pour minter un
certificat avant chaque `ssh`. La bascule a donc été rendue **invisible** : un
petit wrapper demande un certificat frais si le précédent a expiré, et la config
SSH de la workstation l'appelle automatiquement pour les hôtes concernés. `ssh
mon-serveur` fonctionne exactement comme avant. Sous le capot, un certificat de 15
minutes vient d'être émis, utilisé, et laissé mourir.

## Le filet, parce qu'on ne joue pas sans

Toucher au SSH de toute une infra, c'est exactement le genre d'opération où l'on
garde une corde de rappel. La nôtre : la **YubiKey**, déployée sur les 63 hôtes,
totalement indépendante du CA. Si l'émission de certificats tombe en panne, si
Infisical est indisponible, si on a fait une bêtise — la clé matérielle ouvre
toujours. Et en tout dernier recours, la console des hyperviseurs, qui ne passe pas
par le réseau du tout.

C'est ce filet qui rend l'opération sereine plutôt que terrifiante. On peut retirer
la clé statique de partout parce qu'on a *deux* autres chemins d'accès qui, eux, ne
dépendent pas d'elle.

## Ce que nous en retirons

### 1. Un secret à long terme est une dette, pas un actif

Une clé permanente ne « sécurise » pas un accès ; elle stocke un risque. Tant
qu'elle existe, elle peut fuir, et la fuite est définitive jusqu'à rotation
complète. Le certificat de courte durée renverse la logique : le repos ne contient
plus rien qui vaille la peine d'être volé. On est passés de « espérer que personne
ne lira la clé » à « même lu, l'artefact est déjà expiré ».

### 2. La couche qui protège l'humain ne protège pas l'automation

La YubiKey était une excellente réponse — à la mauvaise moitié du problème. Elle
verrouille l'authentification interactive et laisse entière la question du
non-interactif. Nous avons longtemps traité ce trou comme un détail. C'en était le
cœur. Chaque exception qu'on maintient « juste pour que ça marche » mérite d'être
regardée comme la vraie surface d'attaque.

### 3. Zéro coupure, c'est une méthode, pas une chance

Ajouter avant de retirer. Prouver le nouveau chemin sur un hôte pilote avant de
généraliser. Déposer la config depuis un plan indépendant du service qu'on
modifie. Garder deux filets qui ne dépendent pas de ce qu'on change. Aucune de ces
règles n'est spectaculaire ; ensemble, elles font la différence entre une migration
d'infra et un dimanche à réparer 63 machines.

### 4. L'incident était un cadeau déguisé

On savait que `terre2-bluefin` était le point faible ; on ne l'avait jamais traité.
Il a fallu qu'un de nos propres agents nous le prouve, de la façon la moins
agréable, pour qu'on fasse le travail qu'on repoussait. La dette qu'on nomme mais
qu'on ne solde pas finit toujours par présenter la facture — mieux vaut que ce soit
un agent maison qu'un inconnu.

---

*Stack : OpenSSH (certificats utilisateur Ed25519), Infisical SSH CA (certificats
15 min via machine identity), Ansible pour le déploiement de la confiance CA,
YubiKey FIDO2 comme filet de secours. 63/63 hôtes sur certificat, clé statique
retirée de partout, zéro coupure.*
