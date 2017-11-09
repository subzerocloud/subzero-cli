import proc from 'child_process';
import fs from 'fs';

export const runCmd = (cmd, params, options, silent) => {
  let p = proc.spawnSync(cmd, params, options);
  if(silent !== true){
    p.output.forEach(v => console.log(v ? v.toString() : ""));
  }
  if(p.status != 0){
    process.exit(p.status);
  }
}

export const fileExists = path => fs.existsSync(path) && fs.statSync(path).isFile();

export const dirExists = path => fs.existsSync(path) && fs.statSync(path).isDirectory();

// options.key from commander returns bool if a value is not specified(e.g. subzero cloud login -u, options.username gives true), so make sure is a string
export const notEmptyString = s => (typeof s == 'string')&&s.trim().length;
