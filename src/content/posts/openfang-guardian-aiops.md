---
title: "Guardian : quand l'IA surveille le homelab a ma place"
date: 2026-03-22
tags: ["ia", "automatisation", "monitoring", "homelab", "openfang"]
summary: "Deployer un agent IA qui audite mon infrastructure toutes les 6 heures — sante, securite, disques, certificats, backups. Pour 5 centimes par jour."
---

## Le probleme du monitoring classique

J'ai Beszel pour la visualisation, VictoriaMetrics pour les metriques, Loki pour les logs. Des dashboards partout. Mais **qui regarde les dashboards ?**

Le monitoring classique suppose qu'un humain est devant un ecran, pret a reagir quand un graphique vire au rouge. En realite, je regarde mes dashboards une fois par jour — en general le matin avec le cafe. Si un service tombe a 3h du matin, je ne le sais qu'a 8h.

J'avais besoin de quelque chose qui **analyse et alerte**, pas juste qui collecte et affiche.

## L'idee : un agent IA ops

**OpenFang** est un agent IA open-source (en Rust) que j'ai deploye sur CT 192. Il utilise un LLM (MiniMax M2.7 via API) pour executer des taches de facon autonome.

L'idee : programmer des audits periodiques que l'agent execute seul, avec des alertes Telegram quand quelque chose ne va pas.

> Un LLM qui lit des sorties de commandes systeme et decide si c'est normal ou pas — c'est exactement le genre de tache ou l'IA excelle. Pas besoin de comprendre le sens profond, juste de detecter les anomalies.

## Les 5 jobs du Guardian

J'ai configure 5 taches cron sur OpenFang :

| Job | Frequence | Ce qu'il fait |
|---|---|---|
| **health-check** | Toutes les 6h | Ping 33 services, verifie les reponses HTTP |
| **security-audit** | Chaque jour, 8h | Analyse les logs auth, detecte les tentatives suspectes |
| **disk-check** | Chaque jour, 9h | Verifie l'espace disque sur tous les noeuds |
| **cert-check** | Chaque jour, 10h | Verifie l'expiration des certificats TLS |
| **pbs-backup** | Lundi, 00h08 | Orchestre le backup complet (voir l'article dedie) |

### Health check : le coeur du systeme

Le health check est le plus simple et le plus critique. Toutes les 6 heures, l'agent :

1. Contacte chaque service via HTTP/HTTPS
2. Verifie le code de retour (200, 301, etc.)
3. Mesure le temps de reponse
4. Compare avec l'etat precedent (nouveau down ? nouveau up ?)
5. Envoie un resume sur Telegram

```
🟢 33/33 services UP
⏱ Temps moyen: 45ms
📊 Uptime 24h: 100%
```

Quand un service tombe :

```
🔴 ALERTE: technitium2 DOWN (timeout 5s)
Derniere reponse: il y a 6h
Action suggeree: verifier CT 101 sur pve2
```

L'agent ne se contente pas de dire "c'est down" — il suggere une action basee sur le contexte (quel CT, quel noeud, quel service).

### Security audit : lire les logs a ma place

Chaque matin a 8h, l'agent analyse les logs d'authentification des dernieres 24 heures :
- Tentatives SSH echouees
- Connexions depuis des IPs inhabituelles
- Patterns de brute-force
- Alertes CrowdSec

Il produit un rapport synthetique : soit "RAS" (rien a signaler), soit une liste d'evenements a verifier avec un niveau de criticite.

### Cert check : anticiper les expirations

Chaque certificat TLS de mon infra a une duree de 90 jours (step-ca). Le cert-check contacte chaque service en HTTPS, lit le certificat, et alerte si un certificat expire dans **moins de 14 jours**.

```bash
# Ce que l'agent execute (simplifie)
echo | openssl s_client -connect service.pixelium.internal:443 2>/dev/null \
  | openssl x509 -noout -enddate
```

Sans cette verification, un certificat expire silencieusement et Traefik commence a servir des erreurs TLS. Les utilisateurs voient "connexion non securisee" et moi je ne sais rien.

## Le cout : 5 centimes par jour

L'agent utilise **MiniMax M2.7** via API — un modele compact mais suffisant pour de l'analyse de logs et du monitoring. Le cout :

| Operation | Tokens | Cout |
|---|---|---|
| Health check (x4/jour) | ~2000 tokens/run | ~$0.008 |
| Security audit | ~3000 tokens | ~$0.003 |
| Disk check | ~1000 tokens | ~$0.001 |
| Cert check | ~1500 tokens | ~$0.002 |
| **Total quotidien** | | **~$0.05** |

Cinquante centimes par mois pour un "SRE virtuel" qui travaille 24/7. Le rapport qualite/prix est absurde.

## Les surprises

### Ce que le Guardian a detecte tout seul

- Un service qui retournait 502 de facon intermittente (Linkwarden apres une mise a jour ratee)
- Un disque a 87% sur pve2 (les logs Loki grossissaient sans rotation)
- Un certificat qui expirait dans 8 jours (le renouvellement automatique avait silencieusement echoue)

Trois problemes que j'aurais probablement decouverts trop tard sans l'agent.

### La limite du LLM

L'agent n'est pas infaillible. Sur les faux positifs :
- Un service qui met 3 secondes a repondre est signale comme "lent", meme si c'est normal pour ce service (Immich au premier chargement)
- Les logs d'auth Proxmox contiennent des lignes que l'agent interprete parfois comme suspectes alors qu'elles sont normales (renouvellement de token API)

La solution : un fichier de contexte que l'agent consulte avant de juger. "Immich peut etre lent au premier appel", "les tokens claude@pve sont normaux".

## Ce que j'ai appris

### 1. L'IA ops, c'est du monitoring augmente

Ca ne remplace pas Beszel ou VictoriaMetrics — ca les complete. Les dashboards collectent, l'agent analyse et decide. Les deux sont necessaires.

### 2. Le cout marginal de l'IA est devenu negligeable

$0.05/jour pour 5 audits complets d'infrastructure. Il y a deux ans, ca aurait coute 100x plus cher. La baisse des couts des LLM rend ce genre d'automatisation accessible meme pour un homelab.

### 3. Les faux positifs sont gereables

Avec un fichier de contexte et quelques semaines d'entrainement (ignorer les patterns normaux), le rapport signal/bruit est devenu excellent. L'agent envoie ~1 alerte par semaine en dehors des rapports de routine.

### 4. L'automatisation cree de la confiance

Depuis que Guardian tourne, je dors mieux. Pas parce que l'infra est plus fiable — mais parce que je sais que quelqu'un surveille.

---

*Stack : OpenFang (Rust, CT 192), MiniMax M2.7, cron jobs, alertes Telegram. Cout : ~$1.50/mois.*
