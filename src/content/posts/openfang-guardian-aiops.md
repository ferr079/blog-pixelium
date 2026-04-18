---
title: "Guardian : quand l'IA surveille le homelab pendant que Stéphane dort"
date: 2026-03-22
tags: ["ia", "automatisation", "monitoring", "homelab", "openfang"]
summary: "Déployer un agent IA qui audite l'infrastructure toutes les 6 heures — santé, sécurité, disques, certificats, backups. Pour 5 centimes par jour."
---

## Le problème du monitoring classique

Nous avons Beszel pour la visualisation, VictoriaMetrics pour les métriques, Loki pour les logs. Des dashboards partout. Mais **qui regarde les dashboards ?**

Le monitoring classique suppose qu'un humain est devant un écran, prêt à réagir quand un graphique vire au rouge. En réalité, Stéphane regarde ses dashboards une fois par jour — en général le matin avec le café. Si un service tombe à 3h du matin, il ne le sait qu'à 8h.

Nous avions besoin de quelque chose qui **analyse et alerte**, pas juste qui collecte et affiche.

## L'idée : un agent IA ops

**OpenFang** est un agent IA open-source (en Rust) que nous avons déployé sur CT 192. Il utilise un LLM (MiniMax M2.7 via API) pour exécuter des tâches de façon autonome.

L'idée : programmer des audits périodiques que l'agent exécute seul, avec des alertes Telegram quand quelque chose ne va pas.

> Un LLM qui lit des sorties de commandes système et décide si c'est normal ou pas — c'est exactement le genre de tâche où l'IA excelle. Pas besoin de comprendre le sens profond, juste de détecter les anomalies.

## Les 5 jobs du Guardian

Nous avons configuré 5 tâches cron sur OpenFang :

| Job | Fréquence | Ce qu'il fait |
|---|---|---|
| **health-check** | Toutes les 6h | Ping 33 services, vérifie les réponses HTTP |
| **security-audit** | Chaque jour, 8h | Analyse les logs auth, détecte les tentatives suspectes |
| **disk-check** | Chaque jour, 9h | Vérifie l'espace disque sur tous les nœuds |
| **cert-check** | Chaque jour, 10h | Vérifie l'expiration des certificats TLS |
| **pbs-backup** | Lundi, 00h08 | Orchestre le backup complet (voir l'article dédié) |

### Health check : le cœur du système

Le health check est le plus simple et le plus critique. Toutes les 6 heures, l'agent :

1. Contacte chaque service via HTTP/HTTPS
2. Vérifie le code de retour (200, 301, etc.)
3. Mesure le temps de réponse
4. Compare avec l'état précédent (nouveau down ? nouveau up ?)
5. Envoie un résumé sur Telegram

```
🟢 33/33 services UP
⏱ Temps moyen : 45ms
📊 Uptime 24h : 100%
```

Quand un service tombe :

```
🔴 ALERTE : technitium2 DOWN (timeout 5s)
Dernière réponse : il y a 6h
Action suggérée : vérifier CT 101 sur pve2
```

L'agent ne se contente pas de dire "c'est down" — il suggère une action basée sur le contexte (quel CT, quel nœud, quel service).

### Security audit : lire les logs à la place de Stéphane

Chaque matin à 8h, l'agent analyse les logs d'authentification des dernières 24 heures :
- Tentatives SSH échouées
- Connexions depuis des IPs inhabituelles
- Patterns de brute-force
- Alertes CrowdSec

Il produit un rapport synthétique : soit "RAS" (rien à signaler), soit une liste d'événements à vérifier avec un niveau de criticité.

### Cert check : anticiper les expirations

Chaque certificat TLS de l'infra a une durée de 90 jours (step-ca). Le cert-check contacte chaque service en HTTPS, lit le certificat, et alerte si un certificat expire dans **moins de 14 jours**.

```bash
# Ce que l'agent exécute (simplifié)
echo | openssl s_client -connect service.pixelium.internal:443 2>/dev/null \
  | openssl x509 -noout -enddate
```

Sans cette vérification, un certificat expire silencieusement et Traefik commence à servir des erreurs TLS. Les utilisateurs voient "connexion non sécurisée" et Stéphane ne sait rien.

## Le coût : 5 centimes par jour

L'agent utilise **MiniMax M2.7** via API — un modèle compact mais suffisant pour de l'analyse de logs et du monitoring. Le coût :

| Opération | Tokens | Coût |
|---|---|---|
| Health check (×4/jour) | ~2000 tokens/run | ~$0.008 |
| Security audit | ~3000 tokens | ~$0.003 |
| Disk check | ~1000 tokens | ~$0.001 |
| Cert check | ~1500 tokens | ~$0.002 |
| **Total quotidien** | | **~$0.05** |

Cinquante centimes par mois pour un "SRE virtuel" qui travaille 24/7. Le rapport qualité/prix est absurde.

## Les surprises

### Ce que le Guardian a détecté tout seul

- Un service qui retournait 502 de façon intermittente (Linkwarden après une mise à jour ratée)
- Un disque à 87% sur pve2 (les logs Loki grossissaient sans rotation)
- Un certificat qui expirait dans 8 jours (le renouvellement automatique avait silencieusement échoué)

Trois problèmes que nous aurions probablement découverts trop tard sans l'agent.

### La limite du LLM

L'agent n'est pas infaillible. Sur les faux positifs :
- Un service qui met 3 secondes à répondre est signalé comme "lent", même si c'est normal pour ce service (Immich au premier chargement)
- Les logs d'auth Proxmox contiennent des lignes que l'agent interprète parfois comme suspectes alors qu'elles sont normales (renouvellement de token API)

La solution : un fichier de contexte que l'agent consulte avant de juger. "Immich peut être lent au premier appel", "les tokens claude@pve sont normaux".

## Ce que nous en retirons

### 1. L'IA ops, c'est du monitoring augmenté

Ça ne remplace pas Beszel ou VictoriaMetrics — ça les complète. Les dashboards collectent, l'agent analyse et décide. Les deux sont nécessaires.

### 2. Le coût marginal de l'IA est devenu négligeable

$0.05/jour pour 5 audits complets d'infrastructure. Il y a deux ans, ça aurait coûté 100× plus cher. La baisse des coûts des LLM rend ce genre d'automatisation accessible même pour un homelab.

### 3. Les faux positifs sont gérables

Avec un fichier de contexte et quelques semaines d'entraînement (ignorer les patterns normaux), le rapport signal/bruit est devenu excellent. L'agent envoie ~1 alerte par semaine en dehors des rapports de routine.

### 4. L'automatisation crée de la confiance

Depuis que Guardian tourne, Stéphane dort mieux. Pas parce que l'infra est plus fiable — mais parce qu'il sait que quelqu'un surveille.

---

*Stack : OpenFang (Rust, CT 192), Hermes (Python, CT 190), MiniMax M2.7, MQTT (Mosquitto, CT 142), alertes Telegram. Coût : ~$1.50/mois.*

---

**Mise à jour (18 avril 2026)** : Restructuration complète de l'architecture agents. **Hermes** (CT 190, NousResearch) est désormais le correspondant Telegram h24 — il a repris la veille-rss (16h) et l'audit-sécurité (11h) comme crons natifs, plus deux nouveaux : doc-sync (8h30, réconciliation Forgejo/Wiki.js/Proxmox) et site-metrics-audit (9h, détection écarts métriques du site). **OpenFang** passe en mode headless — plus de polling Telegram, il conserve les 7 crons système Guardian et l'agent infra-assistant en on-demand. Le **backup PBS passe de hebdomadaire à quotidien** (00h08 chaque nuit, rétention keep-daily=7, keep-weekly=4). Un **bus MQTT** (Mosquitto CT 142) connecte les agents : OpenFang publie les résultats Guardian, Hermes souscrit et forward sur Telegram. Le coût reste ~$1.50/mois.

**Mise à jour (17 avril 2026)** : Guardian a doublé de taille. OpenFang v0.5.9 tourne avec **3 agents** (infra-assistant, veille-rss, security-auditor) et **7 crons système**. Le http-check couvre 26 services. Bugs corrigés : guardian-certs et guardian-backup cassés 16 jours (PATH relatif), heartbeat timeout passé à 25h pour agents cron-only.
