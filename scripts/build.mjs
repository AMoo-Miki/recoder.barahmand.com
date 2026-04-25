// Build script — emits a deploy-ready dist/ for GitHub Pages.
//
// Layout produced:
//   dist/
//     index.html               (rewritten to reference minified assets)
//     CNAME                    (custom domain config, copied verbatim)
//     img/...                  (static assets, copied verbatim)
//     css/index.min.css
//     js/index.min.js
//     js/lib/recoder.min.js
//
// Each JS file is minified independently because js/index.js depends on
// js/lib/recoder.js via a global (RecoderLib) populated by recoder.js's
// UMD wrapper, not via ES module imports — so concatenating with
// `bundle: true` would require a code change. Two small files is fine.

import { build } from 'esbuild';
import { rm, mkdir, cp, readFile, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const dist = join(root, 'dist');

async function clean() {
    await rm(dist, { recursive: true, force: true });
    await mkdir(dist, { recursive: true });
}

async function copyStaticAssets() {
    await cp(join(root, 'img'), join(dist, 'img'), { recursive: true });
    if (existsSync(join(root, 'CNAME'))) {
        await cp(join(root, 'CNAME'), join(dist, 'CNAME'));
    }
}

async function minifyJs() {
    await build({
        entryPoints: [
            join(root, 'js/lib/recoder.js'),
            join(root, 'js/index.js'),
        ],
        outdir: join(dist, 'js'),
        outbase: join(root, 'js'),
        bundle: false,
        minify: true,
        target: ['es2018'],
        outExtension: { '.js': '.min.js' },
        legalComments: 'none',
        logLevel: 'warning',
    });
}

async function minifyCss() {
    await build({
        entryPoints: [join(root, 'css/index.css')],
        outdir: join(dist, 'css'),
        bundle: false,
        minify: true,
        loader: { '.css': 'css' },
        outExtension: { '.css': '.min.css' },
        legalComments: 'none',
        logLevel: 'warning',
    });
}

async function rewriteIndexHtml() {
    let html = await readFile(join(root, 'index.html'), 'utf8');
    const rewrites = [
        ['css/index.css', 'css/index.min.css'],
        ['js/lib/recoder.js', 'js/lib/recoder.min.js'],
        ['js/index.js', 'js/index.min.js'],
    ];
    for (const [from, to] of rewrites) {
        if (!html.includes(from)) {
            throw new Error(`index.html does not contain "${from}" — refusing to ship a broken bundle`);
        }
        html = html.replace(from, to);
    }
    await writeFile(join(dist, 'index.html'), html);
}

async function reportSize(label, path) {
    const s = await stat(path);
    const kb = (s.size / 1024).toFixed(1);
    console.log(`  ${label.padEnd(28)} ${kb.padStart(7)} KB`);
}

async function main() {
    const t0 = Date.now();
    console.log('build → dist/');
    await clean();
    await copyStaticAssets();
    await minifyJs();
    await minifyCss();
    await rewriteIndexHtml();
    console.log('artifacts:');
    await reportSize('index.html',           join(dist, 'index.html'));
    await reportSize('css/index.min.css',    join(dist, 'css/index.min.css'));
    await reportSize('js/index.min.js',      join(dist, 'js/index.min.js'));
    await reportSize('js/lib/recoder.min.js', join(dist, 'js/lib/recoder.min.js'));
    console.log(`done in ${Date.now() - t0}ms`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
