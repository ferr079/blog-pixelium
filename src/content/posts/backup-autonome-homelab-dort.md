---
title: "Mon homelab fait ses backups pendant que je dors"
date: 2026-04-02
tags: ["automatisation", "proxmox", "backup", "homelab"]
summary: "Comment on a automatisé une chaîne de 9 étapes — du Wake-on-LAN d'un serveur éteint jusqu'à son extinction après backup de 33 conteneurs. Le tout pendant que je dors."
---

## Le problème

J'ai 33 conteneurs LXC répartis sur deux nœuds Proxmox. Des services critiques — DNS, reverse proxy, Forgejo, Vaultwarden — et des services de confort — Jellyfin, Kavita, FreshRSS. Tous ont besoin d'être sauvegardés.

Le hic : mon serveur de backup (pve3, un vieux i7-2600K) **n'est pas allumé 24/7**. C'est une machine de bureau reconvertie — bruyante, gourmande en watts, dans la même pièce que moi. La laisser tourner en permanence juste pour recevoir des backups une fois par semaine, c'est du gaspillage.

Pendant des semaines, ma routine de backup c'était :
1. Me lever
2. Allumer pve3 manuellement
3. Lancer les backups depuis l'interface Proxmox
4. Attendre. Longtemps.
5. Éteindre pve3
6. Oublier la moitié du temps

> Un backup qu'on oublie de faire, c'est un backup qui n'existe pas. Et un backup qui n'existe pas, c'est un désastre qui attend son heure.

## L'idée

Et si le homelab faisait tout ça **tout seul** ? Réveiller pve3, lancer les sauvegardes, nettoyer les anciennes, éteindre la machine. Le tout pendant que je dors, sans intervention humaine.

Avec Claude, on a découpé le plan en 9 étapes :

| Étape | Action | Pourquoi |
|---|---|---|
| 1 | Wake-on-LAN pve3 | Allumer la machine à distance |
| 2 | Attendre le boot | Pas de backup sans serveur |
| 3 | Activer le stockage PBS | pve1/pve2 doivent voir le datastore |
| 4 | Backup pve1 (parallèle) | Sauvegarder les CTs du nœud 1 |
| 5 | Backup pve2 (parallèle) | Sauvegarder les CTs du nœud 2 |
| 6 | Attendre la fin des deux | Synchronisation |
| 7 | Pruning | Garder seulement les N derniers snapshots |
| 8 | Garbage collection | Libérer l'espace disque |
| 9 | Shutdown pve3 | Éteindre proprement |

Ça a l'air simple sur le papier. Ça ne l'était pas.

## Wake-on-LAN : réveiller un PC endormi

La première brique, c'est WOL — **Wake-on-LAN**. Le principe : on envoie un "magic packet" sur le réseau, la carte réseau du PC éteint le détecte et démarre la machine.

```bash
# Envoyer le magic packet à pve3 depuis pve1
wakeonlan AA:BB:CC:DD:EE:FF
```

### Ce qui a failli tout faire capoter

WOL ne marche que si :
- Le BIOS est configuré pour l'accepter (souvent désactivé par défaut)
- La carte réseau est sur le bon bus PCIe (les ports USB-Ethernet ne supportent pas WOL)
- La machine est éteinte "proprement" (shutdown, pas power off brutal)

Sur pve3, le WOL était désactivé dans le BIOS. Un réglage enfoui dans les menus "Power Management" que je n'avais jamais touché. 20 minutes à chercher pourquoi le magic packet ne faisait rien avant de penser à vérifier le BIOS.

> Règle d'or du debug homelab : quand le logiciel ne marche pas, vérifier le hardware. Quand le hardware ne marche pas, vérifier le BIOS.

## Attendre que pve3 soit prêt

WOL envoyé, pve3 démarre. Mais entre le moment où la machine s'allume et le moment où Proxmox Backup Server est opérationnel, il se passe **60 à 90 secondes**. Le script doit attendre.

```bash
# Boucle d'attente avec timeout
wait_for_host() {
  local host=$1 timeout=120 elapsed=0
  while ! ssh -o ConnectTimeout=3 root@$host true 2>/dev/null; do
    sleep 5
    elapsed=$((elapsed + 5))
    if [ $elapsed -ge $timeout ]; then
      echo "ERREUR: $host n'a pas démarré après ${timeout}s"
      return 1
    fi
  done
}

wait_for_host 192.168.1.253
```

Claude a insisté sur un point : pas de `ping` ici. Ce n'est pas parce que la machine répond au ping que PBS est prêt. On teste avec SSH, qui ne répond que quand le système est complètement démarré.

## Activer le stockage PBS

Les nœuds pve1 et pve2 ont le datastore PBS configuré, mais il est **désactivé** quand pve3 est éteint (sinon Proxmox affiche des erreurs de connexion en permanence dans l'interface).

```bash
# Activer le storage sur les deux nœuds
pvesm set pbs-pve3 --disable 0  # sur pve1
ssh root@192.168.1.252 "pvesm set pbs-pve3 --disable 0"  # sur pve2
```

### Le piège de la propagation

Après `pvesm set`, le storage n'est pas immédiatement disponible. Il faut quelques secondes pour que le daemon PVE détecte le changement et établisse la connexion au datastore. On a ajouté un `sleep 10` à ce moment-là. Ce n'est pas élégant, mais c'est fiable.

## Backups parallèles

C'est le cœur du script. Les deux nœuds lancent leurs backups **en parallèle** — pve1 sauvegarde ses CTs vers PBS pendant que pve2 fait de même.

```bash
# Lancer les backups en parallèle
vzdump_pve1() {
  ssh root@192.168.1.251 "vzdump --all --mode snapshot \
    --storage pbs-pve3 --compress zstd --quiet"
}

vzdump_pve2() {
  ssh root@192.168.1.252 "vzdump --all --mode snapshot \
    --storage pbs-pve3 --compress zstd --quiet"
}

vzdump_pve1 &
vzdump_pve2 &
wait  # Attendre que les deux finissent
```

Le `--mode snapshot` est crucial : il fait un snapshot LXC avant de sauvegarder, ce qui permet de backup **sans arrêter les conteneurs**. Les services continuent de tourner pendant la sauvegarde.

`--compress zstd` utilise la compression Zstandard — le meilleur ratio vitesse/compression pour ce use case. Les 33 conteneurs passent de **202 Go** bruts à **100 Go** compressés.

## Pruning et garbage collection

Après les backups, on nettoie :

```bash
# Garder les 3 derniers backups, supprimer le reste
proxmox-backup-client prune --keep-last 3 \
  --repository root@pbs@192.168.1.150:datastore1

# Libérer l'espace disque
proxmox-backup-client garbage-collect \
  --repository root@pbs@192.168.1.150:datastore1
```

Le **pruning** marque les anciens snapshots pour suppression. Le **garbage collection** libère effectivement l'espace. Deux étapes séparées — c'est une décision de design de PBS qui permet de vérifier avant de supprimer définitivement.

## Extinction

```bash
# Désactiver le storage avant d'éteindre
pvesm set pbs-pve3 --disable 1
ssh root@192.168.1.252 "pvesm set pbs-pve3 --disable 1"

# Éteindre proprement pve3
ssh root@192.168.1.253 "shutdown -h now"
```

On désactive le storage **avant** d'éteindre pve3. Sinon, pve1 et pve2 vont détecter la perte de connexion et afficher des alertes dans l'interface — du bruit inutile.

## Le résultat

**33 conteneurs sauvegardés en 14 minutes.** De l'allumage de pve3 à son extinction.

| Métrique | Valeur |
|---|---|
| Conteneurs sauvegardés | 33 |
| Temps total (WOL → shutdown) | ~14 min |
| Données brutes | 202 Go |
| Après compression zstd | 100 Go |
| Ratio de compression | 2:1 |
| Fréquence | Chaque lundi, 00h08 |

Le script tourne en **cron sur pve1** :

```bash
# Chaque lundi à 00h08
8 0 * * 1 /root/scripts/pbs-backup.sh >> /var/log/pbs-backup.log 2>&1
```

Pourquoi 00h08 et pas minuit pile ? Parce que minuit c'est l'heure où tous les crons du monde se déclenchent. Décaler de quelques minutes évite les contentions.

## Ce que j'en retiens

### 1. L'automatisation change la nature du backup

Quand c'était manuel, je faisais un backup toutes les deux semaines — quand j'y pensais. Maintenant c'est **chaque lundi, sans exception**. La fiabilité n'est pas une question de volonté, c'est une question de système.

### 2. Le WOL est sous-estimé

Pouvoir allumer un PC à distance, c'est un superpower homelab. Ça permet d'avoir des machines "on-demand" qui ne consomment rien quand elles ne servent pas. pve3 ne tourne que 15 minutes par semaine — le reste du temps, il est éteint.

### 3. Les scripts d'orchestration sont fragiles

Chaque étape peut échouer : WOL qui ne passe pas, SSH qui timeout, vzdump qui crashe, storage qui ne se connecte pas. Le script a plus de gestion d'erreurs que de logique métier. C'est normal — c'est ça, l'automatisation en vrai.

### 4. Le silence est une feature

Le script ne produit aucune sortie quand tout va bien. Si je ne reçois pas de notification d'erreur le lundi matin, c'est que tout a fonctionné. C'est le principe du monitoring : **l'absence de signal est le signal**.

---

*Stack : Proxmox VE 8, Proxmox Backup Server, WOL, vzdump, zstd, cron. Coût additionnel : 0€.*
