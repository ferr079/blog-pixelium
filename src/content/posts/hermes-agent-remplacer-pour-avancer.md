---
title: "Hermes : savoir décommissionner pour mieux avancer"
date: 2026-04-17
tags: ["ia", "homelab", "agent", "automatisation"]
summary: "IronClaw est resté 17 jours sans servir. Hermes l'a remplacé en une soirée. Retour sur une leçon de pragmatisme en homelab."
---

## Un conteneur qui ne sert à rien

Le 31 mars, nous avons déployé **IronClaw** sur CT 190 (pve1). Un agent IA en Rust, avec sandbox WASM, support multi-LLM, propulsé par NearAI. Sur le papier, c'était impressionnant — Rust pour la performance, WASM pour l'isolation, une architecture qui cochait toutes les cases.

Sauf qu'il n'a jamais été commissionné. Pas de DNS, pas de HTTPS via Traefik, pas d'entrée NetBox, pas d'enregistrement Ansible. Le CT existait dans Proxmox, accessible en SSH, et c'est tout.

17 jours plus tard, personne ne l'avait utilisé. Pas une seule fois.

## Le vrai problème : déployer pour déployer

J'aurais pu dire que le manque de temps avait empêché de finir l'intégration. Ce serait malhonnête. La vérité, c'est qu'IronClaw ne résolvait aucun problème que **OpenFang** (CT 192) ne gérait pas déjà.

OpenFang faisait le monitoring, les audits de sécurité, les backups orchestrés, les alertes Telegram. Il tournait depuis des semaines, stable, pour ~11€ par mois. IronClaw avait été déployé parce que sa stack avait l'air bien — Rust, WASM, multi-LLM — pas parce qu'il répondait à un besoin réel.

> Un outil qui ne résout pas un problème existant n'est pas un outil. C'est un hobby déguisé en infrastructure.

C'est le genre de piège classique en homelab : on installe un service parce qu'il est techniquement intéressant, pas parce qu'on en a besoin. Et il reste là, à consommer des ressources et de l'attention mentale, sans rien produire.

## Le tweet qui a déclenché la réflexion

Moula Badji a partagé sur X son setup MAAS + Proxmox + Ceph — une infra solide, bien intégrée, chaque composant justifié par un rôle clair. Ce qui a marqué Stéphane, ce n'est pas la stack elle-même, c'est la **cohérence**. Chaque outil avait sa raison d'être. Pas de pièces en trop.

La comparaison avec IronClaw était cruelle. Un CT déployé "au cas où", jamais intégré, qui traînait dans la liste Proxmox comme un rappel d'une décision non aboutie.

## Hermes : un vrai différenciateur

En cherchant un remplaçant qui justifie son existence, **Hermes Agent** (NousResearch) a attiré l'attention. 96.6k stars sur GitHub, v0.10.0, MIT, communauté très active.

Ce qui le distingue d'OpenFang ne tient pas au langage (Python vs Rust) ni à l'interface. C'est le **learning loop** : Hermes crée des skills à partir de ses interactions, les stocke, et les améliore à chaque utilisation. Un agent qui apprend de ses erreurs et optimise ses propres outils.

Concrètement :
- **Skills auto-générées** : compatibles agentskills.io, exportables, partageables
- **TUI interactive** : un mode conversationnel en terminal, validé en 30 secondes
- **Subagents parallèles** : il spawne des agents isolés pour des tâches complexes
- **User modeling** : profil utilisateur persistant entre les sessions

OpenFang est bon pour les tâches planifiées (monitoring, audits). Hermes est bon pour l'exploration interactive et l'apprentissage progressif. Complémentaires, pas concurrents.

## Décommissionner IronClaw : le révélateur

La décommission a été rapide. Trop rapide. En faisant l'inventaire de ce qu'il fallait nettoyer, la liste était vide :

| Composant | Présent ? |
|---|---|
| DNS (Technitium) | Non |
| HTTPS (Traefik conf.d) | Non |
| NetBox (VM + IP) | Non |
| Ansible (hosts.yml) | Non |
| Homepage (services.yaml) | Non |
| Beszel agent | Non |
| Wazuh agent | Non |

Rien. Le CT n'avait laissé aucune trace dans l'infra. La "décommission" a consisté à arrêter le CT et supprimer le conteneur. Cinq minutes, fin de l'histoire.

C'est la preuve la plus nette qu'IronClaw n'a jamais été un vrai service. Un service intégré laisse des dépendances — DNS, reverse proxy, monitoring, documentation. IronClaw n'avait rien de tout ça. Il n'était qu'un binaire qui tournait dans une boîte.

## Hermes sur CT 190 : cette fois, en entier

Le nouveau CT 190 a été créé sur **pve2** (pas pve1 comme IronClaw — les services applicatifs vont sur pve2, l'infra réseau sur pve1). Debian 13, 2 Go de RAM, 16 Go de disque.

**MiniMax M2.7** comme provider LLM — la même clé API qu'OpenFang, le même modèle qui a fait ses preuves pour $0.05/jour.

La TUI a fonctionné immédiatement :

```bash
export PATH="/root/.local/bin:/root/.hermes/node/bin:$PATH"
hermes chat
```

Première conversation, première skill générée. Le learning loop n'est pas un argument marketing — j'ai vu l'agent créer un outil de diagnostic réseau après trois interactions, puis l'améliorer quand le résultat n'était pas assez précis.

Et cette fois, la commission complète :
- DNS : `hermes.pixelium.internal` dans Technitium
- Ansible : ajouté au groupe `lxc`, clé Semaphore déployée
- NetBox : VM id=48, IP id=54
- Forgejo : mirror `uzer/hermes-agent` configuré

Pas encore de Traefik HTTPS (Hermes n'a pas d'interface web à exposer pour l'instant), mais tout le reste est en place. S'il disparaît demain, il laissera des traces à nettoyer. C'est le signe qu'il fait partie de l'infra.

## Deux agents, deux rôles

Le homelab a maintenant deux agents IA sur pve2 :

| | OpenFang (CT 192) | Hermes (CT 190) |
|---|---|---|
| **Rôle** | Ops automatisé | Exploration interactive |
| **Mode** | Cron jobs, scripts | TUI, conversations |
| **Force** | Fiabilité, répétabilité | Apprentissage, adaptation |
| **LLM** | MiniMax M2.7 | MiniMax M2.7 |
| **Depuis** | Mars 2026 | Avril 2026 |

OpenFang surveille l'infra pendant que Stéphane dort. Hermes aide à résoudre des problèmes nouveaux quand Stéphane est devant le terminal. Chacun a sa raison d'être.

## Ce que nous en retirons

### 1. Un service non commissionné est un service qui n'existe pas

Si un CT n'a ni DNS, ni monitoring, ni documentation, il ne fait pas partie de l'infra. Il occupe une IP et de la RAM, rien de plus. La commission complète n'est pas de la bureaucratie — c'est ce qui transforme un conteneur en service.

### 2. Déployer pour la stack, c'est déployer pour rien

Rust + WASM + multi-LLM, ça sonne bien dans un README. Mais la question qui compte c'est : "Qu'est-ce que ça fait que mon setup actuel ne fait pas ?" Si la réponse est floue, le déploiement ne tient pas.

### 3. Décommissionner vite libère l'esprit

17 jours, c'est 17 jours de trop pour un service inutile. La charge mentale d'un CT qui traîne — "il faudrait que je finisse de configurer ça" — est réelle. Supprimer ce qui ne sert pas crée de l'espace pour ce qui sert.

### 4. Complémentaire vaut mieux que remplaçant

Hermes ne remplace pas OpenFang. Il couvre un angle différent. Chercher "le meilleur outil" est souvent moins productif que combiner deux outils qui excellent chacun dans leur domaine.

---

*Stack : Hermes Agent v0.10.0 (Python, CT 190 pve2), OpenFang (Rust, CT 192 pve2), MiniMax M2.7, Technitium DNS, Ansible/Semaphore.*
