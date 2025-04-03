
import { cliArguments, filesource } from "../cliparser";
import * as cmdts from "cmd-ts";
import { CLIScriptFS, CLIScriptOutput } from "../scriptrunner";
import { runMapRender } from ".";
import { MapRender, MapRenderDatabaseBacked, MapRenderFsBacked, parseMapConfig } from "./backends";
import { Openrs2CacheSource, openrs2GetEffectiveBuildnr, validOpenrs2Caches } from "../cache/openrs2loader";
import { stringToFileRange } from "../utils";
import { classicBuilds, ClassicFileSource, detectClassicVersions } from "../cache/classicloader";
import path from "path";
import fs from "fs/promises";

let cmd = cmdts.command({
	name: "download",
	args: {
		...filesource,
		classicFiles: cmdts.option({ long: "classicfiles", type: cmdts.optional(cmdts.string) }),
		builds: cmdts.option({ long: "builds", type: cmdts.optional(cmdts.string) }),
		ascending: cmdts.flag({ long: "ascending", short: "a" }),
		force: cmdts.flag({ long: "force", short: "f" }),
		ignorebefore: cmdts.option({ long: "ignorebefore", type: cmdts.optional(cmdts.string) }),
		//remote
		endpoint: cmdts.option({ long: "endpoint", short: "e", type: cmdts.optional(cmdts.string) }),
		auth: cmdts.option({ long: "auth", short: "p", type: cmdts.optional(cmdts.string) }),
		mapid: cmdts.option({ long: "mapid", type: cmdts.optional(cmdts.number) }),
		//fs
		configfile: cmdts.option({ long: "config", short: "c", type: cmdts.optional(cmdts.string) }),
		outdir: cmdts.option({ long: "out", short: "s", type: cmdts.optional(cmdts.string) })
	},
	handler: async (args) => {
		let output = new CLIScriptOutput();
		let basemaps:{mapId:number, bounds:number[][], center:number[], name:string}[] = JSON.parse(await fs.readFile('extract_map/basemaps.json', 'utf-8'));
		basemaps.sort((a,b)=>b.mapId-a.mapId);
		for (let basemap of basemaps){
			//console.log(`rendering mapId ${basemap.mapId} - ${basemap.name}`)
			if (basemap.mapId > 107) continue; 
			let config: MapRender;
			let outdir = args.outdir ?? 'extract_map/renders';
			let configfile = await fs.readFile(`extract_map/mapconfig_${basemap.mapId}.jsonc`, "utf8");
			await fs.access(outdir);//check if we're allowed to write the outdir
			let scriptfs = new CLIScriptFS(outdir);
			config = new MapRenderFsBacked(scriptfs, parseMapConfig(configfile));

			let source = await args.source();
			await runMapRender(output, source, config, args.force, `rendering mapId ${basemap.mapId} - ${basemap.name}`);
		}
	}
});

(async () => {
	let res = await cmdts.runSafely(cmd, cliArguments());
	let code = 0;
	if (res._tag == "error") {
		console.error(res.error.config.message);
		code = res.error.config.exitCode;
	} else {
		console.log("cmd completed", res.value);
	}
	if (globalThis.onCliCompleted) {
		globalThis.onCliCompleted(code);
	}
})();