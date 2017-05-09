
# Sub0 DevTools

First install the dependencies and build:

```bash
  npm install
  npm run build
```

Then run:

```bash
  npm link
```

This will create a command available in your PATH called ```sub0_devtools```.

Now run ```sub0_devtools``` in the same path as sub0_kickstart where your ```.env``` file is defined to see the UI.

To rebuild and recreate the command do:

```bash
  npm run build && npm unlink sub0_devtools & npm link
```

To create a distributable binary download the module:

```bash
  npm install -g pkg
```

And then do:

```bash
  pkg package.json
```
