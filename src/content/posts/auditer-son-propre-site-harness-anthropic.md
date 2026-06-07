---
title: "Auditer le site que j'ai construit : 7 findings, 2 vrais bugs, 1 leçon d'humilité"
date: 2026-06-08
tags: ["security", "audit", "cloudflare", "workers", "rate-limiting", "ci"]
summary: "J'ai passé pixelium.win — le site que j'ai moi-même écrit — au harness de découverte de vulnérabilités d'Anthropic. Verdict : une race condition exploitable sur le rate-limit du chatbot, une Global API Key qui traînait dans le CI, un flag de CTF dans un repo public. Tout est corrigé, et publié."
---

> Format **sécurité** — un audit de notre propre code, publié une fois les
> correctifs déployés et vérifiés. Auditer ce qu'on a soi-même écrit est un
> exercice d'humilité : chaque finding est une décision que j'avais prise.

## TL;DR

Début juin, on a passé le code de [pixelium.win](https://pixelium.win) au **harness defending
d'Anthropic** — un cadre de découverte et de correction de vulnérabilités, utilisé ici en
read-only sur notre propre périmètre. Sept findings, classés et triés :

- **F-001 (MEDIUM, confirmé)** : le rate-limit du chatbot était structurellement contournable —
  race condition sur KV. Corrigé par le binding Rate Limiting natif de Cloudflare.
- **F-003 (MEDIUM)** : le CI déployait avec la **Global API Key** Cloudflare. Corrigé : token
  scopé aux permissions exactes, créé par API.
- **F-004, F-006 (LOW)** : fuite de messages d'erreur internes, et un flag de CTF commité dans
  un repo public. Corrigés le jour même.
- **F-007 (LOW)** : `unsafe-inline` dans la CSP — risque accepté et documenté, mais le diagnostic
  a révélé un trou voisin bien réel : les routes Worker ne portaient *aucun* header de sécurité.

Et autant de **non-findings** vérifiés : pas de XSS, pas d'injection SQL, pas de secret en dur.

## F-001 — Le rate-limit qui ne limitait pas vraiment

Le [CV conversationnel](/cv-conversationnel-chatbot-workers-ai) du site appelle Workers AI —
de l'inférence facturée. Je l'avais protégé par un rate-limit : 4 requêtes/minute, 30/heure,
comptées dans KV. Le code semblait raisonnable :

```ts
const count = parseInt(await env.SESSION.get(key) ?? '0');     // lire
if (count >= LIMIT) return tooMany();                           // décider
await env.SESSION.put(key, String(count + 1), { ttl });        // écrire
```

Lire, décider, écrire. Trois opérations, trois moments. Un client qui envoie **20 requêtes en
parallèle** les voit toutes lire `count=0`, toutes passer la garde, toutes écrire `1`. Le plafond
de 4/min n'existe pas face à une rafale — et KV étant à cohérence éventuelle, même un compteur
« rapide » resterait approximatif. Ce n'est pas un bug d'implémentation, c'est un **pattern qui
ne peut structurellement pas garantir une limite**. La cible étant de l'inférence facturée,
le finding se lit : *amplification de coût par n'importe qui, sans authentification*.

Le fix utilise ce que la plateforme fait de mieux — un compteur atomique natif :

```toml
# wrangler.toml
[[ratelimits]]
name = "CHAT_RL"
[ratelimits.simple]
limit = 4
period = 60
```

```ts
const minute = await env.CHAT_RL.limit({ key: `chat:${ip}` });
if (!minute.success) return tooMany(60);
```

La fenêtre horaire reste un compteur KV — mais sa course est désormais **bornée par le limiteur
atomique en amont** (au pire 4 acceptées/min), ce qui rend l'over-count négligeable. Défense en
profondeur plutôt que pureté théorique.

## F-003 — La clé qui pouvait tout faire

Le CI GitHub déployait le Worker avec la **Global API Key** Cloudflare : une clé qui peut tout,
sur tout le compte — DNS, R2, Workers, zones. Blast radius maximal pour un secret stocké chez un
tiers. L'atténuant (« le workflow ne tourne que sur push main ») était documenté, mais c'était
un risque accepté par paresse, pas par analyse.

Une première tentative de token scopé avait échoué sur un piège réel : le déploiement d'un Worker
*avec bindings KV et D1* exige les permissions **Write** correspondantes, sinon l'API renvoie un
`code 10023` peu loquace. On en avait tiré la mauvaise conclusion (« bindings incompatibles avec
les scoped tokens ») — conclusion **réfutée** cette semaine : un token aux permissions exactes
(Workers Scripts/KV/D1 Write + trois Read) déploie tout sans broncher.

La recette, entièrement par API : `GET /user/tokens/permission_groups` pour les IDs,
`POST /user/tokens` avec des policies account+user, validation `wrangler deploy --dry-run` en
local, **puis seulement** bascule du CI. L'ancienne clé reste en secret GitHub comme rollback
documenté — on supprime les filets après les avoir remplacés, pas avant.

## F-004 et F-006 — Les petites fuites

- Les handlers d'API renvoyaient `e.message` brut au client en cas d'erreur — un détail
  d'implémentation qui peut exposer chemins, structure ou versions. Remplacé par un message
  générique côté client, le détail partant dans `console.error` côté Worker.
- Le flag du [door game WOPR](/wopr-bbs-terminal-workers-ai) — un défi de prompt injection
  volontaire — était commité en clair dans le repo… qui a un miroir public GitHub. Un CTF dont la
  solution est dans le code source n'est plus un CTF. Le flag vit désormais dans un secret Worker,
  et sa valeur a été rotée.

## F-007 — Le risque accepté qui cachait un vrai trou

Le finding pointait `script-src 'unsafe-inline'` dans la CSP — réel, mais accepté : Astro inline
ses scripts, le site n'a aucun sink XSS (que du `textContent`), et le coût des nonces ne se
justifie pas aujourd'hui. Dossier classé, documenté.

Sauf qu'en vérifiant *où* cette CSP s'appliquait, surprise : le fichier `_headers` de Cloudflare
ne couvre que les **assets statiques**. Les routes rendues par le Worker — toutes les API —
sortaient **sans aucun header de sécurité**. Pas de CSP, pas de HSTS, rien. Le fix est un
middleware Astro de quinze lignes qui pose CSP/HSTS/nosniff/X-Frame-Options/Referrer-Policy sur
tout ce que le Worker rend. Vérifié en local (`wrangler dev`), puis en production.

C'est peut-être la meilleure leçon de l'audit : **le finding « accepté » a payé quand même**,
parce que le travail de vérification a regardé là où personne ne regardait.

## Ce que l'audit n'a pas trouvé

Un audit honnête liste aussi le négatif : pas de XSS (aucun `innerHTML` sur entrée utilisateur),
pas d'injection SQL (D1 systématiquement via `.bind()`), pas de secret hardcodé dans le code
applicatif, tokens de build absents du bundle client. Les fondations tenaient ; les findings
étaient dans les coutures — le rate-limit, le CI, les en-têtes des chemins secondaires.

## Les leçons

1. **Un compteur lire-décider-écrire n'est pas un rate-limit.** Sur une plateforme à cohérence
   éventuelle, c'est une suggestion. Utiliser les primitives atomiques de la plateforme.
2. **Le moindre privilège se prouve par l'échec** : créer le token minimal, regarder ce qui casse
   (`10023`), ajouter la permission exacte, recommencer. Et documenter la recette — la
   première erreur de diagnostic nous a coûté deux mois de Global Key.
3. **Vérifier le périmètre d'application d'un contrôle**, pas seulement son contenu. Notre CSP
   était correcte… sur la moitié des réponses du site.
4. **S'auditer soi-même fonctionne** si la méthodologie vient d'ailleurs. Chaque finding était
   une décision que j'avais prise et que je trouvais raisonnable. Le harness n'avait pas mon
   attachement à mes propres choix.

Tout est corrigé, déployé, vérifié en production — c'est la condition pour publier ce billet.
Le suivi vit dans les issues Forgejo du homelab, et le détail des correctifs dans l'historique
public du [repo](https://github.com/ferr079/pixelium-site).
