
# subZero CLI

This tool is meant to be used with the Docker based starter kits for [PostgREST](https://github.com/subzerocloud/postgrest-starter-kit/) and [subZero](https://github.com/subzerocloud/subzero-starter-kit/).

After installing, executing the command in the root of your project will give you this interface.


![subzero-cli](https://github.com/subzerocloud/postgrest-starter-kit/blob/master/media/postgrest-starter-kit.gif?raw=true "subzero-cli")


## Features

✓ Convenient interface to view the logs of all stack components<br>
✓ Live code reloading (for SQL/Lua/Nginx configs)<br>
✓ Database schema migration management<br>
✓ Community support on [Slack](https://slack.subzero.cloud/)<br>



## Install

### Dependencies
These dependencies are only used for `migrations` command, you can skip/postpone this if you use just the `dashboard` subcommand.

Follow [sqitch](http://sqitch.org/) install instructions for your system.

```bash
# example for mac
brew tap theory/sqitch
brew install sqitch
```

Download a patched version of [apgdiff](https://github.com/subzerocloud/apgdiff) and set the env var used by `subzero-cli` to find it

```bash
wget -O ~/apgdiff-2.5-subzero.jar \
  https://github.com/subzerocloud/apgdiff/releases/download/2.5.2-subzero/apgdiff-2.5.2-subzero.jar

echo "export APGDIFF_JAR_PATH=~/apgdiff-2.5-subzero.jar" >> ~/.bash_profile
export APGDIFF_JAR_PATH=~/apgdiff-2.5-subzero.jar
```


### cli
Use `npm` to install the subzero developer tools
```bash
  npm install -g subzero-cli
  # check it was installed
  subzero --help
```

## Installing from source

After cloning the repo, run these commands.

```bash
  npm install
  npm run build
  npm link
```

This will create a command available in your PATH called ```subzero```.

To rebuild and recreate the command do:

```bash
  npm run build && npm unlink subzero & npm link
```


## License

Copyright © 2017-present subZero Cloud, LLC.<br />
This source code is licensed under the [GPLv3](https://github.com/subzerocloud/devtools/blob/master/LICENSE.txt)<br />
The documentation to the project is licensed under the [CC BY-SA 4.0](http://creativecommons.org/licenses/by-sa/4.0/) license.
