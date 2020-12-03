
# subZero CLI

This tool is meant to be used with the Docker based starter kits for [PostgREST](https://github.com/subzerocloud/postgrest-starter-kit/) and [subZero](https://github.com/subzerocloud/subzero-starter-kit/).

After installing, executing the command in the root of your project will give you this interface.


![subzero-cli](https://raw.githubusercontent.com/wiki/subzerocloud/postgrest-starter-kit/images/postgrest-starter-kit.gif "subzero-cli")


## Features

✓ Convenient interface to view the logs of all stack components<br>
✓ Live code reloading (for SQL/Lua/Nginx configs)<br>
✓ Database schema migration management with auto migration generation using sqitch/migra<br>
✓ Community support on [Slack](https://slack.subzero.cloud/)<br>



## Prerequisites
 ✓ [Docker](https://www.docker.com)
 ✓ [Node.js](https://nodejs.org/en/)



## Install

Use `npm` to install the subzero developer tools
```bash
  npm install --global --production windows-build-tools # windows ONLY!!!
  npm install -g subzero-cli # install the cli
  subzero --help # check it was installed
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
  npm run build && npm unlink subzero && npm link
```


## License

Copyright © 2017-present subZero Cloud, LLC.<br />
This source code is licensed under the [GPLv3](https://github.com/subzerocloud/devtools/blob/master/LICENSE.txt)<br />
The documentation to the project is licensed under the [CC BY-SA 4.0](http://creativecommons.org/licenses/by-sa/4.0/) license.
