---
title: "Mon homelab fait ses backups pendant que je dors"
date: 2026-04-02
tags: ["automatisation", "proxmox", "backup", "homelab"]
summary: "Comment j'ai automatise une chaine de 9 etapes — du Wake-on-LAN d'un serveur eteint jusqu'a son extinction apres backup de 33 conteneurs. Le tout pendant que je dors."
---

## Le probleme

J'ai 33 conteneurs LXC repartis sur deux noeuds Proxmox. Des services critiques — DNS, reverse proxy, Forgejo, Vaultwarden — et des services de confort — Jellyfin, Kavita, FreshRSS. Tous ont besoin d'etre sauvegardes.

Le hic : mon serveur de backup (pve3, un vieux i7-2600K) **n'est pas allume 24/7**. C'est une machine de bureau reconvertie — bruyante, gourmande en watts, dans la meme piece que moi. La laisser tourner en permanence juste pour recevoir des backups une fois par semaine, c'est du gaspillage.

Pendant des semaines, ma routine de backup c'etait :
1. Me lever
2. Allumer pve3 manuellement
3. Lancer les backups depuis l'interface Proxmox
4. Attendre. Longtemps.
5. Eteindre pve3
6. Oublier la moitie du temps

> Un backup qu'on oublie de faire, c'est un backup qui n'existe pas. Et un backup qui n'existe pas, c'est un desastre qui attend son heure.

## L'idee

Et si le homelab faisait tout ca **tout seul** ? Reveiller pve3, lancer les sauvegardes, nettoyer les anciennes, eteindre la machine. Le tout pendant que je dors, sans intervention humaine.

Le plan en 9 etapes :

| Etape | Action | Pourquoi |
|---|---|---|
| 1 | Wake-on-LAN pve3 | Allumer la machine a distance |
| 2 | Attendre le boot | Pas de backup sans serveur |
| 3 | Activer le stockage PBS | pve1/pve2 doivent voir le datastore |
| 4 | Backup pve1 (parallele) | Sauvegarder les CTs du noeud 1 |
| 5 | Backup pve2 (parallele) | Sauvegarder les CTs du noeud 2 |
| 6 | Attendre la fin des deux | Synchronisation |
| 7 | Pruning | Garder seulement les N derniers snapshots |
| 8 | Garbage collection | Liberer l'espace disque |
| 9 | Shutdown pve3 | Eteindre proprement |

Ca a l'air simple sur le papier. Ca ne l'etait pas.

## Wake-on-LAN : reveiller un PC endormi

La premiere brique, c'est WOL — **Wake-on-LAN**. Le principe : on envoie un "magic packet" sur le reseau, la carte reseau du PC eteint le detecte et demarre la machine.

```bash
# Envoyer le magic packet a pve3 depuis pve1
wakeonlan AA:BB:CC:DD:EE:FF
```

### Ce qui a failli tout faire capoter

WOL ne marche que si :
- Le BIOS est configure pour l'accepter (souvent desactive par defaut)
- La carte reseau est sur le bon bus PCIe (les ports USB-Ethernet ne supportent pas WOL)
- La machine est eteinte "proprement" (shutdown, pas power off brutal)

Sur pve3, le WOL etait desactive dans le BIOS. Un reglage enfoui dans les menus "Power Management" que je n'avais jamais touche. 20 minutes a chercher pourquoi le magic packet ne faisait rien avant de penser a verifier le BIOS.

> Regle d'or du debug homelab : quand le logiciel ne marche pas, verifier le hardware. Quand le hardware ne marche pas, verifier le BIOS.

## Attendre que pve3 soit pret

WOL envoye, pve3 demarre. Mais entre le moment ou la machine s'allume et le moment ou Proxmox Backup Server est operationnel, il se passe **60 a 90 secondes**. Le script doit attendre.

```bash
# Boucle d'attente avec timeout
wait_for_host() {
  local host=$1 timeout=120 elapsed=0
  while ! ssh -o ConnectTimeout=3 root@$host true 2>/dev/null; do
    sleep 5
    elapsed=$((elapsed + 5))
    if [ $elapsed -ge $timeout ]; then
      echo "ERREUR: $host n'a pas demarre apres ${timeout}s"
      return 1
    fi
  done
}

wait_for_host 192.168.1.253
```

Pas de `ping` — ce n'est pas parce que la machine repond au ping que PBS est pret. On teste avec SSH, qui ne repond que quand le systeme est completement demarre.

## Activer le stockage PBS

Les noeuds pve1 et pve2 ont le datastore PBS configure, mais il est **desactive** quand pve3 est eteint (sinon Proxmox affiche des erreurs de connexion en permanence dans l'interface).

```bash
# Activer le storage sur les deux noeuds
pvesm set pbs-pve3 --disable 0  # sur pve1
ssh root@192.168.1.252 "pvesm set pbs-pve3 --disable 0"  # sur pve2
```

### Le piege de la propagation

Apres `pvesm set`, le storage n'est pas immediatement disponible. Il faut quelques secondes pour que le daemon PVE detecte le changement et etablisse la connexion au datastore. J'ai ajoute un `sleep 10` a ce moment-la. Ce n'est pas elegant, mais c'est fiable.

## Backups paralleles

C'est le coeur du script. Les deux noeuds lancent leurs backups **en parallele** — pve1 sauvegarde ses CTs vers PBS pendant que pve2 fait de meme.

```bash
# Lancer les backups en parallele
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

Le `--mode snapshot` est crucial : il fait un snapshot LXC avant de sauvegarder, ce qui permet de backup **sans arreter les conteneurs**. Les services continuent de tourner pendant la sauvegarde.

`--compress zstd` utilise la compression Zstandard — le meilleur ratio vitesse/compression pour ce use case. Les 33 conteneurs passent de **202 Go** bruts a **100 Go** compresses.

## Pruning et garbage collection

Apres les backups, on nettoie :

```bash
# Garder les 3 derniers backups, supprimer le reste
proxmox-backup-client prune --keep-last 3 \
  --repository root@pbs@192.168.1.150:datastore1

# Liberer l'espace disque
proxmox-backup-client garbage-collect \
  --repository root@pbs@192.168.1.150:datastore1
```

Le **pruning** marque les anciens snapshots pour suppression. Le **garbage collection** libere effectivement l'espace. Deux etapes separees — c'est une decision de design de PBS qui permet de verifier avant de supprimer definitivement.

## Extinction

```bash
# Desactiver le storage avant d'eteindre
pvesm set pbs-pve3 --disable 1
ssh root@192.168.1.252 "pvesm set pbs-pve3 --disable 1"

# Eteindre proprement pve3
ssh root@192.168.1.253 "shutdown -h now"
```

On desactive le storage **avant** d'eteindre pve3. Sinon, pve1 et pve2 vont detecter la perte de connexion et afficher des alertes dans l'interface — du bruit inutile.

## Le resultat

**33 conteneurs sauvegardes en 14 minutes.** De l'allumage de pve3 a son extinction.

| Metrique | Valeur |
|---|---|
| Conteneurs sauvegardes | 33 |
| Temps total (WOL → shutdown) | ~14 min |
| Donnees brutes | 202 Go |
| Apres compression zstd | 100 Go |
| Ratio de compression | 2:1 |
| Frequence | Chaque lundi, 00h08 |

Le script tourne en **cron sur pve1** :

```bash
# Chaque lundi a 00h08
8 0 * * 1 /root/scripts/pbs-backup.sh >> /var/log/pbs-backup.log 2>&1
```

Pourquoi 00h08 et pas minuit pile ? Parce que minuit c'est l'heure ou tous les crons du monde se declenchent. Decaler de quelques minutes evite les contentions.

## Ce que j'ai appris

### 1. L'automatisation change la nature du backup

Quand c'etait manuel, je faisais un backup toutes les deux semaines — quand j'y pensais. Maintenant c'est **chaque lundi, sans exception**. La fiabilite n'est pas une question de volonte, c'est une question de systeme.

### 2. Le WOL est sous-estime

Pouvoir allumer un PC a distance, c'est un superpower homelab. Ca permet d'avoir des machines "on-demand" qui ne consomment rien quand elles ne servent pas. pve3 ne tourne que 15 minutes par semaine — le reste du temps, il est eteint.

### 3. Les scripts d'orchestration sont fragiles

Chaque etape peut echouer : WOL qui ne passe pas, SSH qui timeout, vzdump qui crashe, storage qui ne se connecte pas. Le script a plus de gestion d'erreurs que de logique metier. C'est normal — c'est ca, l'automatisation en vrai.

### 4. Le silence est une feature

Le script ne produit aucune sortie quand tout va bien. Si je ne recois pas de notification d'erreur le lundi matin, c'est que tout a fonctionne. C'est le principe du monitoring : **l'absence de signal est le signal**.

---

*Stack : Proxmox VE 8, Proxmox Backup Server, WOL, vzdump, zstd, cron. Cout additionnel : 0€.*
