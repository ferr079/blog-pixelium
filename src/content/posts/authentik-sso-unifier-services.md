---
title: "SSO avec Authentik : un seul login pour 30 services"
date: 2026-03-25
tags: ["securite", "authentik", "homelab", "sso"]
summary: "Installer un provider SSO self-hosted pour unifier l'authentification de tous mes services. Le parcours, les integrations, et le bug KnownProxies qui m'a rendu fou."
---

## Le symptome

A force d'ajouter des services a mon homelab, j'avais accumule une collection impressionnante de credentials :
- Un login pour Forgejo
- Un login pour Semaphore
- Un login pour Proxmox (x3 noeuds)
- Un login pour Jellyfin
- Un login pour Kavita
- Et ainsi de suite...

Certains avaient les memes identifiants (mauvaise pratique), d'autres non (impossible a retenir). Se connecter a un nouveau service impliquait de retrouver le bon mot de passe dans Vaultwarden, le copier, le coller.

**SSO** (Single Sign-On) resout ca : un seul compte, un seul login, acces a tout.

## Pourquoi Authentik

Le choix du provider SSO s'est pose entre :
- **Keycloak** — l'ogre Java, puissant mais lourd (1+ Go RAM minimum)
- **Authelia** — leger mais limite aux scenarios simples
- **Authentik** — equilibre entre fonctionnalites et ressources

Authentik tourne en **Docker Compose** sur CT 118 (pve1). Il consomme environ 500 Mo de RAM — raisonnable pour un SSO complet avec OIDC, SAML, LDAP, et une interface d'administration soignee.

```yaml
# docker-compose.yml (simplifie)
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

## La premiere integration : Forgejo

Forgejo (mon instance Git self-hosted) supporte OAuth2 nativement. C'est le candidat ideal pour commencer — l'integration est documentee des deux cotes.

Dans Authentik :
1. Creer un **Provider** de type OAuth2/OIDC
2. Creer une **Application** pointant vers ce provider
3. Configurer les redirect URIs

Dans Forgejo (`app.ini`) :
```ini
[oauth2]
ENABLE = true

[service]
ALLOW_ONLY_INTERNAL_REGISTRATION = false
```

Premier test : clic sur "Se connecter avec Authentik" dans Forgejo → redirection vers la page de login Authentik → authentification → retour dans Forgejo, connecte.

**Ca marche du premier coup.** Rare dans le monde du SSO.

## Semaphore et Proxmox : integrations propres

Semaphore (mon orchestrateur Ansible) supporte aussi OIDC. Configuration similaire — provider Authentik, redirect URI, et c'est fait.

Proxmox est plus interessant : il supporte **OpenID Connect** nativement depuis la version 7. Chaque noeud (pve1, pve2, pve3) peut etre configure pour accepter Authentik comme source d'authentification.

```bash
pveum realm add authentik --type openid \
  --issuer-url https://authentik.pixelium.internal/application/o/proxmox/ \
  --client-id proxmox \
  --client-key <secret>
```

Apres ca, la page de login Proxmox affiche un bouton "Login with Authentik" a cote du login PAM classique.

## Jellyfin : le bug qui rend fou

Jellyfin a un plugin SSO qui supporte OIDC. Installation du plugin, configuration du provider Authentik, redirect URI — tout semble correct.

Premier test : clic sur "Se connecter avec SSO"... **erreur 500.**

Les logs Jellyfin montrent un probleme de validation de l'issuer URL. Apres investigation, le probleme est **KnownProxies**.

### Le piege KnownProxies

Jellyfin est derriere Traefik (reverse proxy). Quand Authentik redirige vers Jellyfin apres l'authentification, Jellyfin recoit la requete **via Traefik**. Mais si Jellyfin ne sait pas qu'il est derriere un proxy, il construit les URLs avec l'adresse interne au lieu de l'adresse publique.

Resultat : Authentik envoie un token pour `https://jellyfin.pixelium.internal`, mais Jellyfin pense etre `http://localhost:8096`. Les URLs ne matchent pas → le token est rejete.

Le fix dans la configuration Jellyfin :

```xml
<KnownProxies>192.168.1.110</KnownProxies>
```

L'adresse de Traefik (CT 110). Ca dit a Jellyfin : "quand une requete vient de cette IP, fais confiance aux headers `X-Forwarded-*` pour construire les URLs."

**Trois heures** a trouver cette ligne. Le message d'erreur ne mentionnait ni proxy ni forwarding — juste "invalid issuer".

> Dans le monde des reverse proxies, 90% des bugs SSO sont des problemes de X-Forwarded-For/Proto/Host. La premiere chose a verifier, toujours.

## Le resultat

Aujourd'hui, je me connecte **une seule fois** a Authentik le matin, et tous les services reconnaissent ma session :

- Forgejo ✅
- Semaphore ✅
- Proxmox (3 noeuds) ✅
- Jellyfin ✅ (apres le fix KnownProxies)
- Kavita — en cours d'integration

Authentik gere aussi :
- L'authentification a deux facteurs (TOTP + WebAuthn)
- Les groupes et permissions
- L'audit log de toutes les connexions
- La recuperation de mot de passe

## Ce que j'ai appris

### 1. Le SSO self-hosted est viable

Authentik est mature, bien documente, et les integrations OIDC fonctionnent avec la plupart des services modernes. Le cout en ressources (~500 Mo RAM) est acceptable.

### 2. Reverse proxy + SSO = complexite

Le combo reverse proxy + SSO multiplie les points de friction. Chaque service a sa facon de gerer les headers X-Forwarded-*, et chaque implementation OIDC a ses particularites. Il faut de la patience.

### 3. Commencer par le plus simple

Forgejo en premier, c'etait le bon choix — integration propre, documentation claire, resultat rapide. Ca donne confiance pour attaquer les cas plus complexes (Jellyfin, Proxmox).

### 4. Les logs sont (parfois) menteurs

"Invalid issuer" quand le vrai probleme est un proxy mal declare. Les messages d'erreur OIDC sont notoirement cryptiques. Quand ca ne marche pas, verifier les URLs a chaque etape de la chaine est plus productif que lire le message d'erreur.

---

*Stack : Authentik (Docker Compose, CT 118), integrations OAuth2/OIDC, Traefik reverse proxy. Services connectes : Forgejo, Semaphore, Proxmox x3, Jellyfin.*
