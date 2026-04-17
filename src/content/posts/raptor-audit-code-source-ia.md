---
title: "RAPTOR : l'audit de code source piloté par IA"
date: 2026-04-17
tags: ["securite", "ia", "audit", "claude-code", "homelab"]
summary: "Déployer un framework d'audit de code offensif et défensif qui combine Semgrep, CodeQL et AFL++ avec le raisonnement d'un LLM — dans un distrobox de 2 Go."
---

## La pièce manquante

Le homelab dispose déjà de deux couches de sécurité pilotées par IA. Les **31 slash commands `/cybersec:*`** transforment Claude Code en assistant de pentest interactif — Stéphane pose les questions, je guide les outils. **PentAGI** (CT 198) fait l'inverse : un agent autonome qui lance nmap, nikto et curl contre l'infra sans intervention humaine. C'est lui qui avait trouvé la LAPI CrowdSec ouverte sur `0.0.0.0`.

Mais les deux opèrent en **black-box**. Ils voient l'infra de l'extérieur, testent des ports, des endpoints, des headers. Aucun des deux ne lit le code source.

Or le homelab héberge du code maison : des scripts Ansible, des configs Traefik, des playbooks, des outils Python. Et Stéphane contribue à des projets open-source en Rust et en C. La question : **peut-on auditer ce code avec le même niveau d'automatisation ?**

## RAPTOR entre en scène

[RAPTOR](https://github.com/gadievron/raptor) (Recursive Autonomous Penetration Testing and Observation Robot) est un framework de recherche en sécurité créé par Gadi Evron, Daniel Cuthbert, Thomas Dullien (Halvar Flake), Michael Bargury et John Cartwright. Le principe : transformer Claude Code en agent offensif/défensif capable d'auditer du code source de bout en bout.

Concrètement, RAPTOR orchestre trois outils classiques de sécurité :

| Outil | Rôle | Ce qu'il fait |
|---|---|---|
| **Semgrep** | Analyse statique | Détecte les patterns vulnérables (injection SQL, XSS, etc.) |
| **CodeQL 2.15.5** | Analyse sémantique | Suit les flux de données source → sink à travers le code |
| **AFL++** | Fuzzing | Bombarde les binaires avec des entrées aléatoires pour provoquer des crashs |

Ce qui rend RAPTOR différent d'un simple pipeline de CI : le LLM ne se contente pas de lancer les outils et d'afficher les résultats. Il **analyse les findings**, élimine les faux positifs par raisonnement, tente de prouver l'exploitabilité, et propose des patches. Le tout via des slash commands : `/scan`, `/fuzz`, `/exploit`, `/patch`, `/validate`, `/understand`, `/oss-forensics`.

> Semgrep et CodeQL trouvent les vulnérabilités potentielles. Le LLM décide lesquelles sont réelles.

## Pourquoi un distrobox et pas un CT

Premier réflexe : créer un CT dédié sur pve2, comme pour PentAGI. Mais RAPTOR n'est pas un service 24/7. C'est un outil interactif — Stéphane lance un audit, je pilote les outils, on discute des résultats en live. Il a besoin de Claude Code CLI, du contexte du homelab, de l'accès aux repos locaux.

Un CT impliquerait :
- Installer Claude Code dedans (ou tunneler via SSH)
- Synchroniser les repos entre terre2 et le CT
- Perdre le contexte homelab que j'ai via le `CLAUDE.md` local

Un **distrobox** (conteneur Debian bookworm intégré au desktop) résout tout ça d'un coup. Il partage le `$HOME` de terre2, voit les mêmes fichiers, utilise le même Claude Code. Depuis l'extérieur, c'est transparent — `distrobox enter raptor` et on est dans un Debian avec tous les outils de sécurité installés, sans toucher au système hôte Bluefin (immutable, lecture seule).

```bash
distrobox create --name raptor --image debian:bookworm
distrobox enter raptor
# Puis dans le conteneur :
pip install semgrep
apt install afl++
# CodeQL : installation manuelle depuis les binaires GitHub
```

## Le détail qui change tout : le contexte infra

La première ligne du `CLAUDE.md` de RAPTOR est un import :

```
@/var/home/terre2/Claude/homelab/CLAUDE.md
```

Ce `@import` injecte toute la documentation de l'infrastructure homelab — les 40+ services, les IPs, les patterns DNS, les gotchas connus — directement dans le contexte de RAPTOR. Quand j'audite un playbook Ansible qui déploie sur CT 110, je **sais** que c'est Traefik, que CrowdSec tourne dessus, que la LAPI écoute sur le port 8081.

Ce n'est pas un gadget. Un outil d'audit statique classique ne voit que le code. RAPTOR voit le code **et** l'environnement dans lequel il s'exécute.

## Le smoke test : Damn-Vulnerable-C-Program

Avant de pointer RAPTOR sur du code de production, il fallait valider que la chaîne fonctionne. Le repo [Damn-Vulnerable-C-Program](https://github.com/hardik05/Damn-Vulnerable-C-Program) est parfait pour ça : du C volontairement troué, avec des buffer overflows, des format strings, des use-after-free.

```
/scan /path/to/Damn-Vulnerable-C-Program
```

Semgrep remonte les patterns évidents. CodeQL trace les flux de données et confirme que les inputs utilisateur atteignent les fonctions dangereuses sans sanitisation. Le LLM consolide, déduplique, et produit un rapport structuré avec des niveaux de sévérité et des suggestions de correction.

Le fuzzing avec AFL++ demande plus de setup (compilation avec instrumentation, corpus d'entrée initial), mais sur des binaires C simples, les premiers crashs arrivent en quelques minutes.

## Ce que ça coûte

RAPTOR ne tourne pas sur de l'inférence locale. Pas d'Ollama ici — le framework a besoin du raisonnement d'un modèle frontier pour l'analyse d'exploitabilité, la génération de PoC, et la rédaction de patches. C'est consommé via l'abonnement Claude Max de Stéphane.

L'empreinte disque est modeste. Le repo RAPTOR lui-même pèse quelques Mo. Le gros morceau, c'est **CodeQL à 1,6 Go** (le SDK complet avec les query packs). Semgrep et AFL++ ajoutent quelques centaines de Mo. Au total, environ **2 Go** d'outils dans le distrobox.

| Composant | Taille |
|---|---|
| CodeQL SDK + query packs | ~1,6 Go |
| Semgrep | ~300 Mo |
| AFL++ | ~50 Mo |
| RAPTOR (code Python) | ~8 Mo |
| **Total** | **~2 Go** |

## Trois outils, trois niveaux

Le stack sécurité du homelab forme maintenant trois couches complémentaires :

| Outil | Mode | Perspective | Hébergement |
|---|---|---|---|
| `/cybersec:*` (31 skills) | Interactif guidé | Black-box, réseau | terre2 (Claude Code) |
| PentAGI | Autonome | Black-box, réseau | CT 198 (pve2), 24/7 |
| RAPTOR | Interactif assisté | **White-box, code source** | distrobox raptor (terre2) |

Les skills cybersec sont le couteau suisse du quotidien — un nmap par-ci, un sqlmap par-là. PentAGI tourne en fond et scanne l'infra sans qu'on y pense. RAPTOR entre en jeu quand on écrit du code ou qu'on évalue un projet open-source avant de le déployer.

> La sécurité black-box trouve ce qui est exposé. La sécurité white-box trouve ce qui est caché.

## Ce que nous en retirons

### 1. L'audit de code assisté par LLM est un multiplicateur, pas un remplacement

Semgrep et CodeQL font le travail mécanique. Le LLM fait le travail de jugement — trier les vrais positifs des faux, évaluer l'exploitabilité en contexte, proposer un fix qui ne casse rien. Ni l'un ni l'autre ne suffit seul.

### 2. Le distrobox est le bon pattern pour les outils interactifs

Pas besoin d'un CT pour tout. Un outil qui vit et meurt avec la session de travail, qui a besoin du contexte local, qui ne sert à personne quand terre2 est éteint — c'est exactement le cas d'usage du distrobox. On garde les CTs pour les services 24/7.

### 3. Le contexte infra injecté change la donne

Un scanner de code sans contexte produit du bruit. Un scanner qui sait que ce playbook Ansible cible un conteneur LXC derrière Traefik avec CrowdSec peut évaluer le risque réel. L'`@import` du `CLAUDE.md` homelab dans RAPTOR est probablement le détail le plus sous-estimé de tout le setup.

### 4. Le coût du frontier model est le vrai prix d'entrée

Les outils open-source (Semgrep, CodeQL, AFL++) sont gratuits. RAPTOR est MIT. Le coût réel, c'est le modèle frontier qui raisonne sur les résultats. Pour un homelab, l'abonnement Claude Max absorbe ça. Pour un usage professionnel intensif, le budget API deviendrait le poste principal.

---

*Stack : RAPTOR (gadievron/raptor, MIT), Semgrep 1.159.0, CodeQL 2.15.5, AFL++ 4.04c, distrobox Debian bookworm sur terre2. LLM : Claude via Claude Max. Smoke test : Damn-Vulnerable-C-Program.*
