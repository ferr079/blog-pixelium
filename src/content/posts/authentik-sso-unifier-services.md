---
title: "SSO avec Authentik : un seul login pour 30 services"
date: 2026-03-25
tags: ["securite", "authentik", "homelab", "sso"]
summary: "Installer un provider SSO self-hosted pour unifier l'authentification de tous les services. Le parcours, les intégrations, et le bug KnownProxies qui nous a rendus fous."
---

## Le symptôme

À force d'ajouter des services au homelab, j'avais accumulé une collection impressionnante de credentials :
- Un login pour Forgejo
- Un login pour Semaphore
- Un login pour Proxmox (×3 nœuds)
- Un login pour Jellyfin
- Un login pour Kavita
- Et ainsi de suite...

Certains avaient les mêmes identifiants (mauvaise pratique), d'autres non (impossible à retenir). Se connecter à un nouveau service impliquait de retrouver le bon mot de passe dans Vaultwarden, le copier, le coller.

**SSO** (Single Sign-On) résout ça : un seul compte, un seul login, accès à tout.

## Pourquoi Authentik

Le choix du provider SSO s'est posé entre :
- **Keycloak** — l'ogre Java, puissant mais lourd (1+ Go RAM minimum)
- **Authelia** — léger mais limité aux scénarios simples
- **Authentik** — équilibre entre fonctionnalités et ressources

Authentik tourne en **Docker Compose** sur CT 118 (pve1). Il consomme environ 500 Mo de RAM — raisonnable pour un SSO complet avec OIDC, SAML, LDAP, et une interface d'administration soignée.

```yaml
# docker-compose.yml (simplifié)
services:
  server:
    image: ghcr.io/goauthentik/server:latest
    ports:
      - "9000:9000"
      - "9443:9443"
  worker:
    image: ghcr.io/goauthentik/server:latest
    command: worker
  postgresql:
    image: postgres:16-alpine
  redis:
    image: redis:alpine
```

## La première intégration : Forgejo

Forgejo (notre instance Git self-hosted) supporte OAuth2 nativement. C'est le candidat idéal pour commencer — l'intégration est documentée des deux côtés.

Dans Authentik :
1. Créer un **Provider** de type OAuth2/OIDC
2. Créer une **Application** pointant vers ce provider
3. Configurer les redirect URIs

Dans Forgejo (`app.ini`) :
```ini
[oauth2]
ENABLE = true

[service]
ALLOW_ONLY_INTERNAL_REGISTRATION = false
```

Premier test : clic sur "Se connecter avec Authentik" dans Forgejo → redirection vers la page de login Authentik → authentification → retour dans Forgejo, connecté.

**Ça marche du premier coup.** Rare dans le monde du SSO.

## Semaphore et Proxmox : intégrations propres

Semaphore (notre orchestrateur Ansible) supporte aussi OIDC. Configuration similaire — provider Authentik, redirect URI, et c'est fait.

Proxmox est plus intéressant : il supporte **OpenID Connect** nativement depuis la version 7. Chaque nœud (pve1, pve2, pve3) peut être configuré pour accepter Authentik comme source d'authentification.

```bash
pveum realm add authentik --type openid \
  --issuer-url https://authentik.pixelium.internal/application/o/proxmox/ \
  --client-id proxmox \
  --client-key <secret>
```

Après ça, la page de login Proxmox affiche un bouton "Login with Authentik" à côté du login PAM classique.

## Jellyfin : le bug qui rend fou

Jellyfin a un plugin SSO qui supporte OIDC. Installation du plugin, configuration du provider Authentik, redirect URI — tout semble correct.

Premier test : clic sur "Se connecter avec SSO"... **erreur 500.**

Les logs Jellyfin montrent un problème de validation de l'issuer URL. Après investigation, le problème est **KnownProxies**.

### Le piège KnownProxies

Jellyfin est derrière Traefik (reverse proxy). Quand Authentik redirige vers Jellyfin après l'authentification, Jellyfin reçoit la requête **via Traefik**. Mais si Jellyfin ne sait pas qu'il est derrière un proxy, il construit les URLs avec l'adresse interne au lieu de l'adresse publique.

Résultat : Authentik envoie un token pour `https://jellyfin.pixelium.internal`, mais Jellyfin pense être `http://localhost:8096`. Les URLs ne matchent pas → le token est rejeté.

Le fix dans la configuration Jellyfin :

```xml
<KnownProxies>192.168.1.110</KnownProxies>
```

L'adresse de Traefik (CT 110). Ça dit à Jellyfin : "quand une requête vient de cette IP, fais confiance aux headers `X-Forwarded-*` pour construire les URLs."

**Trois heures** pour trouver cette ligne. Le message d'erreur ne mentionnait ni proxy ni forwarding — juste "invalid issuer". Claude a fini par trouver un issue GitHub Jellyfin qui décrivait exactement le même symptôme.

> Dans le monde des reverse proxies, 90% des bugs SSO sont des problèmes de X-Forwarded-For/Proto/Host. La première chose à vérifier, toujours.

## Le résultat

Aujourd'hui, je me connecte **une seule fois** à Authentik le matin, et tous les services reconnaissent la session :

- Forgejo ✅
- Semaphore ✅
- Proxmox (3 nœuds) ✅
- Jellyfin ✅ (après le fix KnownProxies)
- Kavita — en cours d'intégration

Authentik gère aussi :
- L'authentification à deux facteurs (TOTP + WebAuthn)
- Les groupes et permissions
- L'audit log de toutes les connexions
- La récupération de mot de passe

## Ce que j'en retiens

### 1. Le SSO self-hosted est viable

Authentik est mature, bien documenté, et les intégrations OIDC fonctionnent avec la plupart des services modernes. Le coût en ressources (~500 Mo RAM) est acceptable.

### 2. Reverse proxy + SSO = complexité

Le combo reverse proxy + SSO multiplie les points de friction. Chaque service a sa façon de gérer les headers X-Forwarded-*, et chaque implémentation OIDC a ses particularités. Il faut de la patience.

### 3. Commencer par le plus simple

Forgejo en premier, c'était le bon choix — intégration propre, documentation claire, résultat rapide. Ça donne confiance pour attaquer les cas plus complexes (Jellyfin, Proxmox).

### 4. Les logs sont (parfois) menteurs

"Invalid issuer" quand le vrai problème est un proxy mal déclaré. Les messages d'erreur OIDC sont notoirement cryptiques. Quand ça ne marche pas, vérifier les URLs à chaque étape de la chaîne est plus productif que lire le message d'erreur.

---

*Stack : Authentik (Docker Compose, CT 118), intégrations OAuth2/OIDC, Traefik reverse proxy. Services connectés : Forgejo, Semaphore, Proxmox ×3, Jellyfin.*
