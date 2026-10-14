// Makes the scrypt hash of the Super Admin (admin01) password for the sign-in layer. The password is typed here (nothing is shown while typing);
// it is never written anywhere - only its hash is.
//
//   node make-admin-hash.mjs --write-to /etc/payroll/layer.env     puts ADMIN_PASSWORD_HASH=... into that file (the hash is not shown); the file is made if it is missing
//   node make-admin-hash.mjs                                       prints the hash instead
//   (a password that is piped in, e.g.  node make-admin-hash.mjs < password.txt , is read from the first line)
// (The option is not called --env-file on purpose: Node itself reads a file named by --env-file, anywhere on the command line, before this script starts.)
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {hashPassword} from './server.mjs';

//   node make-admin-hash.mjs --clipboard                           puts the hash into the clipboard (Windows / macOS), to paste it into a hosting panel's environment variable; nothing is shown
const args=process.argv.slice(2),target=args[0]==='--write-to'?args[1]:'',toClipboard=args.length===1&&args[0]==='--clipboard';
if(args.length&&!toClipboard&&!(args[0]==='--write-to'&&target&&args.length===2)){console.error('Usage: node make-admin-hash.mjs [--write-to /etc/payroll/layer.env | --clipboard]');process.exit(2);}

function readSecret(prompt){
 return new Promise((resolve,reject)=>{
  const stdin=process.stdin;
  if(!stdin.isTTY){let data='';stdin.setEncoding('utf8');stdin.on('data',c=>{data+=c;});stdin.on('end',()=>resolve(data.split(/\r?\n/)[0]));stdin.on('error',reject);return;}
  process.stdout.write(prompt);stdin.setRawMode(true);stdin.resume();stdin.setEncoding('utf8');let value='';
  const done=v=>{stdin.setRawMode(false);stdin.pause();stdin.removeListener('data',onData);process.stdout.write('\n');resolve(v);};
  const onData=ch=>{
   for(const c of ch){
    if(c==='\r'||c==='\n')return done(value);
    if(c==='\u0003'){stdin.setRawMode(false);process.stdout.write('\n');process.exit(130);}
    if(c==='\u007f'||c==='\b')value=value.slice(0,-1);else if(c>=' ')value+=c;
   }
  };
  stdin.on('data',onData);
 });
}

const first=await readSecret('New Super Admin (admin01) password: ');
if(first.length<12){console.error('The password needs at least 12 characters.');process.exit(1);}
if(first.length>200){console.error('The password is too long (200 characters at most).');process.exit(1);}
if(process.stdin.isTTY){const again=await readSecret('Type it again: ');if(again!==first){console.error('The two passwords are not the same.');process.exit(1);}}
const hash=await hashPassword(first);

if(toClipboard){
 const tool=process.platform==='win32'?['clip.exe',[]]:process.platform==='darwin'?['pbcopy',[]]:null;
 if(!tool){console.error('--clipboard works on Windows and macOS only; run without it and copy the printed hash.');process.exit(1);}
 const r=spawnSync(tool[0],tool[1],{input:hash});if(r.status!==0){console.error('Could not use the clipboard.');process.exit(1);}
 console.log('The hash is in the clipboard (not shown). Paste it into ADMIN_PASSWORD_HASH, then clear the clipboard.');process.exit(0);
}
if(!target){console.log(hash);process.exit(0);}
let text='';try{text=fs.readFileSync(target,'utf8');}catch(e){if(e.code!=='ENOENT'){console.error('Cannot read '+target+': '+e.message);process.exit(1);}}
const line='ADMIN_PASSWORD_HASH='+hash;
const next=/^ADMIN_PASSWORD_HASH=.*$/m.test(text)?text.replace(/^ADMIN_PASSWORD_HASH=.*$/m,()=>line):text+(text&&!text.endsWith('\n')?'\n':'')+line+'\n';
try{fs.writeFileSync(target,next,{mode:0o600});try{fs.chmodSync(target,0o600);}catch{/* not supported here (Windows) */}}catch(e){console.error('Cannot write '+target+': '+e.message);process.exit(1);}
console.log('ADMIN_PASSWORD_HASH was written to '+target+' (readable by its owner only). Restart the sign-in layer (systemctl restart payroll-layer, or restart the web app) to use it.');
