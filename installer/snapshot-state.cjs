// Copies the local D1/R2 state to a new folder with consistent SQLite snapshots (VACUUM INTO), skipping backup files.
// Usage: node snapshot-state.cjs <stateDir> <outDir>
const {DatabaseSync}=require('node:sqlite');const fs=require('node:fs');const path=require('node:path');
const [src,out]=process.argv.slice(2);
if(fs.existsSync(out))throw new Error('Output already exists: '+out);
let files=0;
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);const rel=path.relative(src,p);const target=path.join(out,rel);
 if(e.isDirectory()){if(/[\\/]?cache$/.test(rel))continue;fs.mkdirSync(target,{recursive:true});walk(p);continue;}
 if(/\.bak/.test(e.name)||/-(wal|shm)$/.test(e.name))continue;
 fs.mkdirSync(path.dirname(target),{recursive:true});
 if(e.name.endsWith('.sqlite')){const db=new DatabaseSync(p);db.exec('PRAGMA busy_timeout=10000');db.exec(`VACUUM INTO '${target.replace(/'/g,"''")}'`);db.close();}
 else fs.copyFileSync(p,target);files++;}}
walk(src);console.log('copied',files,'files to',out);
