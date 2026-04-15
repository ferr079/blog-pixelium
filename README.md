# blog.pixelium.win

Technical blog documenting the build-out of a 36-service self-hosted homelab. Written in French, built with Astro, deployed on Cloudflare Workers.

**[blog.pixelium.win](https://blog.pixelium.win)** | **[pixelium.win](https://pixelium.win)**

## Articles (16)

| Article | Tags |
|---------|------|
| Backup autonome : le homelab dort | proxmox, backup, automatisation |
| Lien direct 2.5G pve1 ↔ pve2 | reseau, proxmox, hardware |
| DNS-over-TLS : pourquoi chiffrer | securite, dns, reseau |
| PXE boot avec netboot.xyz | reseau, hardware, pxe |
| YubiKey SSH FIDO2 | securite, ssh, yubikey |
| Authentik SSO : unifier les services | securite, authentik, sso |
| CrowdSec + Traefik : premiers pas | securite, traefik, crowdsec |
| OpenFang Guardian AIOps | ia, automatisation, monitoring |
| Cloudflare R2 + KV live status | cloudflare, automatisation |
| WOPR BBS terminal Workers AI | ia, cloudflare, workers-ai |
| CV conversationnel chatbot Workers AI | ia, cloudflare, emploi |
| Refonte site : 9 pages vers 6 | web, astro |
| 70 repos miroirs : resilience offline | automatisation, resilience, forgejo |
| Agent vs sous-agent : lecon IA | ia, reflexion, claude |
| Claude usage dashboard tokens | ia, claude-code, observabilite |
| Meshtastic LoRa MQTT Home Assistant | iot, meshtastic, mqtt |
| Immich GPU remote CLIP multilingue | immich, gpu, cuda, podman |

## Stack

| Layer | Technology |
|-------|------------|
| Framework | Astro 6 (SSG) |
| Hosting | Cloudflare Workers |
| Language | French |
| Features | RSS feed, tag navigation, sticky TOC, reading progress bar |
| Design | Inherited from pixelium.win (palette, fonts, terminal elements) |
| CI/CD | GitHub Actions → `wrangler deploy` |

## License

MIT
