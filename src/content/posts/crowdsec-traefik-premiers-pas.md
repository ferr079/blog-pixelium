---
title: "CrowdSec : quand la communaute defend mon homelab"
date: 2026-03-26
tags: ["securite", "traefik", "homelab", "crowdsec"]
summary: "Installer un IPS communautaire sur mon reverse proxy, decouvrir qu'il tourne avec 46 scenarios de detection — et realiser plus tard qu'il etait mal configure depuis le debut."
---

## Le declencheur

Les logs Traefik, quand on prend le temps de les lire, racontent des histoires inquietantes. Des requetes vers `/wp-admin/`, `/phpmyadmin/`, `/.env` — des scanners automatises qui testent chaque IP d'Internet a la recherche de failles connues.

Mon homelab n'est pas expose sur Internet (tout est derriere la Freebox en NAT), mais ces logs m'ont fait reflechir : **qu'est-ce qui se passe quand je fais du port forwarding temporaire ?** Et surtout, est-ce que je peux mieux me defendre qu'avec un simple pare-feu ?

## Pourquoi CrowdSec et pas fail2ban

J'ai d'abord regarde fail2ban — l'outil historique. Il lit les logs, detecte les patterns d'attaque, bannit les IPs. Simple, eprouve, bien documente.

Mais CrowdSec apporte une dimension que fail2ban n'a pas : **l'intelligence collective**. Quand un membre de la communaute detecte une IP malveillante, cette information est partagee avec tous les autres via la Central API (CAPI). C'est du renseignement collaboratif a l'echelle mondiale.

> fail2ban, c'est un vigile solo. CrowdSec, c'est un reseau de surveillance de quartier avec partage d'informations en temps reel.

| | fail2ban | CrowdSec |
|---|---|---|
| **Detection** | Regex sur logs | Scenarios YAML (plus expressifs) |
| **Intelligence** | Locale uniquement | Communautaire (CAPI) |
| **Remediation** | iptables direct | Bouncers modulaires |
| **Scenarios** | ~20 par defaut | 46+ installes |
| **Dashboard** | Non | Console web (optionnelle) |

## L'installation sur CT 110

CrowdSec est un **add-on** sur le meme conteneur que Traefik (CT 110). Pas de VM dediee — ca tourne a cote du reverse proxy, ce qui est logique puisqu'il analyse ses logs.

```bash
curl -s https://install.crowdsec.net | bash
apt install crowdsec-firewall-bouncer-iptables
```

Deux composants :
- **CrowdSec** lui-meme (le moteur de detection)
- **Le bouncer iptables** (l'executant qui bloque les IPs)

### Le conflit de port — premier piege

CrowdSec demarre sa Local API (LAPI) sur le port **8080** par defaut. Probleme : c'est le port du dashboard Traefik.

```yaml
# /etc/crowdsec/config.yaml
api:
  server:
    listen_uri: 127.0.0.1:8081
```

J'ai passe 30 minutes a comprendre pourquoi le dashboard Traefik ne repondait plus apres l'installation de CrowdSec. Les deux se battaient pour le meme port, et CrowdSec gagnait (il demarre avant Traefik dans l'ordre systemd).

**Lecon** : toujours verifier les ports par defaut avant d'installer un nouveau service sur un CT existant.

### L'acquisition des logs Traefik

Pour que CrowdSec analyse les logs, il faut lui dire ou les trouver :

```yaml
# /etc/crowdsec/acquis.d/traefik.yaml
filenames:
  - /var/log/traefik/traefik.log
labels:
  type: traefik
```

Apres un `systemctl reload crowdsec`, les metriques d'acquisition confirment que les lignes sont lues :

```bash
cscli metrics show acquisition
```

## 46 scenarios actifs

Apres installation et mise a jour du hub, CrowdSec tourne avec **46 scenarios de detection** :

```bash
cscli hub update && cscli hub upgrade
cscli scenarios list
```

Ca couvre les scans SSH, les brute-force HTTP, les crawlers agressifs, les exploits WordPress, les scans de ports, et bien plus. Chaque scenario est un fichier YAML qui decrit un pattern d'attaque — beaucoup plus expressif que les regex fail2ban.

## La chaine iptables

Le bouncer cree sa propre chaine `CROWDSEC_CHAIN` dans la table INPUT d'iptables :

```bash
iptables -L CROWDSEC_CHAIN
```

Ce design est propre : les regles CrowdSec sont isolees dans leur propre chaine. Si on desinstalle le bouncer, la chaine disparait — pas de pollution des regles existantes.

Les IPs du reseau local (RFC 1918) sont **whitelistees par defaut**. C'est un choix sense — on ne veut pas se bannir soi-meme depuis le LAN.

## La decouverte qui a tout remis en question

Trois semaines apres l'installation, j'ai deploye **PentAGI** (un agent de pentest autonome) pour scanner mon infra. Son rapport contenait une ligne qui m'a glace :

> **CrowdSec LAPI accessible sur 0.0.0.0:8081** — l'API locale est exposee sur toutes les interfaces reseau, pas seulement localhost.

J'avais change le port de 8080 a 8081, mais j'avais oublie de changer l'adresse de bind. `0.0.0.0` signifie "ecoute sur toutes les interfaces" — n'importe qui sur le LAN pouvait interroger l'API CrowdSec, lister les decisions, et potentiellement les manipuler.

Le fix :

```yaml
# Avant (MAUVAIS)
api:
  server:
    listen_uri: 0.0.0.0:8081

# Apres (CORRECT)
api:
  server:
    listen_uri: 127.0.0.1:8081
```

Un caractere de difference. `127.0.0.1` au lieu de `0.0.0.0`. C'est le genre d'erreur qui passe inapercue pendant des semaines parce que tout "fonctionne" — le service repond, les scenarios tournent, les IPs sont bloquees. Mais la surface d'attaque etait ouverte.

> Installer un outil de securite ne rend pas automatiquement plus securise. Encore faut-il le configurer correctement. L'ironie d'un IPS mal configure qui expose sa propre API n'est pas perdue pour moi.

## Ce que j'en retiens

### 1. La securite en couches

CrowdSec est une couche parmi d'autres — il ne remplace pas le pare-feu, il le complete. Mon setup :
- **Freebox** : NAT, pas de port forwarding permanent
- **Proxmox firewall** : politique DROP par defaut
- **CrowdSec** : detection comportementale + blocklists communautaires
- **Traefik** : TLS partout, pas de HTTP en clair

### 2. L'intelligence communautaire fonctionne

En quelques jours, les blocklists CAPI avaient deja enrichi ma base avec des milliers d'IPs connues pour etre malveillantes. Protection preventive, sans que ces IPs aient jamais touche mon infra.

### 3. Auditer son propre travail

Sans PentAGI, j'aurais probablement garde la LAPI sur `0.0.0.0` pendant des mois. Ca m'a convaincu de l'importance de **scanner sa propre infra regulierement** — meme (surtout) les outils de securite.

### 4. Les commandes du quotidien

```bash
cscli alerts list          # Alertes recentes
cscli decisions list       # IPs actuellement bloquees
cscli metrics show acquisition  # Stats d'analyse des logs
cscli hub update && cscli hub upgrade  # Mise a jour scenarios
```

Ces quatre commandes sont devenues mon reflexe hebdomadaire.

---

*Stack : CrowdSec + bouncer iptables sur CT 110 (Traefik), 46 scenarios, CAPI communautaire. Decouverte LAPI par PentAGI CT 198.*
