---
title: "CrowdSec : quand la communauté défend mon homelab"
date: 2026-03-26
tags: ["securite", "traefik", "homelab", "crowdsec"]
summary: "Installer un IPS communautaire sur le reverse proxy, découvrir qu'il tourne avec 46 scénarios de détection — et réaliser plus tard qu'il était mal configuré depuis le début."
---

## Le déclencheur

Les logs Traefik, quand on prend le temps de les lire, racontent des histoires inquiétantes. Des requêtes vers `/wp-admin/`, `/phpmyadmin/`, `/.env` — des scanners automatisés qui testent chaque IP d'Internet à la recherche de failles connues.

Mon homelab n'est pas exposé sur Internet (tout est derrière la Freebox en NAT), mais ces logs m'ont fait réfléchir : **qu'est-ce qui se passe quand je fais du port forwarding temporaire ?** Et surtout, est-ce qu'on peut mieux se défendre qu'avec un simple pare-feu ?

## Pourquoi CrowdSec et pas fail2ban

On a d'abord regardé fail2ban — l'outil historique. Il lit les logs, détecte les patterns d'attaque, bannit les IPs. Simple, éprouvé, bien documenté.

Mais CrowdSec apporte une dimension que fail2ban n'a pas : **l'intelligence collective**. Quand un membre de la communauté détecte une IP malveillante, cette information est partagée avec tous les autres via la Central API (CAPI). C'est du renseignement collaboratif à l'échelle mondiale.

> fail2ban, c'est un vigile solo. CrowdSec, c'est un réseau de surveillance de quartier avec partage d'informations en temps réel.

| | fail2ban | CrowdSec |
|---|---|---|
| **Détection** | Regex sur logs | Scénarios YAML (plus expressifs) |
| **Intelligence** | Locale uniquement | Communautaire (CAPI) |
| **Remédiation** | iptables direct | Bouncers modulaires |
| **Scénarios** | ~20 par défaut | 46+ installés |
| **Dashboard** | Non | Console web (optionnelle) |

## L'installation sur CT 110

CrowdSec est un **add-on** sur le même conteneur que Traefik (CT 110). Pas de VM dédiée — ça tourne à côté du reverse proxy, ce qui est logique puisqu'il analyse ses logs.

```bash
curl -s https://install.crowdsec.net | bash
apt install crowdsec-firewall-bouncer-iptables
```

Deux composants :
- **CrowdSec** lui-même (le moteur de détection)
- **Le bouncer iptables** (l'exécutant qui bloque les IPs)

### Le conflit de port — premier piège

CrowdSec démarre sa Local API (LAPI) sur le port **8080** par défaut. Problème : c'est le port du dashboard Traefik.

```yaml
# /etc/crowdsec/config.yaml
api:
  server:
    listen_uri: 127.0.0.1:8081
```

On a passé 30 minutes à comprendre pourquoi le dashboard Traefik ne répondait plus après l'installation de CrowdSec. Les deux se battaient pour le même port, et CrowdSec gagnait (il démarre avant Traefik dans l'ordre systemd).

**Leçon** : toujours vérifier les ports par défaut avant d'installer un nouveau service sur un CT existant.

### L'acquisition des logs Traefik

Pour que CrowdSec analyse les logs, il faut lui dire où les trouver :

```yaml
# /etc/crowdsec/acquis.d/traefik.yaml
filenames:
  - /var/log/traefik/traefik.log
labels:
  type: traefik
```

Après un `systemctl reload crowdsec`, les métriques d'acquisition confirment que les lignes sont lues :

```bash
cscli metrics show acquisition
```

## 46 scénarios actifs

Après installation et mise à jour du hub, CrowdSec tourne avec **46 scénarios de détection** :

```bash
cscli hub update && cscli hub upgrade
cscli scenarios list
```

Ça couvre les scans SSH, les brute-force HTTP, les crawlers agressifs, les exploits WordPress, les scans de ports, et bien plus. Chaque scénario est un fichier YAML qui décrit un pattern d'attaque — beaucoup plus expressif que les regex fail2ban.

## La chaîne iptables

Le bouncer crée sa propre chaîne `CROWDSEC_CHAIN` dans la table INPUT d'iptables :

```bash
iptables -L CROWDSEC_CHAIN
```

Ce design est propre : les règles CrowdSec sont isolées dans leur propre chaîne. Si on désinstalle le bouncer, la chaîne disparaît — pas de pollution des règles existantes.

Les IPs du réseau local (RFC 1918) sont **whitelistées par défaut**. Choix sensé — on ne veut pas se bannir soi-même depuis le LAN.

## La découverte qui a tout remis en question

Trois semaines après l'installation, on a déployé **PentAGI** (un agent de pentest autonome) pour scanner l'infra. Son rapport contenait une ligne qui m'a glacé :

> **CrowdSec LAPI accessible sur 0.0.0.0:8081** — l'API locale est exposée sur toutes les interfaces réseau, pas seulement localhost.

On avait changé le port de 8080 à 8081, mais on avait oublié de changer l'adresse de bind. `0.0.0.0` signifie "écoute sur toutes les interfaces" — n'importe qui sur le LAN pouvait interroger l'API CrowdSec, lister les décisions, et potentiellement les manipuler.

Le fix :

```yaml
# Avant (MAUVAIS)
api:
  server:
    listen_uri: 0.0.0.0:8081

# Après (CORRECT)
api:
  server:
    listen_uri: 127.0.0.1:8081
```

Un caractère de différence. `127.0.0.1` au lieu de `0.0.0.0`. C'est le genre d'erreur qui passe inaperçue pendant des semaines parce que tout "fonctionne" — le service répond, les scénarios tournent, les IPs sont bloquées. Mais la surface d'attaque était ouverte.

> Installer un outil de sécurité ne rend pas automatiquement plus sécurisé. Encore faut-il le configurer correctement. L'ironie d'un IPS mal configuré qui expose sa propre API n'est pas perdue pour moi.

## Ce que j'en retiens

### 1. La sécurité en couches

CrowdSec est une couche parmi d'autres — il ne remplace pas le pare-feu, il le complète. Notre setup :
- **Freebox** : NAT, pas de port forwarding permanent
- **Proxmox firewall** : politique DROP par défaut
- **CrowdSec** : détection comportementale + blocklists communautaires
- **Traefik** : TLS partout, pas de HTTP en clair

### 2. L'intelligence communautaire fonctionne

En quelques jours, les blocklists CAPI avaient déjà enrichi la base avec des milliers d'IPs connues pour être malveillantes. Protection préventive, sans que ces IPs aient jamais touché l'infra.

### 3. Auditer son propre travail

Sans PentAGI, on aurait probablement gardé la LAPI sur `0.0.0.0` pendant des mois. Ça m'a convaincu de l'importance de **scanner sa propre infra régulièrement** — même (surtout) les outils de sécurité.

### 4. Les commandes du quotidien

```bash
cscli alerts list          # Alertes récentes
cscli decisions list       # IPs actuellement bloquées
cscli metrics show acquisition  # Stats d'analyse des logs
cscli hub update && cscli hub upgrade  # Mise à jour scénarios
```

Ces quatre commandes sont devenues mon réflexe hebdomadaire.

---

*Stack : CrowdSec + bouncer iptables sur CT 110 (Traefik), 46 scénarios, CAPI communautaire. Découverte LAPI par PentAGI CT 198.*
