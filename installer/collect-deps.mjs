// Lists (and optionally copies) the installed dependency closure of the given packages.
// Usage: node collect-deps.mjs <projectDir> <outDir|--list> pkg...
import fs from 'node:fs';
import path from 'node:path';
const [projectDir,outDir,...roots]=process.argv.slice(2);
const seen=new Map();
function resolve(name,fromDir){let dir=fromDir;while(true){const candidate=path.join(dir,'node_modules',name);if(fs.existsSync(path.join(candidate,'package.json')))return candidate;const parent=path.dirname(dir);if(parent===dir||!parent.startsWith(projectDir))return null;dir=parent;}}
function visit(name,fromDir){const dir=resolve(name,fromDir);if(!dir||seen.has(dir))return;const pkg=JSON.parse(fs.readFileSync(path.join(dir,'package.json'),'utf8'));seen.set(dir,pkg.name);
 for(const dep of Object.keys({...pkg.dependencies,...pkg.optionalDependencies,...pkg.peerDependencies}))visit(dep,dir);}
for(const r of roots)visit(r,projectDir);
const size=d=>{let s=0;for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);s+=e.isDirectory()?size(p):fs.statSync(p).size;}return s;};
let total=0;for(const dir of seen.keys())total+=size(dir);
console.log(`${seen.size} packages, ${(total/1048576).toFixed(1)} MB`);
if(outDir&&outDir!=='--list'){for(const dir of seen.keys()){const rel=path.relative(projectDir,dir);fs.cpSync(dir,path.join(outDir,rel),{recursive:true,dereference:true});}console.log('copied to',outDir);}
else console.log([...seen.values()].sort().join(' '));
