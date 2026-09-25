// Copy the parts of three.js the page imports into web/vendor (no build step,
// so the site can be hosted as plain static files).
import { cpSync, rmSync, mkdirSync } from 'node:fs';
const src = 'node_modules/three', out = 'vendor/three';
rmSync(out, { recursive: true, force: true });
mkdirSync(out + '/addons/libs', { recursive: true });
for (const f of ['three.module.js', 'three.core.js']) cpSync(`${src}/build/${f}`, `${out}/${f}`);
for (const d of ['loaders', 'renderers', 'postprocessing', 'shaders', 'utils', 'math', 'curves'])
  cpSync(`${src}/examples/jsm/${d}`, `${out}/addons/${d}`, { recursive: true });
cpSync(`${src}/examples/jsm/libs/meshopt_decoder.module.js`, `${out}/addons/libs/meshopt_decoder.module.js`);
cpSync(`${src}/examples/jsm/libs/fflate.module.js`, `${out}/addons/libs/fflate.module.js`);
console.log('vendored three', JSON.parse((await import('node:fs')).readFileSync(`${src}/package.json`)).version);
