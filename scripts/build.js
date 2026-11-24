#!/usr/bin/env node
/**
 * Bundles index.html + style.css + all scripts into one self-contained file:
 * dist/neuroevolution-cars.html (easy to host, share, or open offline).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

html = html.replace(/<link rel="stylesheet" href="([^"]+)" \/>/g, (_, href) =>
  `<style>\n${fs.readFileSync(path.join(ROOT, href), 'utf8')}</style>`
);
html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, src) => {
  const file = path.join(ROOT, src);
  if (!fs.existsSync(file)) {
    console.warn(`skipping missing ${src}`);
    return '';
  }
  const code = fs.readFileSync(file, 'utf8').replace(/<\/script/gi, '<\\/script');
  return `<script>\n${code}</script>`;
});

const out = path.join(ROOT, 'dist', 'neuroevolution-cars.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`Built ${path.relative(ROOT, out)} (${(html.length / 1024).toFixed(1)} KB)`);
