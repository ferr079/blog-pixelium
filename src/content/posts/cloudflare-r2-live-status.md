---
title: "De zero a dashboard live : quand mon site parle a mon homelab"
date: 2026-04-01
tags: ["cloudflare", "automatisation", "homelab", "web"]
summary: "Connecter un site statique Astro a une infrastructure homelab live — via Cloudflare R2, KV, Workers et un script qui pousse 14 metriques toutes les heures."
---

## Le probleme du site statique

Mon portfolio (pixelium.win) est un site Astro deploye sur Cloudflare Workers. Statique, rapide, fiable. Mais **fige** : les stats affichees ("30+ conteneurs", "20+ services") etaient des nombres codes en dur dans le HTML.

Le probleme : ces nombres changent. J'ajoute des services, je decommissionne d'autres, les metriques CTF evoluent. Chaque mise a jour demandait un commit + deploy. Pour un site qui pretend montrer une infra vivante, c'est ironique.

Je voulais que le site **affiche des donnees live** sans devenir une SPA avec un backend.

## L'architecture

```
Homelab (CT 192)                 Cloudflare
┌──────────────┐    push KV     ┌──────────────┐
│ kv-push.sh   │ ──────────────▶│ KV namespace  │
│ (cron 1h)    │                │ pixelium-stats│
└──────────────┘                └──────┬───────┘
                                       │ read
                                ┌──────▼───────┐
                                │ Workers       │
                                │ /api/stats    │
                                │ /api/status   │
                                └──────┬───────┘
                                       │ fetch
                                ┌──────▼───────┐
                                │ pixelium.win  │
                                │ LiveStats     │
                                └──────────────┘
```

Trois briques Cloudflare :
- **R2** : stockage objet pour les images (CDN `assets.pixelium.win`)
- **KV** : key-value store pour les metriques live
- **Workers** : endpoints API qui lisent le KV et renvoient du JSON

## Cloudflare R2 : le CDN gratuit

Premiere etape : sortir les images du repo git. 16 screenshots WebP + 5 videos WebM, ca alourdit le build et le deploy.

R2 est le stockage objet de Cloudflare — compatible S3, 10 Go gratuits, zero egress fees.

```bash
# Sync des images vers R2
aws s3 sync public/images/ s3://pixelium-assets/images/ \
  --endpoint-url "$R2_ENDPOINT" --region auto
```

Un custom domain `assets.pixelium.win` pointe vers le bucket R2. Les images sont servies directement depuis le CDN Cloudflare — plus rapide, plus leger, et le repo git reste propre.

## KV : le store de metriques

Cloudflare KV est un key-value store distribue. Latence de lecture : ~10ms depuis n'importe ou dans le monde. Parfait pour stocker des metriques qui changent toutes les heures.

J'ai cree deux namespaces :
- `pixelium-stats` : metriques du portfolio (commits, services, uptime...)
- `pixelium-status` : etat des services (UP/DOWN, CPU, RAM)

### Le script kv-push.sh

Sur CT 192 (OpenFang), un script cron tourne **toutes les heures** :

```bash
#!/bin/bash
# Collecter les metriques
SERVICES_UP=$(curl -s https://pixelium.win/api/status | jq '.summary.up')
LXC_COUNT=$(ssh root@192.168.1.251 "pct list" | tail -n +2 | wc -l)
# ... 14 metriques au total

# Pousser vers Cloudflare KV
curl -s -X PUT \
  "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT/storage/kv/namespaces/$KV_ID/values/stats" \
  -H "Authorization: Bearer $CF_TOKEN" \
  -d "{\"services_up\": $SERVICES_UP, \"lxc_count\": $LXC_COUNT, ...}"
```

14 metriques collectees et poussees :

| Metrique | Source | Exemple |
|---|---|---|
| services_up | Health check OpenFang | 33 |
| lxc_count | API Proxmox | 36 |
| uptime_pct | Calcul sur 30j | 97.2% |
| commits_30d | API Forgejo | 365 |
| htb_flags | API HTB | 61 |
| rootme_score | API Root-Me | 765 |
| pve_nodes | API Proxmox | 3 |
| ansible_playbooks | Semaphore DB | 14 |
| ... | ... | ... |

## Les endpoints API

Astro en mode hybride (avec l'adaptateur Cloudflare) permet de creer des **endpoints dynamiques** a cote des pages statiques.

```typescript
// src/pages/api/stats.ts
import { env } from 'cloudflare:workers';

export async function GET() {
  const data = await env.STATS_KV.get('stats', { type: 'json' });
  return Response.json(data);
}
```

Le binding KV est declare dans `wrangler.toml` :

```toml
[[kv_namespaces]]
binding = "STATS_KV"
id = "abc123..."
```

**`/api/stats`** renvoie les metriques live. **`/api/status`** renvoie l'etat des services. Deux endpoints, zero backend, zero base de donnees — juste du KV.

## Le composant LiveStats

Cote frontend, un composant Astro fetche `/api/stats` au chargement et anime les compteurs :

```astro
<div class="live-stats">
  <div class="stat-brick" data-stat="services_up" data-suffix="">
    <span class="stat-value">--</span>
    <span class="stat-label">Services UP</span>
    <span class="live-dot"></span>
  </div>
  <!-- ... 8 briques au total -->
</div>
```

Le petit point vert pulse a cote de chaque brique — c'est le signal que les donnees sont live, pas statiques. Un detail, mais il change la perception.

## La page /status

J'ai pousse le concept plus loin avec une page dediee qui affiche :
- L'etat de **chaque service** (33 services, UP/DOWN)
- Les **3 noeuds Proxmox** avec CPU et RAM
- L'**uptime sur 30 jours** (historique D1)

C'est un dashboard public de mon homelab — tout visiteur peut voir ce qui tourne et ce qui ne tourne pas.

## La revelation des chiffres reels

Le moment le plus interessant de ce projet n'a pas ete technique. C'est quand j'ai compare les stats hardcodees du site avec les chiffres reels :

| Stat | Hardcode | Reel |
|---|---|---|
| "25+ services" | 25 | **33** |
| "30+ LXC containers" | 30 | **36** |
| Commits (30j) | non affiche | **365** |

Mon site **sous-estimait** l'infra. Les chiffres reels etaient plus impressionnants que ce que j'avais mis. Ca montre l'importance des donnees live — la realite depasse souvent ce qu'on pense savoir.

## Ce que j'ai appris

### 1. Cloudflare gratuit est suffisant

R2 (10 Go), KV (100k reads/jour), Workers (100k requetes/jour) — tout dans le free tier. Pour un portfolio/blog, c'est largement suffisant.

### 2. Le pattern push est plus simple que le pull

Au lieu que le site interroge le homelab (complexe, securite, latence), le homelab pousse ses metriques vers Cloudflare (simple, unidirectionnel, fire-and-forget). Le site lit du KV — c'est instantane.

### 3. Les donnees live changent la perception

Un site avec des nombres statiques, c'est une brochure. Un site avec des donnees live, c'est une vitrine sur une infra reelle. La difference de credibilite est enorme.

### 4. Le cout est derisoire

Le script tourne sur un CT qui existe deja. L'API Cloudflare est gratuite. Le KV est gratuit. Le seul "cout" c'est la maintenance du script — et il a 50 lignes.

---

*Stack : Cloudflare R2 + KV + Workers, Astro mode hybride, kv-push.sh (cron 1h, CT 192). Cout additionnel : 0€.*
