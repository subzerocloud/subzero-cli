import program from 'commander';
import {version} from '../package.json';

program
  .version(version)
  .option('-e, --env <path>', 'specify the env file path')

program
  .command('dashboard')
  .description('Open dashboard')
  .action(() => process.env.CMD = 'dashboard');
  //.action(() => runDashboard());

program
  .command('init-migrations')
  .description('Setup sqitch config for migrations')
  .action(() => process.env.CMD = 'init-migrations');
  //.action(() => initMigrations());

program
  .command('add-migration <name>')
  .option("-n, --note [note]", "Add sqitch migration note")
  .description('Adds a new sqitch migration')
  .action((name, options) => {
      process.env.CMD = 'add-migration';
      process.env.CMD_NAME = name;
      process.env.CMD_NOTE = options.note;
  });
  //.action((name, options) => addMigration(name, options.note));

program.parse(process.argv);

//If no command specified
if(program.args.length == 0){
  process.env.CMD = 'dashboard'
}


export {program};