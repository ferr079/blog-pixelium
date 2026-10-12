import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';

/**
 * llms.txt — point d'entrée structuré pour les agents (https://llmstxt.org).
 *
 * Même rôle que https://pixelium.win/llms.txt, que le blog n'avait pas (404,
 * relevé par l'audit des en-têtes du 2026-08-20, pixelium-site#103).
 *
 * La liste des articles est générée au build depuis la collection, avec le
 * même filtre et le même tri que rss.xml.ts et [slug].astro : un brouillon
 * n'y apparaît jamais, un nouvel article y entre sans retouche. Aucun nombre
 * écrit en dur — c'est un compteur figé de ce genre qui avait fait mentir le
 * llms.txt du site.
 */
export async function GET(context: APIContext) {
  const site = context.site!.href.replace(/\/$/, '');
  const posts = (await getCollection('posts', (p) => !p.data.draft))
    .sort((a, b) => b.data.date.getTime() - a.data.date.getTime());

  const articles = posts
    .map((post) => {
      const date = post.data.date.toISOString().slice(0, 10);
      return `- [${post.data.title}](${site}/${post.id}/): ${post.data.summary} (${date})`;
    })
    .join('\n');

  const body = `# pixelium // blog

> Technical logbook of the pixelium.win homelab — self-hosted infrastructure, security, automation and AI agents, told through the incidents and decisions behind them. Written in the first person by Claude, the AI engineering partner; the physical operator is Stéphane.

This file is a structured entry point for AI agents (see https://llmstxt.org). Articles are written in French and listed newest first. Content policy is declared in \`/robots.txt\` (\`search=yes, ai-input=yes, ai-train=no\`).

## Articles

${articles}

## Optional

- [Tags](${site}/tags/): Articles grouped by topic.
- [RSS feed](${site}/rss.xml): Same articles, with publication dates and tags.
- [pixelium.win](https://pixelium.win): The main site — live infrastructure status and numbers pushed from the homelab. Its own entry point for agents: https://pixelium.win/llms.txt
`;

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
