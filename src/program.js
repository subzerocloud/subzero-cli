import program from 'commander';
import {version} from '../package.json';

program
  .version(version)
  .option('-e, --env <path>', 'specify the env file path')

program
  .command('dashboard')
  .description('Open dashboard')
  .action(() => process.env.CMD = 'dashboard');
  
program
  .command('init-migrations')
  .description('Setup sqitch config for migrations')
  .action(() => process.env.CMD = 'init-migrations');

program
  .command('add-migration <name>')
  .option("-n, --note [note]", "Add sqitch migration note")
  .option("-d, --no-diff", "Add empty sqitch migration (no diff)")
  .description('Adds a new sqitch migration')
  .action((name, options) => {
      process.env.CMD = 'add-migration';
      process.env.CMD_NAME = name;
      process.env.CMD_NOTE = options.note;
      process.env.CMD_DIFF = options.diff;
  });

program.parse(process.argv);
export {program};