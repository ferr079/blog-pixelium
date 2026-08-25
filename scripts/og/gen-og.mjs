// gen-og.mjs — génération build-time des cartes Open Graph du blog (1200×630).
// satori (VDOM → SVG) + @resvg/resvg-js (SVG → PNG). Tourne avant `astro build`
// et écrit public/og/ : une carte par article, plus les cartes des pages fixes.
//
// Pourquoi ce script existe : le blog servait og:title et og:description mais
// AUCUNE og:image. Un lien du blog collé sur X, Slack ou LinkedIn sortait en
// carte texte, sans visuel — constaté le 2026-08-25.
//
// Jumeau de pixelium-site/scripts/og/gen-og.mjs, volontairement dupliqué : deux
// dépôts, deux déploiements, aucun paquet partagé entre eux. La divergence
// assumée est le pied de carte (ici la date et les tags de l'article, là-bas la
// ligne de stats live).
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
// Même slugifieur qu'Astro (glob loader → generateId). Indispensable : le nom de
// FICHIER n'est pas le slug d'URL. `lien-direct-2.5g-pve1-pve2.md` est servi sous
// /lien-direct-25g-pve1-pve2/ — le point disparaît. Nommer les cartes d'après le
// fichier produisait un og:image en 404 sur cet article, et sur lui seul.
import Slugger from 'github-slugger';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const OUT = join(root, 'public', 'og');
const OUT_POSTS = join(OUT, 'posts');
mkdirSync(OUT_POSTS, { recursive: true });

const fontRegular = readFileSync(join(here, 'fonts', 'JetBrainsMono-Regular.ttf'));
const fontBold = readFileSync(join(here, 'fonts', 'JetBrainsMono-ExtraBold.ttf'));

const BG = '#0a0f1a';
const ACCENT = '#38bdf8';
const TEXT = '#e2e8f0';
const MUTED = '#94a3b8';

/**
 * Frontmatter minimal : title, summary, date, tags, draft.
 * Pas de dépendance YAML — ce script tourne avant Astro, et le schéma est fixé
 * par src/content.config.ts. Il lit ce que ce schéma garantit, rien de plus.
 */
function parseFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (!kv) continue;
    const [, key] = kv;
    let value = kv[2].trim();
    if (value.startsWith('[') && value.endsWith(']')) {
      data[key] = value.slice(1, -1).split(',')
        .map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
      continue;
    }
    value = value.replace(/^["']|["']$/g, '');
    data[key] = value === 'true' ? true : value === 'false' ? false : value;
  }
  return data;
}

/** Un titre long ne doit pas déborder de la carte : la taille suit la longueur. */
function titleSize(text) {
  const n = text.length;
  if (n <= 28) return 84;
  if (n <= 45) return 68;
  if (n <= 70) return 54;
  if (n <= 100) return 44;
  return 38;
}

function clamp(text, max) {
  if (!text || text.length <= max) return text || '';
  return text.slice(0, max - 1).trimEnd() + '…';
}

// --- satori VDOM helpers (pas de JSX) ---
const el = (type, style, children) => ({ type, props: { style, children } });

function card({ eyebrow, title, subtitle, footer }) {
  return el('div', {
    display: 'flex', flexDirection: 'column', width: '1200px', height: '630px',
    background: BG, padding: '72px 80px', justifyContent: 'space-between',
    fontFamily: 'JetBrains Mono', borderLeft: `12px solid ${ACCENT}`,
  }, [
    el('div', { display: 'flex', fontSize: '30px', color: ACCENT, letterSpacing: '0.08em' },
      eyebrow),
    el('div', { display: 'flex', flexDirection: 'column' }, [
      el('div', {
        display: 'flex', fontSize: `${titleSize(title)}px`, fontWeight: 800, color: TEXT,
        lineHeight: 1.08, letterSpacing: '-0.02em', maxWidth: '1000px',
      }, title),
      el('div', {
        display: 'flex', fontSize: '30px', color: MUTED, marginTop: '24px',
        lineHeight: 1.35, maxWidth: '940px',
      }, subtitle),
    ]),
    el('div', { display: 'flex', fontSize: '26px', color: ACCENT, letterSpacing: '0.02em' },
      footer),
  ]);
}

const opts = {
  width: 1200, height: 630,
  fonts: [
    { name: 'JetBrains Mono', data: fontRegular, weight: 400, style: 'normal' },
    { name: 'JetBrains Mono', data: fontBold, weight: 800, style: 'normal' },
  ],
};

async function render(relPath, page) {
  const svg = await satori(card(page), opts);
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng();
  writeFileSync(join(OUT, `${relPath}.png`), png);
  return png.length;
}

const EYEBROW = '∷ pixelium // blog';

// --- articles ---
const postsDir = join(root, 'src', 'content', 'posts');
const files = readdirSync(postsDir).filter((f) => /\.mdx?$/.test(f));
let published = 0;
let skipped = 0;

const slugger = new Slugger();
for (const file of files) {
  const stem = file.replace(/\.mdx?$/, '');
  slugger.reset();
  const slug = slugger.slug(stem);
  if (slug !== stem) console.log(`[og] ${stem} → slug d'URL « ${slug} »`);
  const data = parseFrontmatter(readFileSync(join(postsDir, file), 'utf8'));
  if (!data) {
    console.warn(`[og] ${file} — frontmatter illisible, ignoré`);
    skipped++;
    continue;
  }
  if (data.draft === true) { skipped++; continue; }

  const date = data.date
    ? new Date(data.date).toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' })
    : '';
  const tags = Array.isArray(data.tags) ? data.tags.slice(0, 3).map((t) => `#${t}`).join(' ') : '';
  const footer = [date, tags].filter(Boolean).join('  ·  ');

  const bytes = await render(join('posts', slug), {
    eyebrow: EYEBROW,
    title: clamp(data.title || stem, 130),
    subtitle: clamp(data.summary, 165),
    footer,
  });
  console.log(`[og] posts/${slug}.png — ${(bytes / 1024).toFixed(0)} KB`);
  published++;
}

// --- pages fixes ---
const FIXED = {
  home: {
    title: 'pixelium // blog',
    subtitle: 'Journal de bord technique — homelab, infra, IA et apprentissage en continu.',
    footer: `${published} articles · pixelium.win`,
  },
  tags: {
    title: 'Tags',
    subtitle: 'Parcourir le journal par sujet.',
    footer: 'blog.pixelium.win',
  },
  default: {
    title: 'pixelium // blog',
    subtitle: 'Journal de bord technique — homelab, infra, IA et apprentissage en continu.',
    footer: 'blog.pixelium.win',
  },
};

for (const [slug, page] of Object.entries(FIXED)) {
  const bytes = await render(slug, { eyebrow: EYEBROW, ...page });
  console.log(`[og] ${slug}.png — ${(bytes / 1024).toFixed(0)} KB`);
}

console.log(`[og] done — ${published} articles + ${Object.keys(FIXED).length} pages fixes`
  + (skipped ? ` (${skipped} ignoré·s : brouillons ou frontmatter illisible)` : ''));
