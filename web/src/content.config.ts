import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

// Theory Markdown is read straight from content/ — it holds no secrets.
// Tasks are NOT a collection: they come only from build/public (see src/lib/content.ts),
// so answers and solutions can never end up in the site.
const theory = defineCollection({
  loader: glob({
    pattern: '*/theory/*.md',
    base: '../content',
    // "ege-physics/theory/mech.kinematics.basics.md" -> "ege-physics/mech.kinematics.basics"
    generateId: ({ entry }) => entry.replace(/\/theory\//, '/').replace(/\.md$/, ''),
  }),
  schema: z.object({
    topic: z.string(),
    title: z.string(),
    status: z.enum(['draft', 'published']).default('draft'),
  }),
});

export const collections = { theory };
