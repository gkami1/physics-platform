import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

// Theory Markdown is read straight from content/ — it holds no secrets.
// Tasks are NOT a collection: they come only from build/public (see src/lib/content.ts),
// so answers and solutions can never end up in the site.
//
// Entry ids are page ids (as in build/public `theory[].id`), prefixed with the exam:
//   ege-physics/theory/mech.kinematics.basics.md             -> ege-physics/mech.kinematics.basics
//   ege-physics/theory/mech.kinematics.basics/_topic.md      -> ege-physics/mech.kinematics.basics
//   ege-physics/theory/mech.kinematics.basics/01-motion-si.md -> ege-physics/mech.kinematics.basics/motion-si
function theoryEntryId(entry: string): string {
  return entry
    .replace(/\/theory\//, '/')
    .replace(/\.md$/, '')
    .replace(/\/_topic$/, '')
    .replace(/\/\d{2}-([^/]+)$/, '/$1');
}

const theory = defineCollection({
  loader: glob({
    pattern: ['*/theory/*.md', '*/theory/*/*.md'],
    base: '../content',
    generateId: ({ entry }) => theoryEntryId(entry),
  }),
  schema: z.object({
    topic: z.string(),
    title: z.string(),
    status: z.enum(['draft', 'published']).default('draft'),
    // Lessons only (content-build validate enforces it).
    grade: z.union([z.string(), z.number()]).optional(),
    summary: z.string().optional(),
  }),
});

export const collections = { theory };
