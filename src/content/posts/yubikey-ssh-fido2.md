---
title: "YubiKey + SSH : quand la cle ne quitte jamais le hardware"
date: 2026-03-26
tags: ["securite", "ssh", "hardware", "homelab", "yubikey"]
summary: "Passer de 'cle SSH sur disque' a 'cle SSH sur hardware FIDO2' pour 30 serveurs. L'authentification a 3 facteurs, et pourquoi ca change tout."
---

## Le point de depart

Mon homelab etait deja durci cote SSH : authentification par cle uniquement, `PasswordAuthentication no` sur les 30+ serveurs, cle `terre2-bluefin` deployee partout. C'est le minimum vital.

Mais la cle SSH classique (ed25519) a une faiblesse fondamentale : **elle vit sur le disque dur**. Meme protegee par une passphrase, si la machine est compromise, la cle peut etre extraite. Si quelqu'un copie `~/.ssh/id_ed25519`, il a mon acces a tout le homelab.

La YubiKey resout ce probleme de facon radicale : la cle privee est **generee et stockee dans le hardware**. Elle ne quitte jamais la puce. Meme avec un acces root a ma workstation, il est impossible d'extraire la cle.

## ed25519-sk : la magie FIDO2

OpenSSH 8.2+ supporte les cles `ed25519-sk` — des cles Ed25519 dont l'operation de signature est deleguee a un token FIDO2 (la YubiKey).

```bash
ssh-keygen -t ed25519-sk -O resident -O verify-required
```

Trois flags importants :
- `-t ed25519-sk` : type de cle FIDO2
- `-O resident` : la cle est stockee **dans** la YubiKey (pas seulement signee par elle). Ca veut dire qu'on peut l'utiliser depuis n'importe quelle machine — il suffit de brancher la YubiKey.
- `-O verify-required` : PIN requis a chaque utilisation. Pas juste la presence physique, mais la preuve d'identite.

### L'authentification a 3 facteurs

Avec cette configuration, se connecter en SSH requiert :

| Facteur | Type | Quoi |
|---|---|---|
| 1 | Quelque chose que j'ai | La YubiKey physique (branchee en USB) |
| 2 | Quelque chose que je sais | Le PIN de la YubiKey |
| 3 | Quelque chose que je fais | Toucher le capteur de la cle |

Sans les trois, pas de connexion. Un attaquant qui vole ma YubiKey n'a pas le PIN. Un malware qui connait le PIN n'a pas la cle physique. Un keylogger qui capture le toucher... n'existe pas (c'est un geste physique).

> La difference entre une cle SSH sur disque et une cle SSH sur hardware, c'est la difference entre un coffre-fort dans une maison et un coffre-fort dans une banque. Le premier peut etre deplace, le second non.

## Le deploiement sur 30 serveurs

Generer la cle, c'est la partie facile. La deployer sur 30+ serveurs, c'est la partie fastidieuse.

```bash
# Extraire la cle publique
ssh-keygen -K  # Exporte les cles residentes de la YubiKey
```

Puis pour chaque serveur :

```bash
ssh-copy-id -i ~/.ssh/id_ed25519_sk.pub root@192.168.1.XXX
```

### Le script de deploiement

J'ai automatise avec un script qui itere sur la liste des serveurs :

```bash
#!/bin/bash
HOSTS=(100 101 102 104 106 110 112 118 120 125
       160 162 166 168 170 178 180 184 186 188
       190 192 200 202 210 214 220 230 234 236 238 240)

for ip in "${HOSTS[@]}"; do
  echo "Deploying to 192.168.1.${ip}..."
  ssh-copy-id -i ~/.ssh/id_ed25519_sk.pub root@192.168.1.${ip} 2>/dev/null
done
```

**Resultat : 30 serveurs sur 32 provisionnes.** Les deux restants :
- **OMV** (192.168.1.55) — l'UI OpenMediaVault a la facheuse habitude de reinitialiser la config SSH, y compris le groupe `ssh`. A traiter separement.
- Un CT qui etait eteint au moment du deploiement.

## L'experience au quotidien

Concretement, quand je fais `ssh root@192.168.1.110` :

1. Le terminal affiche "Confirm user presence for key..."
2. Je touche le capteur de la YubiKey
3. Le PIN est demande (une fois par session si l'agent SSH est actif)
4. Connexion etablie

Ca ajoute ~2 secondes au processus de connexion. C'est le prix de la securite hardware — et c'est negligeable.

### Le workflow avec l'agent SSH

`ssh-agent` peut mettre en cache la cle FIDO2 apres la premiere utilisation. Ca evite de retoucher la YubiKey a chaque connexion SSH pendant la meme session de travail. Le PIN reste requis une fois par demarrage de l'agent.

```bash
ssh-add -K  # Ajoute les cles residentes FIDO2 a l'agent
```

## La question de la cle de secours

Un point crucial : **si la YubiKey est perdue ou cassee, je perds l'acces a tout le homelab.** C'est le revers de la securite hardware — pas de backup de la cle privee, par design.

La solution propre : une **deuxieme YubiKey** configuree comme backup, stockee dans un endroit sur. Les deux cles publiques sont deployees sur tous les serveurs.

En attendant la deuxieme cle, j'ai garde l'ancienne cle SSH classique (`terre2-bluefin`) comme fallback. C'est un compromis temporaire — la cle hardware est le moyen principal, la cle disque est le plan B.

## Ce que j'ai appris

### 1. Le hardware change la mentalite

Avec une cle sur disque, la securite est "esperee" — on espere que personne ne copiera le fichier. Avec une cle hardware, la securite est **physique** — la cle ne peut pas etre copiee, point final.

### 2. FIDO2 est mur pour le quotidien

Ce n'est plus un gadget de niche. OpenSSH le supporte nativement, les YubiKeys sont fiables, et l'experience utilisateur est fluide. Le seul frein c'est le prix (~50€ par cle).

### 3. Deployer a l'echelle prend du temps

30 serveurs, ca fait 30 `ssh-copy-id`. Avec la verification SSH de chaque connexion, ca prend environ 20 minutes. Ce n'est pas un one-liner — c'est un projet.

### 4. Le plan de secours est non-negociable

Une cle hardware sans backup, c'est un **single point of failure** d'acces a toute l'infra. La deuxieme YubiKey est en commande — c'est la prochaine etape.

---

*Materiel : YubiKey 5 NFC. Stack : OpenSSH 9.x, ed25519-sk, FIDO2 resident key. 30/32 hosts provisionnes.*
