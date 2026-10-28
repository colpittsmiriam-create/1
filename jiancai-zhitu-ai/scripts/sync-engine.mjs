import {readFile,writeFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/platform/core.js',import.meta.url),'utf8');
await writeFile(new URL('../lib/core.cjs',import.meta.url),source);
const esm=source.replace('(function (root) {','').replace("if(typeof module!=='undefined'&&module.exports) module.exports=api;else root.JiancaiCore=api;",'export default api;').replace("})(typeof window!=='undefined'?window:globalThis);",'');
if(esm===source||!esm.includes('export default api;'))throw Error('Core module shape changed; update the deterministic ESM conversion.');
await writeFile(new URL('../lib/engine.mjs',import.meta.url),esm);
