---
title: "De zéro à dashboard live : quand mon site parle à mon homelab"
date: 2026-04-01
tags: ["cloudflare", "automatisation", "homelab", "web"]
summary: "Connecter un site statique Astro à une infrastructure homelab live — via Cloudflare R2, KV, Workers et un script qui pousse 14 métriques toutes les heures."
---

## Le problème du site statique

Le portfolio (pixelium.win) est un site Astro déployé sur Cloudflare Workers. Statique, rapide, fiable. Mais **figé** : les stats affichées ("30+ conteneurs", "20+ services") étaient des nombres codés en dur dans le HTML.

Le problème : ces nombres changent. On ajoute des services, on en décommissionne d'autres, les métriques CTF évoluent. Chaque mise à jour demandait un commit + deploy. Pour un site qui prétend montrer une infra vivante, c'est ironique.

On voulait que le site **affiche des données live** sans devenir une SPA avec un backend.

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
- **KV** : key-value store pour les métriques live
- **Workers** : endpoints API qui lisent le KV et renvoient du JSON

## Cloudflare R2 : le CDN gratuit

Première étape : sortir les images du repo git. 16 screenshots WebP + 5 vidéos WebM, ça alourdit le build et le deploy.

R2 est le stockage objet de Cloudflare — compatible S3, 10 Go gratuits, zéro egress fees.

```bash
# Sync des images vers R2
aws s3 sync public/images/ s3://pixelium-assets/images/ \
  --endpoint-url "$R2_ENDPOINT" --region auto
```

Un custom domain `assets.pixelium.win` pointe vers le bucket R2. Les images sont servies directement depuis le CDN Cloudflare — plus rapide, plus léger, et le repo git reste propre.

## KV : le store de métriques

Cloudflare KV est un key-value store distribué. Latence de lecture : ~10ms depuis n'importe où dans le monde. Parfait pour stocker des métriques qui changent toutes les heures.

On a créé deux namespaces :
- `pixelium-stats` : métriques du portfolio (commits, services, uptime...)
- `pixelium-status` : état des services (UP/DOWN, CPU, RAM)

### Le script kv-push.sh

Sur CT 192 (OpenFang), un script cron tourne **toutes les heures** :

```bash
#!/bin/bash
# Collecter les métriques
SERVICES_UP=$(curl -s https://pixelium.win/api/status | jq '.summary.up')
LXC_COUNT=$(ssh root@192.168.1.251 "pct list" | tail -n +2 | wc -l)
# ... 14 métriques au total

# Pousser vers Cloudflare KV
curl -s -X PUT \
  "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT/storage/kv/namespaces/$KV_ID/values/stats" \
  -H "Authorization: Bearer $CF_TOKEN" \
  -d "{\"services_up\": $SERVICES_UP, \"lxc_count\": $LXC_COUNT, ...}"
```

14 métriques collectées et poussées :

| Métrique | Source | Exemple |
|---|---|---|
| services_up | Health check OpenFang | 33 |
| lxc_count | API Proxmox | 36 |
| uptime_pct | Calcul sur 30j | 97.2% |
| commits_30d | API Forgejo | 365 |
| htb_flags | API HTB | 61 |
| rootme_score | API Root-Me | 765 |
| pve_nodes | API Proxmox | 3 |
| ansible_playbooks | Semaphore DB | 14 |

## Les endpoints API

Astro en mode hybride (avec l'adaptateur Cloudflare) permet de créer des **endpoints dynamiques** à côté des pages statiques.

```typescript
// src/pages/api/stats.ts
import { env } from 'cloudflare:workers';

export async function GET() {
  const data = await env.STATS_KV.get('stats', { type: 'json' });
  return Response.json(data);
}
```

Le binding KV est déclaré dans `wrangler.toml` :

```toml
[[kv_namespaces]]
binding = "STATS_KV"
id = "abc123..."
```

**`/api/stats`** renvoie les métriques live. **`/api/status`** renvoie l'état des services. Deux endpoints, zéro backend, zéro base de données — juste du KV.

## Le composant LiveStats

Côté frontend, un composant Astro fetche `/api/stats` au chargement et anime les compteurs :

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

Le petit point vert pulse à côté de chaque brique — c'est le signal que les données sont live, pas statiques. Un détail, mais il change la perception.

## La page /status

On a poussé le concept plus loin avec une page dédiée qui affiche :
- L'état de **chaque service** (33 services, UP/DOWN)
- Les **3 nœuds Proxmox** avec CPU et RAM
- L'**uptime sur 30 jours** (historique D1)

C'est un dashboard public du homelab — tout visiteur peut voir ce qui tourne et ce qui ne tourne pas.

## La révélation des chiffres réels

Le moment le plus intéressant de ce projet n'a pas été technique. C'est quand on a comparé les stats hardcodées du site avec les chiffres réels :

| Stat | Hardcodé | Réel |
|---|---|---|
| "25+ services" | 25 | **33** |
| "30+ LXC containers" | 30 | **36** |
| Commits (30j) | non affiché | **365** |

Le site **sous-estimait** l'infra. Les chiffres réels étaient plus impressionnants que ce qu'on avait mis. Ça montre l'importance des données live — la réalité dépasse souvent ce qu'on pense savoir.

## Ce que j'en retiens

### 1. Cloudflare gratuit est suffisant

R2 (10 Go), KV (100k reads/jour), Workers (100k requêtes/jour) — tout dans le free tier. Pour un portfolio/blog, c'est largement suffisant.

### 2. Le pattern push est plus simple que le pull

Au lieu que le site interroge le homelab (complexe, sécurité, latence), le homelab pousse ses métriques vers Cloudflare (simple, unidirectionnel, fire-and-forget). Le site lit du KV — c'est instantané.

### 3. Les données live changent la perception

Un site avec des nombres statiques, c'est une brochure. Un site avec des données live, c'est une vitrine sur une infra réelle. La différence de crédibilité est énorme.

### 4. Le coût est dérisoire

Le script tourne sur un CT qui existe déjà. L'API Cloudflare est gratuite. Le KV est gratuit. Le seul "coût" c'est la maintenance du script — et il a 50 lignes.

---

*Stack : Cloudflare R2 + KV + Workers, Astro mode hybride, kv-push.sh (cron 1h, CT 192). Coût additionnel : 0€.*
