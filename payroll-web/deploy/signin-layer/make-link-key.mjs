// Makes (or shows) the key of the office link: BIOMETRIC_LINK_KEY, the secret that the Server Link of the office computer and this server share (link.mjs).
//
//   node make-link-key.mjs --write-to ~/payroll-data/app.env     makes a new key and puts BIOMETRIC_LINK_KEY=... into that file (private, 0600); the key is not shown
//   node make-link-key.mjs --show ~/payroll-data/app.env         prints the key stored in that file - to type it into the Server Link on the office computer
//   node make-link-key.mjs                                       makes a key and prints it
// (The option is not called --env-file on purpose: Node itself reads a file named by --env-file before this script starts.)
// A new key replaces the old one: restart the web app and give the new key to the Server Link, the old one stops working at once.
import crypto from 'node:crypto';
import fs from 'node:fs';

const args=process.argv.slice(2);
const usage=()=>{console.error('Usage: node make-link-key.mjs [--write-to <file> | --show <file>]');process.exit(2);};
if(args.length>2||(args.length===1)||(args.length===2&&!['--write-to','--show'].includes(args[0])))usage();
const [mode,file]=args;
const KEY=/^BIOMETRIC_LINK_KEY=(.*)$/m;
if(mode==='--show'){
 let text='';try{text=fs.readFileSync(file,'utf8');}catch(e){console.error('Cannot read '+file+': '+e.message);process.exit(1);}
 const m=KEY.exec(text);if(!m||!m[1].trim()){console.error('There is no BIOMETRIC_LINK_KEY in '+file+'. Make one with --write-to.');process.exit(1);}
 console.log(m[1].trim().replace(/^["']|["']$/g,''));process.exit(0);
}
const key=crypto.randomBytes(32).toString('base64url');
if(!mode){console.log(key);process.exit(0);}
let text='';try{text=fs.readFileSync(file,'utf8');}catch(e){if(e.code!=='ENOENT'){console.error('Cannot read '+file+': '+e.message);process.exit(1);}}
const line='BIOMETRIC_LINK_KEY='+key;
const next=KEY.test(text)?text.replace(KEY,()=>line):text+(text&&!text.endsWith('\n')?'\n':'')+line+'\n';
try{fs.writeFileSync(file,next,{mode:0o600});try{fs.chmodSync(file,0o600);}catch{/* not supported here (Windows) */}}catch(e){console.error('Cannot write '+file+': '+e.message);process.exit(1);}
console.log('BIOMETRIC_LINK_KEY was written to '+file+' (readable by its owner only). Restart the web app to switch the office link on. Show the key (to type it on the office computer) with: node make-link-key.mjs --show '+file);
