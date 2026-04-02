import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';

export async function GET(context: APIContext) {
  const posts = (await getCollection('posts', (p) => !p.data.draft))
    .sort((a, b) => b.data.date.getTime() - a.data.date.getTime());

  return rss({
    title: 'pixelium // blog',
    description: 'Journal de bord technique — homelab, infra, IA et apprentissage en continu.',
    site: context.site!,
    items: posts.map((post) => ({
      title: post.data.title,
      pubDate: post.data.date,
      description: post.data.summary,
      link: `/${post.id}/`,
      categories: post.data.tags,
    })),
    customData: '<language>fr</language>',
  });
}
