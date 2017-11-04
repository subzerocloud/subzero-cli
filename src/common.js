import proc from 'child_process';

export const runCmd = (cmd, params, options, silent) => {
  let p = proc.spawnSync(cmd, params, options);
  if(silent !== true){
    p.output.forEach(v => console.log(v ? v.toString() : ""));
  }
  if(p.status != 0){
    process.exit(p.status);
  }
}
