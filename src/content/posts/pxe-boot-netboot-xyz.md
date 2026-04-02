---
title: "PXE boot : installer un OS par le reseau et les pieges du BIOS Dell"
date: 2026-03-23
tags: ["reseau", "hardware", "homelab", "pxe"]
summary: "Deployer netboot.xyz pour installer des OS par le reseau. Ca avait l'air simple — jusqu'aux drivers UNDI bugues des Dell OptiPlex et au firewall Proxmox qui bloquait le TFTP."
---

## Le besoin

J'ai trois Dell OptiPlex reconvertis — opti1, opti2, opti3. Des petites machines de bureau que je recycle pour divers usages. De temps en temps, je dois reinstaller un OS : passer de Windows 10 a MX Linux, tester une nouvelle distro, repartir de zero.

La methode classique : graver une cle USB, la brancher, booter dessus, installer. C'est penible pour une machine. C'est insupportable pour trois.

**PXE boot** (Preboot eXecution Environment) permet de booter une machine directement depuis le reseau — pas de cle USB, pas de gravure. La machine s'allume, recoit une image via TFTP, et demarre l'installateur.

## netboot.xyz : le menu d'installation universel

**netboot.xyz** est un projet open-source qui fournit un menu de boot reseau avec des dizaines d'OS : Ubuntu, Debian, Fedora, Arch, FreeBSD, et meme des utilitaires (Clonezilla, Memtest).

Je l'ai deploye sur un CT Proxmox dedie (CT 188, IP `192.168.1.188`) :
- **TFTP** sur le port 69/UDP — sert le fichier de boot initial
- **HTTP** sur le port 80 — sert les menus et les images

```bash
apt install tftpd-hpa nginx
```

Le fichier de boot se place dans `/var/www/html/` et est servi par TFTP.

### Configuration de la Freebox

La Freebox Delta fait office de serveur DHCP pour le LAN. Dans les parametres, section "Demarrage par TFTP" :
- **Serveur TFTP** : `192.168.1.188`
- **Fichier de demarrage** : `netboot.xyz-snp.efi`

Quand une machine demande un boot PXE via DHCP, la Freebox lui dit : "va chercher ce fichier sur ce serveur".

## Premier essai : echec

Boot PXE sur opti3. La machine recoit bien l'adresse DHCP, contacte le serveur TFTP... et rien. Ecran noir. Pas d'erreur, pas de message — juste le vide.

### Le piege UNDI vs SNP

Apres recherche, le probleme est un bug connu des **Dell OptiPlex** : leur firmware UEFI utilise un driver reseau **UNDI** (Universal Network Driver Interface) qui est bugue. L'implementation Dell de UNDI perd la connexion reseau apres le handshake initial.

La solution : utiliser le fichier **SNP** (Simple Network Protocol) au lieu du fichier EFI standard. SNP embarque **son propre driver reseau** au lieu de compter sur celui du firmware.

```
# Mauvais (ne marche pas sur Dell)
netboot.xyz.efi

# Bon (embarque son propre driver)
netboot.xyz-snp.efi
```

C'est un detail que tres peu de tutos mentionnent. La plupart disent "telechargez `netboot.xyz.efi`" et ca marche sur leur hardware. Sur un Dell OptiPlex, non.

> Le materiel recyclee a des surprises que le materiel neuf n'a pas. C'est le prix de l'economie circulaire — et c'est aussi ce qui rend le debug interessant.

## Deuxieme essai : re-echec

Avec le fichier SNP, le menu netboot.xyz s'affiche ! Victoire... de courte duree. Le telechargement des images d'installation echoue. Timeout TFTP.

### Le firewall Proxmox qui bloque le TFTP

TFTP utilise le port 69/UDP pour la connexion initiale, puis **bascule sur un port ephemere aleatoire** pour le transfert de donnees. C'est un protocole archaique avec un design reseau terrible.

Le probleme : sans `firewall=1` sur l'interface reseau du CT 188, Proxmox ne cree pas d'interface `fwln` (firewall link), et les reponses TFTP sur port ephemere sont **silencieusement bloquees**.

La solution :

```bash
# Dans la config du CT 188 sur Proxmox
net0: name=eth0,bridge=vmbr0,firewall=1,ip=192.168.1.188/24
```

Le `firewall=1` est obligatoire — mais pas pour filtrer le trafic (les regles sont permissives). C'est pour creer l'interface `fwln` qui permet au suivi de connexion (conntrack) de fonctionner correctement avec TFTP.

C'est contre-intuitif : on active le firewall non pas pour bloquer, mais pour **debloquer** un protocole.

## Troisieme essai : succes

Avec le fichier SNP et `firewall=1`, le boot PXE fonctionne parfaitement :

1. La machine s'allume
2. Le DHCP de la Freebox fournit l'IP + le serveur TFTP
3. Le firmware charge `netboot.xyz-snp.efi` via TFTP
4. Le menu netboot.xyz s'affiche
5. On choisit l'OS, le telechargement de l'installateur commence
6. L'installation se deroule normalement

## Le gotcha du cable physique

Un dernier piege, celui-la completement hors du logiciel : **opti3 et pve3 partagent le meme cable RJ45**. Ils sont sur le meme bureau, il n'y a qu'un cable Ethernet qui arrive du switch, et je branche l'un ou l'autre selon le besoin.

J'ai passe 15 minutes a debugger pourquoi opti3 n'avait pas de reseau avant de realiser que le cable etait branche dans pve3. Le genre de "bug" qu'aucun log ne peut reveler.

> Avant tout debug logiciel, verifier le branchement physique. Toujours. Meme quand on est "sur" que c'est branche.

## Ce que j'ai appris

### 1. Le PXE est puissant mais fragile

Le concept est brillant — booter par le reseau, zero support physique. Mais l'implementation repose sur un empilement de protocoles archaiques (DHCP option 66/67, TFTP avec ports ephemeres, UNDI/SNP) qui interagissent mal avec les equipements modernes.

### 2. Le hardware recycle a du caractere

Les Dell OptiPlex sont des machines formidables pour un homelab (petites, silencieuses, pas cheres). Mais leur firmware a des particularites qu'on ne decouvre qu'en sortant des sentiers battus.

### 3. Documenter les gotchas

Le fichier SNP, le `firewall=1`, le cable partage — ce sont des details qui peuvent bloquer quelqu'un pendant des heures. Les documenter dans le CLAUDE.md du projet m'a deja sauve a deux reprises.

---

*Stack : netboot.xyz sur CT 188 (Debian), tftpd-hpa, nginx, Freebox DHCP PXE. Machines cibles : Dell OptiPlex 7040/7050.*
