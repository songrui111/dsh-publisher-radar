/**
 * The six model-facing tools.
 *
 * Each returns one Markdown document under `markdown`. A single string rather than
 * a structured graph is a deliberate choice: the consumer of these answers is the
 * model, and the tables are already the argument. The `render` hook prints the same
 * text in the transcript so a human can read the answer without opening a panel.
 */
import { checkupMarkdown, gapsMarkdown, mineMarkdown, overviewMarkdown, searchMarkdown } from './report.mjs';

const markdownOutput = {
  type: 'object',
  properties: { markdown: { type: 'string' } },
  required: ['markdown'],
  additionalProperties: false,
};

function rendered(value) {
  return [{ type: 'text', text: value.markdown }];
}

export function createTools(radar, settings = {}) {
  return [
    {
      name: 'radar_gaps',
      description:
        'Rank DSH marketplace topics by how FEW plugins already cover them — the "what should I build?" answer, from the live catalog. ' +
        'Returns a table of topics (empty / thin / warming / crowded) with exemplar plugin names. ' +
        'Use when deciding whether a plugin idea is already taken, or to browse the emptiest corners of the market.',
      parameters: {
        type: 'object',
        properties: {
          level: {
            type: 'string',
            enum: ['empty', 'thin', 'warming', 'crowded'],
            description: 'Only return topics at this coverage level. Omit for all levels, emptiest first.',
          },
          limit: { type: 'number', description: 'Rows to return (1–100, default 20).' },
        },
        additionalProperties: false,
      },
      output: { schema: markdownOutput, render: (_args, value) => rendered(value) },
      async execute(args) {
        const result = await radar.gaps({ level: args?.level, limit: typeof args?.limit === 'number' ? args.limit : 20 });
        return { markdown: gapsMarkdown(result) };
      },
      presentCall: (args) => ({ card: 'generic', title: `Gap ranking${args?.level ? ` (${args.level})` : ''}` }),
    },

    {
      name: 'radar_market',
      description:
        'Overview of the DSH plugin marketplace: total plugins, category distribution, monthly additions, download leaders, and the emptiest directions. ' +
        'Use to size the market before picking a niche, or to check how crowded a category is.',
      parameters: {
        type: 'object',
        properties: {
          gapLimit: { type: 'number', description: 'How many empty/thin directions to list (default 10).' },
        },
        additionalProperties: false,
      },
      output: { schema: markdownOutput, render: (_args, value) => rendered(value) },
      async execute(args) {
        const result = await radar.overview();
        return { markdown: overviewMarkdown(result, { gapLimit: typeof args?.gapLimit === 'number' ? args.gapLimit : 10 }) };
      },
      presentCall: () => ({ card: 'generic', title: 'Marketplace overview' }),
    },

    {
      name: 'radar_plugin',
      description:
        'Ask "who already did this?" — searches the catalog (names, authors, descriptions) plus the topic taxonomy for a keyword or plugin name, ' +
        'and reports coverage with stars and monthly downloads. Use before committing to an idea, and to find direct competitors for a name.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'A topic, keyword, plugin name or author, e.g. "物流", "dicom", "trello", "kanban".' },
          limit: { type: 'number', description: 'Matching plugins to list (1–50, default 20).' },
        },
        required: ['query'],
        additionalProperties: false,
      },
      output: { schema: markdownOutput, render: (_args, value) => rendered(value) },
      async execute(args) {
        const query = String(args?.query ?? '').trim();
        if (query === '') throw new Error('radar_plugin: query must be a non-empty string');
        const result = await radar.search(query, typeof args?.limit === 'number' ? args.limit : 20);
        return { markdown: searchMarkdown(result) };
      },
      presentCall: (args) => ({ card: 'generic', title: `Competitors for ${args?.query ?? ''}` }),
    },

    {
      name: 'radar_checkup',
      description:
        'Publish-readiness checkup for a local plugin folder: manifest shape, dsh.bundle.patch resolving, relative patch name, engines.dsh, ' +
        'install-time scripts (the supply-chain red flag every scanner flags), files whitelist, entry file, bilingual README. ' +
        'Read-only — it inspects files and never writes. Use before tagging a release or opening a catalog PR.',
      parameters: {
        type: 'object',
        properties: {
          dir: { type: 'string', description: 'Plugin folder to inspect. Defaults to the current working directory.' },
        },
        additionalProperties: false,
      },
      output: { schema: markdownOutput, render: (_args, value) => rendered(value) },
      async execute(args) {
        const dir = typeof args?.dir === 'string' && args.dir.trim() !== '' ? args.dir.trim() : process.cwd();
        return { markdown: checkupMarkdown(radar.checkup(dir)) };
      },
      presentCall: (args) => ({ card: 'generic', title: `Publish checkup: ${args?.dir ?? 'cwd'}` }),
    },

    {
      name: 'radar_mine',
      description:
        'Your own plugins: last-month npm downloads, published version, live GitHub stars, whether the catalog lists them, and rank within the same category. ' +
        'With no argument it tracks the configured `myPlugins`, or — when the workspace is the plugin folder itself — the package declared in its package.json. ' +
        'Use to track uptake after a release.',
      parameters: {
        type: 'object',
        properties: {
          packages: {
            type: 'array',
            items: { type: 'string' },
            description: 'npm package names to track. Omit to use the configured list, or this workspace\'s own plugin.',
          },
        },
        additionalProperties: false,
      },
      output: { schema: markdownOutput, render: (_args, value) => rendered(value) },
      async execute(args) {
        const packages = Array.isArray(args?.packages) && args.packages.length > 0 ? args.packages : undefined;
        return { markdown: mineMarkdown(await radar.mine(packages)) };
      },
      presentCall: () => ({ card: 'generic', title: 'My plugin numbers' }),
    },
  ];
}
