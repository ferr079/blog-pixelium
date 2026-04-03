---
title: "Un câble, deux nœuds, 2.36 Gbps : la meilleure upgrade à 3 euros"
date: 2026-03-20
tags: ["reseau", "proxmox", "hardware", "homelab"]
summary: "Comment un câble Ethernet entre deux mini-PC a transformé les performances du cluster Proxmox. Pas de switch, pas de VLAN — juste un câble point-à-point."
---

## Le constat

Mon homelab tourne sur deux nœuds Proxmox principaux :
- **pve1** — un NUC 0droid avec un Intel Celeron N5105, le nœud infra
- **pve2** — un GMKtek avec un AMD Ryzen 7 7840HS, le nœud applicatif

Les deux sont connectés à la Freebox Delta en **Gigabit**. Pour le trafic quotidien — accès aux services, DNS, web — c'est largement suffisant.

Mais quand on fait une **migration live** d'un conteneur de pve1 vers pve2, c'est une autre histoire. La migration copie la mémoire du CT en temps réel, et un CT de 2 Go prend 20+ secondes sur un lien Gigabit. Pendant ce temps, le service est dégradé.

Les backups vers PBS, la réplication ZFS, le transfert de zones DNS entre les deux TechnitiumDNS — tout ça passe par le même lien Gigabit que le trafic utilisateur.

## La découverte

En explorant les specs des machines, Claude a relevé que les deux avaient un **deuxième port Ethernet 2.5G** (puce RTL8125B) qui ne servait à rien. Sur pve1, `nic1` était DOWN. Sur pve2, pareil.

Deux ports 2.5G inutilisés. Deux machines posées sur le même meuble. L'idée s'est imposée d'elle-même.

> Parfois la meilleure solution d'infrastructure, c'est un câble à 3 euros.

## La mise en place

### Le réseau dédié

On a créé un réseau point-à-point complètement séparé du LAN :

| Nœud | Interface | Bridge | IP |
|---|---|---|---|
| pve1 | nic1 (RTL8125B) | vmbr1 | `10.10.10.1/30` |
| pve2 | nic1 (RTL8125B) | vmbr1 | `10.10.10.2/30` |

Le masque `/30` est délibéré : ce réseau ne contient que 2 hôtes. Pas besoin de plus, pas envie de laisser de la place pour du bruit.

### Configuration Proxmox

Dans l'interface Proxmox, on a créé un bridge `vmbr1` sur chaque nœud, lié au deuxième NIC. Puis dans `/etc/network/interfaces` :

```
auto vmbr1
iface vmbr1 inet static
    address 10.10.10.1/30
    bridge-ports nic1
    bridge-stp off
    bridge-fd 0
```

Un `ifreload -a` et c'est actif. Pas de reboot nécessaire.

### Le benchmark

```bash
# Sur pve1 (serveur)
iperf3 -s -B 10.10.10.1

# Sur pve2 (client)
iperf3 -c 10.10.10.1 -t 30 -P 4
```

**Résultat :**

| Métrique | Lien Gigabit (LAN) | Lien 2.5G (direct) |
|---|---|---|
| Débit | 940 Mbps | **2.36 Gbps** |
| Latence | 0.4 ms | **0.17 ms** |

2.5x le débit, moitié de la latence. Logique — il n'y a **aucun équipement intermédiaire** entre les deux machines. Pas de switch, pas de routeur, même pas un câble patch panel. Juste un câble Cat6 d'un mètre.

### Jumbo frames

Bonus inattendu : sur un lien privé sans équipement tiers, on peut monter le **MTU à 9000** (jumbo frames) sans affecter le reste du réseau.

```bash
# Sur les deux nœuds
ip link set vmbr1 mtu 9000
```

Gain supplémentaire de ~5% sur les gros transferts. Sur le LAN principal, les jumbo frames causeraient des problèmes (la Freebox ne les supporte pas), mais sur un lien point-à-point, c'est sans risque.

### Configurer Proxmox pour l'utiliser

Le lien existe, mais Proxmox doit savoir l'utiliser pour les migrations. Dans la configuration du cluster, on a déclaré le réseau `10.10.10.0/30` comme **lien de migration** :

Maintenant, quand on migre un CT entre pve1 et pve2, Proxmox choisit automatiquement le lien 2.5G.

## Les effets de bord positifs

### Segmentation gratuite

Le trafic de réplication (migrations, backups, sync ZFS) est maintenant **physiquement séparé** du trafic utilisateur. Ce n'est pas juste une question de performance — c'est de la segmentation réseau.

Si le LAN est saturé (transfert de fichiers vers le NAS, streaming Jellyfin), les migrations ne sont pas impactées. Et inversement.

### Résilience

Si le switch ou la Freebox plante, les deux nœuds principaux continuent de communiquer via le lien direct. Le cluster Proxmox reste cohérent.

### Pas de single point of failure réseau

Le cluster a maintenant **deux chemins de communication** entre ses nœuds principaux. C'est accidentellement de la redondance.

## Ce que j'en retiens

### 1. La simplicité gagne

Pas de VLAN, pas de switch managé, pas de configuration complexe. Un câble, deux IPs, un bridge. Le rapport coût/bénéfice est imbattable.

### 2. Explorer son hardware

Ces ports 2.5G existaient depuis le jour où j'ai acheté les machines. Ils ont attendu des mois que quelqu'un s'en rende compte. La leçon : lire les specs de son matériel **en entier**, pas juste les lignes qui intéressent au moment de l'achat.

### 3. Le point-à-point est sous-estimé

Dans un homelab, on pense toujours "switch" quand on pense réseau. Mais pour deux machines qui ont besoin de communiquer vite et souvent, un câble direct est la solution optimale — zéro latence ajoutée, zéro équipement supplémentaire, zéro configuration réseau complexe.

---

*Matériel : câble Cat6 1m (~3€), ports RTL8125B intégrés. Aucun achat supplémentaire.*
