---
title: "Un cable, deux noeuds, 2.36 Gbps : la meilleure upgrade a 3 euros"
date: 2026-03-20
tags: ["reseau", "proxmox", "hardware", "homelab"]
summary: "Comment un cable Ethernet entre deux mini-PC a transforme les performances de mon cluster Proxmox. Pas de switch, pas de VLAN — juste un cable point-a-point."
---

## Le constat

Mon homelab tourne sur deux noeuds Proxmox principaux :
- **pve1** — un NUC 0droid avec un Intel Celeron N5105, le noeud infra
- **pve2** — un GMKtek avec un AMD Ryzen 7 7840HS, le noeud applicatif

Les deux sont connectes a la Freebox Delta en **Gigabit**. Pour le trafic quotidien — acces aux services, DNS, web — c'est largement suffisant.

Mais quand je fais une **migration live** d'un conteneur de pve1 vers pve2, c'est une autre histoire. La migration copie la memoire du CT en temps reel, et un CT de 2 Go prend 20+ secondes sur un lien Gigabit. Pendant ce temps, le service est degrade.

Les backups vers PBS, la replication ZFS, le transfert de zones DNS entre les deux TechnitiumDNS — tout ca passe par le meme lien Gigabit que le trafic utilisateur.

## La decouverte

En explorant les specs de mes machines, j'ai realise que les deux avaient un **deuxieme port Ethernet 2.5G** (puce RTL8125B) qui ne servait a rien. Sur pve1, `nic1` etait DOWN. Sur pve2, pareil.

Deux ports 2.5G inutilises. Deux machines posees sur le meme meuble. L'idee s'est imposee d'elle-meme.

> Parfois la meilleure solution d'infrastructure, c'est un cable a 3 euros.

## La mise en place

### Le reseau dedie

J'ai cree un reseau point-a-point completement separe du LAN :

| Noeud | Interface | Bridge | IP |
|---|---|---|---|
| pve1 | nic1 (RTL8125B) | vmbr1 | `10.10.10.1/30` |
| pve2 | nic1 (RTL8125B) | vmbr1 | `10.10.10.2/30` |

Le masque `/30` est delibere : ce reseau ne contient que 2 hotes. Pas besoin de plus, pas envie de laisser de la place pour du bruit.

### Configuration Proxmox

Dans l'interface Proxmox, j'ai cree un bridge `vmbr1` sur chaque noeud, lie au deuxieme NIC. Puis dans `/etc/network/interfaces` :

```
auto vmbr1
iface vmbr1 inet static
    address 10.10.10.1/30
    bridge-ports nic1
    bridge-stp off
    bridge-fd 0
```

Un `ifreload -a` et c'est actif. Pas de reboot necessaire.

### Le benchmark

```bash
# Sur pve1 (serveur)
iperf3 -s -B 10.10.10.1

# Sur pve2 (client)
iperf3 -c 10.10.10.1 -t 30 -P 4
```

**Resultat :**

| Metrique | Lien Gigabit (LAN) | Lien 2.5G (direct) |
|---|---|---|
| Debit | 940 Mbps | **2.36 Gbps** |
| Latence | 0.4 ms | **0.17 ms** |

2.5x le debit, moitie de la latence. Logique — il n'y a **aucun equipement intermediaire** entre les deux machines. Pas de switch, pas de routeur, meme pas un cable patch panel. Juste un cable Cat6 d'un metre.

### Jumbo frames

Bonus inattendu : sur un lien prive sans equipement tiers, on peut monter le **MTU a 9000** (jumbo frames) sans affecter le reste du reseau.

```bash
# Sur les deux noeuds
ip link set vmbr1 mtu 9000
```

Gain supplementaire de ~5% sur les gros transferts. Sur le LAN principal, les jumbo frames causeraient des problemes (la Freebox ne les supporte pas), mais sur un lien point-a-point, c'est sans risque.

### Configurer Proxmox pour l'utiliser

Le lien existe, mais Proxmox doit savoir l'utiliser pour les migrations. Dans la configuration du cluster, j'ai declare le reseau `10.10.10.0/30` comme **lien de migration** :

Maintenant, quand je migre un CT entre pve1 et pve2, Proxmox choisit automatiquement le lien 2.5G.

## Les effets de bord positifs

### Segmentation gratuite

Le trafic de replication (migrations, backups, sync ZFS) est maintenant **physiquement separe** du trafic utilisateur. Ce n'est pas juste une question de performance — c'est de la segmentation reseau.

Si le LAN est sature (transfert de fichiers vers le NAS, streaming Jellyfin), les migrations ne sont pas impactees. Et inversement.

### Resilience

Si le switch ou la Freebox plante, les deux noeuds principaux continuent de communiquer via le lien direct. Le cluster Proxmox reste coherent.

### Pas de single point of failure reseau

Le cluster a maintenant **deux chemins de communication** entre ses noeuds principaux. C'est accidentellement de la redondance.

## Ce que j'ai appris

### 1. La simplicite gagne

Pas de VLAN, pas de switch manage, pas de configuration complexe. Un cable, deux IPs, un bridge. Le rapport cout/benefice est imbattable.

### 2. Explorer son hardware

Ces ports 2.5G existaient depuis le jour ou j'ai achete les machines. Ils ont attendu des mois que je m'en rende compte. La lecon : lire les specs de son materiel **en entier**, pas juste les lignes qui interessent au moment de l'achat.

### 3. Le point-a-point est sous-estime

Dans un homelab, on pense toujours "switch" quand on pense reseau. Mais pour deux machines qui ont besoin de communiquer vite et souvent, un cable direct est la solution optimale — zero latence ajoutee, zero equipement supplementaire, zero configuration reseau complexe.

---

*Materiel : cable Cat6 1m (~3€), ports RTL8125B integres. Aucun achat supplementaire.*
