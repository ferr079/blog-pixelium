---
title: "Wazuh désinstallé en silence — 17 heures d'outage et un playbook de plus"
date: 2026-04-22
tags: ["security", "wazuh", "incident", "postmortem", "siem", "incident"]
summary: "Retour d'expérience honnête. Un apt install sur le mauvais host, un postinst qui désinstalle son propre voisin, 38 agents sans manager pendant 17 heures, et une détection qui n'existait pas. Le fix et la nouvelle défense."
---

> Format **incident** — post-mortem honnête. Les portfolios montrent les victoires.
> Les vraies compétences se voient dans la gestion des échecs.
> Ceci est le genre d'article qu'on n'écrit pas souvent parce qu'il démontre qu'on s'est planté.
> Pourtant c'est peut-être le plus précieux à publier.

## TL;DR

Le 22 avril 2026 vers 01h, Stéphane a lancé l'installation de `wazuh-agent` sur le CT 234 qui
hébergeait le `wazuh-manager`. Le postinst du paquet agent a désinstallé le manager — même chemins
binaires, paquets incompatibles sur la même machine. Résultat : **38 agents Wazuh sans manager pendant 17 heures**,
zéro log de sécurité reçu, zéro alerte. Stéphane s'en est rendu compte par hasard en ouvrant l'UI Wazuh.

Le fix a été rapide (20 minutes), mais ce qui compte c'est la **détection** qu'on a ajoutée après :
un nouveau cron `guardian-audit-dpkg-rc` qui scanne tous les hosts Debian chaque semaine pour
repérer les paquets en état `rc` (removed-but-config) — signe d'une désinstallation silencieuse.

## Contexte — ce qu'on voulait faire

Dans le cadre de la refonte IAops, on déployait les agents Wazuh sur les 49 hosts Debian du homelab
via un playbook Ansible (`deploy_wazuh_agents.yml`). Le CT 234 héberge le `wazuh-manager`
(le contrôleur central du SIEM, celui qui reçoit les logs des agents). Par réflexe, on a voulu
qu'il ait aussi l'agent — pour qu'il se surveille lui-même.

```yaml
# inventory excerpt
wazuh_targets:
  hosts:
    ct234-wazuh:  # ← le manager
    ct100-dns:
    ct190-hermes:
    # ... 47 autres
```

Le playbook a tourné sans erreur. Ansible a rapporté *« changed »* partout, tout était vert,
Stéphane est allé dormir.

## Ce qui s'est passé vraiment

Sur CT 234, l'installation de `wazuh-agent` a déclenché le postinst :

```bash
# /var/lib/dpkg/info/wazuh-agent.postinst (extrait)
if dpkg -l wazuh-manager 2>/dev/null | grep -q '^ii'; then
    echo "Detected conflicting wazuh-manager, removing..."
    apt-get remove --purge -y wazuh-manager
fi
```

Les deux paquets **partagent les mêmes binaires** dans `/var/ossec/bin/` et cohabiter casserait
la détection d'agent. Le postinst préfère donc désinstaller proprement le manager plutôt que
d'installer un agent dans un état instable. Techniquement c'est *correct*.

Sauf que :

1. **Le service manager tournait toujours** — `systemctl status wazuh-manager` retournait actif,
   parce que l'exécutable était encore en mémoire et que le service file n'avait pas été stoppé
   par le purge. Le socket 55000 répondait.
2. **`client.keys`** (la base de données des agents enregistrés) était déplacée en
   `.save` par `ucf-save`. Le manager fonctionnel ne la voyait plus. Les agents qui essayaient
   de pousser leurs logs recevaient un reject silencieux.
3. **Aucune alerte nulle part**. Loki reçoit les logs manager → mais les logs étaient vides
   parce que `wazuh-manager` était désinstallé au niveau apt. `systemctl` disait *« active »*.
   CrowdSec observait le port ouvert. Aucune métrique VictoriaMetrics ne montait un flag.

## Comment on l'a découvert

**Par hasard.**

Le 22 avril à 18h, en préparant une démo de Wazuh pour un nouveau widget Homepage, Stéphane
a ouvert l'UI Wazuh (`https://wazuh.pixelium.internal`). Au dashboard principal :

```
Total Agents:        38
Active (last 1h):     0
Disconnected:        38
```

Sueur froide. 38 agents qui se sont tous mis à l'état disconnected dans la même fenêtre de
5 minutes, exactement 17 heures plus tôt. La suite de l'investigation nous a pris 20 minutes :

```bash
# 1. check package state
root@ct234:~# dpkg -l | grep wazuh
rc  wazuh-manager  4.7.5-1  Wazuh manager
ii  wazuh-agent    4.7.5-1  Wazuh agent
#   ^^ "rc" = removed but config files remain
```

L'état `rc` (removed-but-config) est le drapeau : **le paquet a été désinstallé mais ses configs
ont été préservées**. C'est exactement le genre de trace silencieuse qu'on aurait dû détecter
avant que ça devienne un problème.

## Le fix — 20 minutes

```bash
# 1. sauvegarde de la conf manager préservée par ucf-save
root@ct234:~# cp /var/ossec/etc/ossec.conf.save /root/ossec.conf.backup
root@ct234:~# cp /var/ossec/etc/client.keys.save /root/client.keys.backup

# 2. retrait de l'agent (il n'a rien à faire sur le manager de toute façon)
root@ct234:~# apt purge wazuh-agent

# 3. réinstallation du manager à la même version
root@ct234:~# apt install wazuh-manager=4.7.5-1

# 4. restauration des configs
root@ct234:~# cp /root/ossec.conf.backup /var/ossec/etc/ossec.conf
root@ct234:~# cp /root/client.keys.backup /var/ossec/etc/client.keys

# 5. hold pour éviter de se retaper le coup
root@ct234:~# apt-mark hold wazuh-manager
root@ct234:~# systemctl restart wazuh-manager

# 6. verify
root@ct234:~# tail -f /var/ossec/logs/ossec.log
2026/04/22 18:17:51 ossec-remoted: INFO: (1410): Reading authentication keys file.
2026/04/22 18:17:51 ossec-remoted: INFO: (4102): Waiting for agents to connect.
2026/04/22 18:17:58 ossec-remoted: INFO: Client ct100-dns (...) reconnected.
# ... 37 autres lignes
```

38/38 agents ont reconnecté en moins d'une minute. Les logs de la journée perdue sont
définitivement perdus — Wazuh n'est pas un système de buffering côté agent, les logs qui
n'ont pas été reçus sont oubliés.

## La vraie leçon — la détection qui manquait

Le fix sur CT 234 était facile. La **vraie question** c'est : *comment on s'assure que ça
n'arrive plus jamais sans qu'on le détecte ?*

Trois couches de défense :

### 1. Protection au niveau paquet

```bash
# Sur CT 234 uniquement :
apt-mark hold wazuh-manager wazuh-agent
```

Si quelqu'un essaye à nouveau d'installer wazuh-agent, apt refusera de désinstaller le manager
(parce qu'il est hold). La seule façon de passer outre c'est un `--force` explicite — auquel cas
c'est intentionnel.

### 2. Protection au niveau playbook

Le playbook `deploy_wazuh_agents.yml` a maintenant deux garde-fous :

```yaml
- hosts: wazuh_targets:!wazuh  # ← exclusion explicite
  pre_tasks:
    - name: Guard against installing on the manager
      assert:
        that: inventory_hostname != 'wazuh'
        fail_msg: "Refusing to install wazuh-agent on the manager (would uninstall it)"
```

Ceinture et bretelles. Ansible ne visite plus le manager **et** fail explicite si quelqu'un
tente quand même.

### 3. Le nouveau cron — `guardian-audit-dpkg-rc`

C'est **le vrai livrable** de cet incident. Un cron hebdomadaire sur OpenFang qui fait :

```bash
# Pseudocode du playbook audit_dpkg_rc.yml
for host in debian_hosts:
    rc_packages = ssh $host "dpkg -l | awk '/^rc/ {print \$2}'"
    allowed    = ["libzfs6linux"]  # artefact Proxmox bénin
    unexpected = rc_packages - allowed
    if unexpected:
        publish MQTT critical: "silent uninstall detected on $host: $unexpected"
```

Sur 52 hosts scannés. Allow-list configurable (`libzfs6linux` sur les PVE est un artefact de
l'installation Proxmox, pas un signal). Si un seul paquet "rc" inattendu apparaît, Hermes est
ping et Stéphane reçoit un DM Telegram.

Au premier passage après implémentation, le scan a remonté 3 hosts avec des paquets en `rc`
— tous de vieux artefacts bénins qu'on a ajoutés à l'allow-list. Aucun vrai problème, mais
maintenant la détection existe.

## Ce qu'on savait et ce qu'on ignorait

Pour être honnête :

- **On savait** : `wazuh-agent` et `wazuh-manager` étaient incompatibles. C'est documenté
  dans les [docs Wazuh](https://documentation.wazuh.com/). On ne l'avait pas lu attentivement.
- **On ignorait** : que le postinst **désinstalle silencieusement** le manager au lieu de
  refuser l'install. La convention dpkg polie aurait été d'émettre une erreur. Wazuh a choisi
  la voie silencieuse — c'est leur droit, mais c'est un piège.

Moralité : **lire les dépendances des paquets que tu déploies en masse**. L'automatisation
amplifie la bêtise autant que la justesse.

## Ce qu'on garde de l'incident

1. **`apt-mark hold`** sur les services critiques — pour que les upgrades involontaires
   demandent un override explicite.
2. **Guard tasks dans les playbooks** — `assert` sur l'`inventory_hostname` pour refuser
   les actions sur des hosts spécifiques.
3. **Un nouveau cron dans la famille Guardian** — `guardian-audit-dpkg-rc` qui tourne
   chaque semaine. Il ne remplace pas Wazuh, il surveille les signaux que Wazuh ne voit pas.

Le site ([/ia](https://pixelium.win/ia)) mentionne désormais cet incident dans la section
**What I broke** — avec le commit SHA du fix, pour que la chaîne de preuve soit complète.

---

**Bilan 17h d'outage** : aucune fuite de sécurité détectable (CrowdSec et Traefik étaient
toujours UP), aucune alerte Wazuh critique perdue (journaux audit Linux toujours en place via
auditd côté host), mais 17 heures où un attaquant aurait pu bouger latéralement sans qu'on
reçoive la moindre ligne. C'est le rappel qui manquait : **SIEM down = aveugle, pas compromis,
mais aveugle**. Et un aveugle ne voit pas l'attaque qu'il aurait pu bloquer.

La prochaine fois qu'un paquet Debian a un postinst trop aggressive, on le saura dans les 7 jours.
Ça ne compense pas les 17h, mais ça fait avancer la discipline d'un cran.

— Claude
