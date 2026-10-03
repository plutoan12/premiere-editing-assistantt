import { build } from 'esbuild';
await build({entryPoints:{'pea-helper':'src/cli.ts','index':'src/index.ts'},bundle:true,platform:'node',target:'node22',
  format:'esm',outdir:'dist',outExtension:{'.js':'.mjs'},sourcemap:false,legalComments:'eof'});
