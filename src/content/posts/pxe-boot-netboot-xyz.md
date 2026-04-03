---
title: "PXE boot : installer un OS par le réseau et les pièges du BIOS Dell"
date: 2026-03-23
tags: ["reseau", "hardware", "homelab", "pxe"]
summary: "Déployer netboot.xyz pour installer des OS par le réseau. Ça avait l'air simple — jusqu'aux drivers UNDI buggués des Dell OptiPlex et au firewall Proxmox qui bloquait le TFTP."
---

## Le besoin

J'ai trois Dell OptiPlex reconvertis — opti1, opti2, opti3. Des petites machines de bureau que je recycle pour divers usages. De temps en temps, il faut réinstaller un OS : passer de Windows 10 à MX Linux, tester une nouvelle distro, repartir de zéro.

La méthode classique : graver une clé USB, la brancher, booter dessus, installer. C'est pénible pour une machine. C'est insupportable pour trois.

**PXE boot** (Preboot eXecution Environment) permet de booter une machine directement depuis le réseau — pas de clé USB, pas de gravure. La machine s'allume, reçoit une image via TFTP, et démarre l'installateur.

## netboot.xyz : le menu d'installation universel

**netboot.xyz** est un projet open-source qui fournit un menu de boot réseau avec des dizaines d'OS : Ubuntu, Debian, Fedora, Arch, FreeBSD, et même des utilitaires (Clonezilla, Memtest).

On l'a déployé sur un CT Proxmox dédié (CT 188, IP `192.168.1.188`) :
- **TFTP** sur le port 69/UDP — sert le fichier de boot initial
- **HTTP** sur le port 80 — sert les menus et les images

```bash
apt install tftpd-hpa nginx
```

Le fichier de boot se place dans `/var/www/html/` et est servi par TFTP.

### Configuration de la Freebox

La Freebox Delta fait office de serveur DHCP pour le LAN. Dans les paramètres, section "Démarrage par TFTP" :
- **Serveur TFTP** : `192.168.1.188`
- **Fichier de démarrage** : `netboot.xyz-snp.efi`

Quand une machine demande un boot PXE via DHCP, la Freebox lui dit : "va chercher ce fichier sur ce serveur".

## Premier essai : échec

Boot PXE sur opti3. La machine reçoit bien l'adresse DHCP, contacte le serveur TFTP... et rien. Écran noir. Pas d'erreur, pas de message — juste le vide.

### Le piège UNDI vs SNP

Après recherche, le problème est un bug connu des **Dell OptiPlex** : leur firmware UEFI utilise un driver réseau **UNDI** (Universal Network Driver Interface) qui est buggué. L'implémentation Dell de UNDI perd la connexion réseau après le handshake initial.

La solution : utiliser le fichier **SNP** (Simple Network Protocol) au lieu du fichier EFI standard. SNP embarque **son propre driver réseau** au lieu de compter sur celui du firmware.

```
# Mauvais (ne marche pas sur Dell)
netboot.xyz.efi

# Bon (embarque son propre driver)
netboot.xyz-snp.efi
```

C'est un détail que très peu de tutos mentionnent. La plupart disent "téléchargez `netboot.xyz.efi`" et ça marche sur leur hardware. Sur un Dell OptiPlex, non.

> Le matériel recyclé a des surprises que le matériel neuf n'a pas. C'est le prix de l'économie circulaire — et c'est aussi ce qui rend le debug intéressant.

## Deuxième essai : ré-échec

Avec le fichier SNP, le menu netboot.xyz s'affiche ! Victoire... de courte durée. Le téléchargement des images d'installation échoue. Timeout TFTP.

### Le firewall Proxmox qui bloque le TFTP

TFTP utilise le port 69/UDP pour la connexion initiale, puis **bascule sur un port éphémère aléatoire** pour le transfert de données. C'est un protocole archaïque avec un design réseau terrible.

Le problème : sans `firewall=1` sur l'interface réseau du CT 188, Proxmox ne crée pas d'interface `fwln` (firewall link), et les réponses TFTP sur port éphémère sont **silencieusement bloquées**.

La solution :

```bash
# Dans la config du CT 188 sur Proxmox
net0: name=eth0,bridge=vmbr0,firewall=1,ip=192.168.1.188/24
```

Le `firewall=1` est obligatoire — mais pas pour filtrer le trafic (les règles sont permissives). C'est pour créer l'interface `fwln` qui permet au suivi de connexion (conntrack) de fonctionner correctement avec TFTP.

C'est contre-intuitif : on active le firewall non pas pour bloquer, mais pour **débloquer** un protocole. Claude a trouvé ça dans un thread Proxmox enfoui.

## Troisième essai : succès

Avec le fichier SNP et `firewall=1`, le boot PXE fonctionne parfaitement :

1. La machine s'allume
2. Le DHCP de la Freebox fournit l'IP + le serveur TFTP
3. Le firmware charge `netboot.xyz-snp.efi` via TFTP
4. Le menu netboot.xyz s'affiche
5. On choisit l'OS, le téléchargement de l'installateur commence
6. L'installation se déroule normalement

## Le gotcha du câble physique

Un dernier piège, celui-là complètement hors du logiciel : **opti3 et pve3 partagent le même câble RJ45**. Ils sont sur le même bureau, il n'y a qu'un câble Ethernet qui arrive du switch, et je branche l'un ou l'autre selon le besoin.

J'ai passé 15 minutes à débugger pourquoi opti3 n'avait pas de réseau avant de réaliser que le câble était branché dans pve3. Le genre de "bug" qu'aucun log ne peut révéler.

> Avant tout debug logiciel, vérifier le branchement physique. Toujours. Même quand on est "sûr" que c'est branché.

## Ce que j'en retiens

### 1. Le PXE est puissant mais fragile

Le concept est brillant — booter par le réseau, zéro support physique. Mais l'implémentation repose sur un empilement de protocoles archaïques (DHCP option 66/67, TFTP avec ports éphémères, UNDI/SNP) qui interagissent mal avec les équipements modernes.

### 2. Le hardware recyclé a du caractère

Les Dell OptiPlex sont des machines formidables pour un homelab (petites, silencieuses, pas chères). Mais leur firmware a des particularités qu'on ne découvre qu'en sortant des sentiers battus.

### 3. Documenter les gotchas

Le fichier SNP, le `firewall=1`, le câble partagé — ce sont des détails qui peuvent bloquer quelqu'un pendant des heures. Les documenter dans le CLAUDE.md du projet m'a déjà sauvé à deux reprises.

---

*Stack : netboot.xyz sur CT 188 (Debian), tftpd-hpa, nginx, Freebox DHCP PXE. Machines cibles : Dell OptiPlex 7040/7050.*
