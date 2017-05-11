
# subZero DevTools

This tool is meant to be used with the Docker based starter kits for [PostgREST](https://github.com/subzerocloud/postgrest-starter-kit/) and [subZero](https://github.com/subzerocloud/subzero-starter-kit/).

After installing, executing the command in the root of your project will give you this interface.


![DevTools](/screenshot.png?raw=true "DevTools")


## Features

✓ Convenient interface to view the logs of all stack components<br>
✓ Live code reloading (for SQL/Lua/Nginx configs)<br>
✓ (soon) Database schema migration tools<br>
✓ Community support on [Slack](https://slack.subzero.cloud/)<br>


## Install binaries
Find the [latest release](https://github.com/subzerocloud/devtools/releases/) version.<br />
Download the binary and place it in your `$PATH`<br />
Sample commands for Mac with the release v0.0.2
```bash
  wget https://github.com/subzerocloud/devtools/releases/download/v0.0.2/subzero_devtools-macos-v0.0.2.gz
  gunzip subzero_devtools-macos-v0.0.2.gz
  chmod +x subzero_devtools-macos-v0.0.2
  mv subzero_devtools-macos-v0.0.2 /usr/local/bin/
  ln -s /usr/local/bin/subzero_devtools-macos-v0.0.2 /usr/local/bin/sz
```

## Installing from source

After cloning the repo, run these commands.

```bash
  npm install
  npm run build
  npm link
```

This will create a command available in your PATH called ```subzero_devtools```.

To rebuild and recreate the command do:

```bash
  npm run build && npm unlink subzero_devtools & npm link
```

To create a distributable binary download the module:

```bash
  npm install -g pkg
```

And then do:

```bash
  pkg package.json --out-dir ./bindist
```

## License

Copyright © 2017-present subZero Cloud, LLC.<br />
This source code is licensed under the [GPLv3](https://github.com/subzerocloud/devtools/blob/master/LICENSE.txt)<br />
The documentation to the project is licensed under the [CC BY-SA 4.0](http://creativecommons.org/licenses/by-sa/4.0/) license.
