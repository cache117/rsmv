# RuneScape Model Viewer (.js)
A RuneScape cache downloader, decoder and model viewer implemented in TypeScript. The tool will download the cache directly from the game servers and decode parts of into usable data and models. 

## Installation
A new-ish version of node.js is needed with native build tools installed (the node.js installer will ask about this).
After that run the following commands in your systems console.

```sh
#install the dependencies
npm i
#compile the native nodejs dependencies for use in electron
npm run buildnative

#build the native/electron files
npm run build
#build the web viewer (currently broken because of local fork of sql.js)
npm run web
```

## Running the viewer
The web viewer needs a server since it uses several API's that aren't allowed on `file://`.
```sh
#use a simple http localhost server
npx http-server dist
#alternatively run a webpack dev server with HMR
npm run hot
```
Both of these options will host the app at http://localhost:8080/assets/index.html

The electron viewer can be opened with
```sh
npm start
```

## Other scripts
Cache extraction tool
```sh
#to dump item ids 0-100
node dist/cli extract  # name of the script
    -o cache           # open NXT cache at default location
    -s cache/items     # where to dump the files
    --mode items       # extraction mode, determines how ids are interpreted and the format of the output
    -i 0-100           # ids of the files to extract

#to download raw data from groups 10-20 of cache index 53 (png textures)
node dist/cli extract
    -o live            # download files directly from jagex game servers
	-s cache/textures
	--mode bin         # dumps the raw file
	-i 53.10-53.20     # some modes use tuples as id, both tuple interpretation and range interpolation depend on mode
```
The are more tools in src/scripts, most are used for testing, they are also in various degrees of completeness.

## Jagex copyrights
Jagex is generally aware of the existence of cache decoding tools like this one and they are extensively used for the runescape wiki. However, in the interest of the games integrity and the future of these tools please do not publicly share leaks or unreleased content found using this tool.

## Todo
* Rewrite RT5 anims (again) in order to convert shear anims to multiple bones
* Figure out the rest of RT7 anims
* Particles and billboards (both RT and RT7)
* Color animations
* DAE exporter? (three.js one doesn't work out of the box)
* properly implement caching, currrently doesn't clear texture/model cache

## Credits
Modern rewrite by Skillbert

Based on downloader/3d viewer by Sahima, ui by [manpaint](https://github.com/manpaint)

2d map based on code by [mejrs](https://github.com/mejrs)

Cache loader based on code by [villermen](https://github.com/villermen)

## Full installation instructions

If you get errors when running `npm i`, make sure to follow all of these steps:

### Windows:
It can help to run any commands in an administrator terminal (cmd or powershell).
- Make sure a sufficiently up-to-date version of node and npm are installed (verified with node v23.0.0 and npm v11.2.0).
- Ensure node-gyp is installed correctly:
  - Install [Chocolatey](https://chocolatey.org/install#individual), if you did not do so during node's installation (run `choco -v` to see if it is installed)
  - Install python and visual studio build environment with `choco install python visualstudio2022-workload-vctools -y` (see https://github.com/nodejs/node-gyp#on-windows)
  - Install node-gyp with `npm install -g node-gyp`
- Install GTK2 (see https://github.com/Automattic/node-canvas/wiki/Installation:-Windows#2-installing-gtk-2)
  - Make sure the contents of the zip are extracted into `C:\GTK`, such that the path looks like (for example) `C:\GTK\bin\libcairo-2.dll`
- You may need to reboot all open terminals to have things take effect properly - may be easier to fully reboot your computer.
- You should now be able to run `npm i`
- Due to changes with sharp, you'll need to downgrade the version. The safest way is to do `npm uninstall sharp` then `npm install sharp@0.30.5`
- Now you can run `npm run buildnative`
- Then run `npm run build`