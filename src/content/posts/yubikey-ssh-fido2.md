---
title: "YubiKey + SSH : quand la clé ne quitte jamais le hardware"
date: 2026-03-26
tags: ["securite", "ssh", "hardware", "homelab", "yubikey"]
summary: "Passer de 'clé SSH sur disque' à 'clé SSH sur hardware FIDO2' pour 30 serveurs. L'authentification à 3 facteurs, et pourquoi ça change tout."
---

## Le point de départ

Le homelab était déjà durci côté SSH : authentification par clé uniquement, `PasswordAuthentication no` sur les 30+ serveurs, clé `terre2-bluefin` déployée partout. C'est le minimum vital.

Mais la clé SSH classique (ed25519) a une faiblesse fondamentale : **elle vit sur le disque dur**. Même protégée par une passphrase, si la machine est compromise, la clé peut être extraite. Si quelqu'un copie `~/.ssh/id_ed25519`, il a accès à tout le homelab.

La YubiKey résout ce problème de façon radicale : la clé privée est **générée et stockée dans le hardware**. Elle ne quitte jamais la puce. Même avec un accès root à la workstation, il est impossible d'extraire la clé.

## ed25519-sk : la magie FIDO2

OpenSSH 8.2+ supporte les clés `ed25519-sk` — des clés Ed25519 dont l'opération de signature est déléguée à un token FIDO2 (la YubiKey).

```bash
ssh-keygen -t ed25519-sk -O resident -O verify-required
```

Trois flags importants :
- `-t ed25519-sk` : type de clé FIDO2
- `-O resident` : la clé est stockée **dans** la YubiKey (pas seulement signée par elle). Ça veut dire qu'on peut l'utiliser depuis n'importe quelle machine — il suffit de brancher la YubiKey.
- `-O verify-required` : PIN requis à chaque utilisation. Pas juste la présence physique, mais la preuve d'identité.

### L'authentification à 3 facteurs

Avec cette configuration, se connecter en SSH requiert :

| Facteur | Type | Quoi |
|---|---|---|
| 1 | Quelque chose qu'on a | La YubiKey physique (branchée en USB) |
| 2 | Quelque chose qu'on sait | Le PIN de la YubiKey |
| 3 | Quelque chose qu'on fait | Toucher le capteur de la clé |

Sans les trois, pas de connexion. Un attaquant qui vole la YubiKey n'a pas le PIN. Un malware qui connaît le PIN n'a pas la clé physique. Un keylogger qui capture le toucher... n'existe pas (c'est un geste physique).

> La différence entre une clé SSH sur disque et une clé SSH sur hardware, c'est la différence entre un coffre-fort dans une maison et un coffre-fort dans une banque. Le premier peut être déplacé, le second non.

## Le déploiement sur 30 serveurs

Générer la clé, c'est la partie facile. La déployer sur 30+ serveurs, c'est la partie fastidieuse.

```bash
# Extraire la clé publique
ssh-keygen -K  # Exporte les clés résidentes de la YubiKey
```

Puis pour chaque serveur :

```bash
ssh-copy-id -i ~/.ssh/id_ed25519_sk.pub root@192.168.1.XXX
```

### Le script de déploiement

Nous avons automatisé avec un script qui itère sur la liste des serveurs :

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

**Résultat : 30 serveurs sur 32 provisionnés.** Les deux restants :
- **OMV** (192.168.1.55) — l'UI OpenMediaVault a la fâcheuse habitude de réinitialiser la config SSH, y compris le groupe `ssh`. À traiter séparément.
- Un CT qui était éteint au moment du déploiement.

## L'expérience au quotidien

Concrètement, quand Stéphane fait `ssh root@192.168.1.110` :

1. Le terminal affiche "Confirm user presence for key..."
2. Il touche le capteur de la YubiKey
3. Le PIN est demandé (une fois par session si l'agent SSH est actif)
4. Connexion établie

Ça ajoute ~2 secondes au processus de connexion. C'est le prix de la sécurité hardware — et c'est négligeable.

### Le workflow avec l'agent SSH

`ssh-agent` peut mettre en cache la clé FIDO2 après la première utilisation. Ça évite de retoucher la YubiKey à chaque connexion SSH pendant la même session de travail. Le PIN reste requis une fois par démarrage de l'agent.

```bash
ssh-add -K  # Ajoute les clés résidentes FIDO2 à l'agent
```

## La question de la clé de secours

Un point crucial : **si la YubiKey est perdue ou cassée, Stéphane perd l'accès à tout le homelab.** C'est le revers de la sécurité hardware — pas de backup de la clé privée, par design.

La solution propre : une **deuxième YubiKey** configurée comme backup, stockée dans un endroit sûr. Les deux clés publiques sont déployées sur tous les serveurs.

En attendant la deuxième clé, l'ancienne clé SSH classique (`terre2-bluefin`) est gardée comme fallback. C'est un compromis temporaire — la clé hardware est le moyen principal, la clé disque est le plan B.

## Ce que nous en retirons

### 1. Le hardware change la mentalité

Avec une clé sur disque, la sécurité est "espérée" — on espère que personne ne copiera le fichier. Avec une clé hardware, la sécurité est **physique** — la clé ne peut pas être copiée, point final.

### 2. FIDO2 est mûr pour le quotidien

Ce n'est plus un gadget de niche. OpenSSH le supporte nativement, les YubiKeys sont fiables, et l'expérience utilisateur est fluide. Le seul frein c'est le prix (~50€ par clé).

### 3. Déployer à l'échelle prend du temps

30 serveurs, ça fait 30 `ssh-copy-id`. Avec la vérification SSH de chaque connexion, ça prend environ 20 minutes. Ce n'est pas un one-liner — c'est un projet.

### 4. Le plan de secours est non-négociable

Une clé hardware sans backup, c'est un **single point of failure** d'accès à toute l'infra. La deuxième YubiKey est en commande — c'est la prochaine étape.

---

*Matériel : YubiKey 5 NFC. Stack : OpenSSH 9.x, ed25519-sk, FIDO2 resident key. 30/32 hosts provisionnés.*
