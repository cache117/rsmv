
import { cliArguments, filesource } from "../cliparser";
import * as cmdts from "cmd-ts";
import { CLIScriptFS, CLIScriptOutput } from "../scriptrunner";
import { Mapconfig, runMapRender } from ".";
import { MapRenderFsBacked, parseMapConfigObject } from "./backends";
import fs from "fs/promises";
import v8 from 'node:v8';
import log from '../loggerwithtime';
import { canvasToImageFile, pixelsToDataUrl } from "../imgutils";
import { cacheMajors } from "../constants";
import { parse } from "../opdecoder";
import path from "path";
import { applyOverrides,mapzones_pastes_override } from "./mapoverrides";
import {env} from "node:process";
import { quests } from "../../generated/quests";
import { parseSprite } from "../3d/sprite";
import { MapLabelLocation, readMapLabelLocations, range, coordRange, makeCombinations, isAllBlack } from "../utils2";

type BaseMap = {
	mapId:number,
	bounds:[[number,number],[number,number]],
	originalBounds:[[number,number],[number,number]],
	center?: [number,number],
	name:string
};
type CoordBounds = {
	x1: number,
	x1r?: number,
	y1: number,
	y1r?: number,
	x2: number,
	x2r?: number,
	y2: number,
	y2r?: number,
};

type MapIconImageConfig = {
	id:number,
	src:string,
	width:number,
	height:number,
	uses:{x:number, z:number, regionX?:number, regionY?:number, layer?:number}[]
};
type MapIconImage = {
	id:number,
	image:HTMLImageElement
};

type MapZone = import('../../generated/mapzones').mapzones;
type MapPaste = mapzones_pastes_override;

const skipLabelIds = [
	709, // yellow dot
	920, // red dot
	1216 // my marker
];
const skipDataSrcs = [
	"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABUAAAAZCAYAAADe1WXtAAAAAXNSR0IArs4c6QAABYNJREFUSEuFlXlMFFccx787e8zushwrp6K43Hhi7UqKCkWtVYNShSpqqa1Gi1apRv/SVNFIq6auTaOmNW0DilJaFW09iIpaREERMR5YCnIsl7Cw970zzDYzHEE8OslM5vfy3ud9f+/9vu/x8PqHACAFMKL/Zf/5AGgAVgB6ADoAdgDMcARvWAMbSwCM3r5+2vt7sqavEIr4EwH4ABAAcAIwWM32Rzk/Pziz/8fKWwDa+uHuAdZQKPvvHRnmrXx6cXWOgKDj4NLybHYrzDZqcG5PqRBSiQdontgNNyonLiz6ur7FWAXACIADD4X6LF+gmJenWnyE51T7aQ0OlJa9wJ3bWjQ22mAyuuDlLUJYmBQzZvpi/hw/SKWeLKXn8x0PNxUWN19hsxgKlQYHyt5rKllaQFnVgY9r9VAdakfnCzuEfHZ5gUWnDShK9RpUHBUlxrYtCijGeLJtXeOTb61Ua+m7AGysUnZUuO7esuM8WhdfW6/F3pwW8L1jYGl/OgiZecKAm5/0QdmJZMETQVL12LNzLIJH8mG391aMnHv/MwANLFS2JSNiefYGxTGDroPYsbsLFsQgbtdfuHtwHUySSRBErEDcgmgUF12Cd/t9BDkfQ7HxF9QeSIG/uA7fZAewczE5v3ZlHv29p5CFhrReTcwVQDv7cokeJ0+wFQNII+cgdNMfaHikh9XJR3ySHFcvVyFIrkB4rBxNR5bBWHuNU735SzmmvsuH1eK8MS69bTULje24Nu2K1dgeqDrsQOvzvsowTfgKotg1UEwYg+aaVigTQ3D35r+ImBzFxaYqFWT/HOf6KqeIkZUlY6GaceltH7LQ+KYL42+YjJ3ivTt5sLv6almffB2M2B8eJMOBJRIGegOBtppn0DpMIJ0WBJWkc329vAgcOOgDvV7vis3QzWKhCY3nQ0t1PV287GwSPru0L/lBTPaFDidAsx92ZwVCEIK+qmBoBqZv/XH4qA90PV1QrrUlstDp9WdG/W00GIQqlQQmEwNbL4OOhMOAZzCkpBcUinGgXW7w4EJzYwXsFAXCacaosiwO7CsRYN93JIwGA6Vca0tioVOefB9/lXaa/PMvmtDcYoOzl4Em6lMQkzIR4B+CptYnGOMXiecttxET/QEXS+oLEVCXz0GjQ2VYnTYaBp2mO2FvA7emYx/sn5JLgJpV/cyK4jIz15EXkgjzjDy09dTAZNFhvCIBT+ovQeYZiLCgySDKMkGqS0HwgbTkUMSMtqPLSN2cv6+O233Zmul+K7JSAo9RDgfv5AUHOplwGJLywK/YDI1wJCxBMxEa+RHqagog1z1EAPUCtrh98LqTiVA0Y11GCKuS+em6fv2pct1vA46KqNwdkQ+448xWFwou0tBIw8B0PuNUS0QENKn18CwMB8knOHVOr2hIHGpkrYoASbWh20zfS1apVwF4PnCgSBUBgoT8TEUByXeP0GjdOFtsgbm3FySvb5cbFlbD9+xkDioREBCTAixLC4Vc0IVuM6XbmN+xsllDlw14n1tCAPI0pXTx1nnyH9gl0ZtInCuxg6F64WL6DGGnmVeAGjNlyS3t2Xy2yna+//B2Dz36WEm+qVOlSzbO9lWJSUamNQLFN3rh6DcECx9QKHOroTXCmleu31pUbTsHgC1wzjnDT/5B8IYk8pBYJPTQW4SDYLGIQErKGHjxO9BttFtPlDteAb4OyhmGVbx0qnDJF0myQyI+PIx2KUoqgAVzR0EGNbQW2nqq3Lz1dDX1ksIBKw5XOtD+CpgQjwDj0EFvdVlz77i2/fmIKhqa8lBvvwk6qPhjpTA1I06kAuDhohjrqUr6rcA3pT90Uk5xmlK4KP0dwfaCe/T+84+pCwB6Xnc1/1/6w8HsPeLRf+eb3gZkB/4HfXJboe/tSU4AAAAASUVORK5CYII=", // quest icon (started/complete)
	"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABUAAAAaCAYAAABYQRdDAAAAAXNSR0IArs4c6QAABX1JREFUSEuF1QtMU1ccBvCP8iqFyqMttLRAkaIiVlZRNCBWMt2Yc4zBnCJEnToTX8k2zaZOowbjtmRbFhWNTJZhQJyvqDOMRRJeShAEVBQEChTaroVSKF5KWx5lOVdaAdGdpOm9t\+f/O985t/ceJ8zcnAC4AvAAwJw4ZgCwARgBYAFgnjgen06Q4smNnLsAmLV93fyo7RtknwUJ2PEYHw8EnLyA8UHASavSUeUXLtdfuXC18TGAFwBGATjwySg5ZooDOSGXT71/IkgwK9loUDk3Pe9FZ7fRMXBIgA8i5nHhwwkaU2mpW\+v3FR3u7DQoJ9LT8GSUmbBMHPXHD7EFg0ZNaFGFDrWaMIgXfQHx7AVg\+fhgyGiEsv0plHW/IVrYhsR4Prx8hB1bDlSmlVQpSWqyLA7UlcfjhZTmxBRSlDE855YRwfJfIF2agD5tD/qVnRilTHBhe8JXHAI/gT8aHpSgq\+xrbPvYBwIeqzUuvfxDtd5KEo\+QpOTjV5Uflw0ghYBRqX/ChxOAxttF6Fd2wVccDGcvT4wNmhzn85MS6eQ1V5JpGMCNZen3dwDoI6BbyrvcuMy9kcVFFTqGIeAHSCKWoCavAL4BfNiLKW0P2AJ/ehnowbp1WJKRBkVTDTjdB8hS2I5mPX/v2t3uCoJ6F5\+b8yvgtOX3sjCs2Z6L\+oLrsLm5QLomkcYpfY/jRrF5/jTWUFgExvAoZGmpKLywGVvlbeQPkLtqZ8uXBOU/yheWNChG5lVajmNOeCxq8/KwYtcO1F\+9Ca1aCUEQE\+/EiPCoWg2tygKBSAzZumSUn81GdEYGWlorEcs8igUS1xZZukZO0KDqbL\+G4jqL99jCuxhWd6O3rQ2S5bGouHyJBg9lbkbDk2eQLozEySO5NBy/YSMU9yrBDQuDmygAzk9W44N4X5MsXRNB0JDqbL/24joLY3xxGXprH2PQbAY/UIj6f\+4gLjEUs8MDcSgzCyeP7EZ767\+oKmlGZHIq9I1qeHl4gBsdBaeHcqxaxETMjr5Qgoqrs/06iussoGbfxqBagwGFAsKVclTn5cCfz8Leb1PQ8LgF0qg5OP3jDfTohhCTsQ2a0jJ4SyTwEgnBbk\+aitaejOioUphwn/kVQsRSGlu8eTeabxTA0KuFH4eFeTIentfr0WcYAocrwNyUNDzMzaLx1ie1SHDLwjKJJ6IPNb1MStCmbgZOlPpj457TqL16kb7bofLVUBbepOHhYQvc3Jg0KF6TjI6yu3Sf6HWbcOnMXhxe2YOIANtUdMA0gk/P9eGTz4\+DGyijU3jxg2jYTFGw6TRg8IXwYLNpcFCngnT9VvRonuJ6zkH8vV8Eb0/XV2jN8bAOMmrSeSs9etKmU3Rx453rGNB1wZsfDA/2LJipF47z\+WtTMWaz4Nq5nXgx0I/Sb/h07ZKjbS\+nb0fTLtpgMpPXJZCQvA/Bc5ejX6uCQd2KkR4DXP054IjC4SsIQlfzPZTc/JkGSXsran90CO7NC8cCaSINkeRkGcgATxuKoFJUw93dne5utVpfR\+8f5Hcw2b5Yn0O/uRzNntpqGZp5f5i4StDy74JhofoR973u5fTtqAtb6ChuNVM4cP7VM28fgHRgMkzITA2EVCJw9B\+lNFNQ/l97eNoh67CjA8vdDX5sZ3QMcXDszquUBPb0cMWxtSyEsgzoo8Ywve6jM3oBvYUAIC9E8k0aQy5xjtyV4JUj4nrwpsN2UN1r1p8tGdxWphh7NrEhklqyfsbpGx/5gVxjycNdYnet9MyfDBNQ5KpG9wD0Z0tN6WWto5UAyFSm7Kgzoa/BAd7g2dx5YFj1/wvai990Z6ckBsAD3p7QDr0p6eTfWSvmuixNj3b\+Kb92bH958\+iDmaY8Odl/Bct35SHapHwAAAAASUVORK5CYII=", // lodestone (trimmed?)

]

const CANVAS_TRUE_MAX_SIZE = 16000,
boundsToCoordsStr = ([[x1,y1],[x2,y2]]:number[][]):string => {
	return `${Math.floor(x1/64)}.${Math.floor(y1/64)}-${Math.ceil(x2/64)}.${Math.ceil(y2/64)}`
},
boundsToCoords = ([[x1,y1],[x2,y2]]:number[][]):CoordBounds => {
	const out:CoordBounds = {x1: Math.floor(x1/16), y1:Math.floor(y1/16), x2:Math.ceil(x2/16), y2: Math.ceil(y2/16)};
	out.x1r = x1 - out.x1*16;
	out.y1r = y1 - out.y1*16;
	out.x2r = out.x2*16 - x2;
	out.y2r = out.y2*16 - y2;
	return out;
},
boundsToCoords2 = ([[x1,y1],[x2,y2]]:number[][]):CoordBounds => {
	const out:CoordBounds = {x1: Math.floor(x1/64)*4, y1:Math.floor(y1/64)*4, x2:Math.ceil(x2/64)*4, y2: Math.ceil(y2/64)*4};
	out.x1r = x1 - out.x1*16;
	out.y1r = y1 - out.y1*16;
	out.x2r = out.x2*16 - x2;
	out.y2r = out.y2*16 - y2;
	return out;
},
duration_map:Record<number,{id:number,start:number,end?:number,dur?:number}> = {},
isNotNullUndefOrEmpty = (x:any):boolean => {
	return !(x === null || x === undefined || x === '');
},
makeBaseMap=(mapid:string, area:MapPaste, zone:MapZone):BaseMap=>{
	let west = 100*64, south = 200*64, north = 0, east = 0,
		west2 = 100*64, south2 = 200*64, north2 = 0, east2 = 0;
	for (const sq of area.squares) {
		west = Math.min(west, 64*sq.new_regionX);
		south = Math.min(south, 64*sq.new_regionY);
		east = Math.max(east, 64*(1+sq.new_regionX));
		north = Math.max(north, 64*(1+sq.new_regionY));
		west2 = Math.min(west2, 64*sq.original_regionX);
		south2 = Math.min(south2, 64*sq.original_regionY);
		east2 = Math.max(east2, 64*(1+sq.original_regionX));
		north2 = Math.max(north2, 64*(1+sq.original_regionY));
	}
	if (area.chunks) {
		for (const ch of area.chunks) {
			west = Math.min(west, 64*ch.new_regionX + 8*ch.new_chunkX);
			south = Math.min(south, 64*ch.new_regionY + 8*ch.new_chunkY);
			east = Math.max(east, 64*ch.new_regionX + 8*(1+ch.new_chunkX));
			north = Math.max(north, 64*ch.new_regionY + 8*(1+ch.new_chunkY));
			west2 = Math.min(west2, 64*ch.original_regionX + 8*ch.original_chunkX);
			south2 = Math.min(south2, 64*ch.original_regionY + 8*ch.original_chunkY);
			east2 = Math.max(east2, 64*ch.original_regionX + 8*(1+ch.original_chunkX));
			north2 = Math.max(north2, 64*ch.original_regionY + 8*(1+ch.original_chunkY));
		}
	}
	const out:BaseMap = {
		mapId: parseInt(mapid),
		bounds: [[west,south],[east,north]],
		originalBounds: [[west2,south2],[east2,north2]],
		center: [Math.floor((west+east)/2), Math.floor((south+north)/2)],
		name: isNotNullUndefOrEmpty(area.name) ? area.name! : (zone.name??(zone.internal_name??'UNKNOWN'))
	};
	return out;
},
coordintToCoord = (x:number) => {
	const gamey = x % 16384,
		gamex = Math.floor(x / 16384) % 16384,
		layer = Math.floor(Math.floor(x / 16384) / 16384);
	return {
		regionX: Math.floor(gamex/64),
		regionY: Math.floor(gamey/64),
		x: gamex % 64,
		z: gamey % 64,
		layer: layer
	};
}

const cmd = cmdts.command({
	name: "download",
	args: {
		...filesource,
		classicFiles: cmdts.option({ long: "classicfiles", type: cmdts.optional(cmdts.string) }),
		builds: cmdts.option({ long: "builds", type: cmdts.optional(cmdts.string) }),
		ascending: cmdts.flag({ long: "ascending", short: "a" }),
		force: cmdts.flag({ long: "force", short: "f" }),
		ignorebefore: cmdts.option({ long: "ignorebefore", type: cmdts.optional(cmdts.string) }),
		//fs
		configfile: cmdts.option({ long: "config", short: "c", type: cmdts.optional(cmdts.string) }),
		outdir: cmdts.option({ long: "out", short: "s", type: cmdts.optional(cmdts.string) }),

		rendermap: cmdts.flag({long: 'rendermap'}), //enable to render the map
		domip: cmdts.flag({long: 'domip'}), //enable to do a mip
		domipdef: cmdts.flag({long:'domipdef'}),
		bm: cmdts.multioption({long:'bm', type:cmdts.optional(cmdts.array(cmdts.number))}),
		bmfrom: cmdts.option({long:'bmfrom', type:cmdts.optional(cmdts.number)}),
		debug: cmdts.flag({long:'verbose'}),
		verydebug: cmdts.flag({long:'veryverbose'}),
		nosave: cmdts.flag({long:'nosave'})
	},
	handler: async (args) => {
		console.log(JSON.stringify(v8.getHeapStatistics()));
		duration_map[-100] = {id:-100,start:Date.now()};
		globalThis.duration_map = duration_map;
		let onlybasemaps=false;
		console.log(env);
		const sheet = document.createElement('style'),
			output = new CLIScriptOutput(),
			source = await args.source(),
			outdir = args.outdir === undefined ? (env.npm_package_config_mapping_outdir === undefined ? 'extract_map/renders' : env.npm_package_config_mapping_outdir) : args.outdir,
			verbosity = args.debug ? (args.verydebug ? 2 : 1) : 0,
			basemapidstodo:number[] = [];
		sheet.innerHTML = 'canvas {background-color:black;margin-bottom:1em;} #mipprogressdiv {display:flex;} #mipprogressdiv div {white-space:pre-line;} #mipprogress-nodes:before {content:"NODE PROGRESS"} #mipprogress-msgs:before {content:"MESSAGES"} canvas.bigcanvas{zoom:10%;}';
		document.head.appendChild(sheet)
		log('ARGUMENTS:', `\noutput folder: ${outdir}\nrender map: ${args.rendermap}\nperform mip: ${args.domip}`);
		if ((!args.rendermap && !args.domip && !args.domipdef)) {
			log('So we are just generating basemaps.json');
			onlybasemaps=true;
		} else {
			let str = 'So we are generating basemaps.json, ';
			if (args.rendermap && args.domip) str+='mapping and mipping ';
			else if (args.rendermap) str+='mapping '
			else str+='mipping ';
			if (args.domipdef) str+=' ALSO adding icons to -1';
			log(str);
		}
		if (args.debug) {
			log('DEBUG MODE');
			if (args.verydebug) {
				log('VERY DEBUG');
			}
			if (args.nosave) {
				log('NO SAVING');
			}
		}
		if (outdir===undefined)debugger;
		const scriptfs = new CLIScriptFS(outdir);
		await fs.access(outdir);//check if we're allowed to write the outdir
		log('creating basemaps')

		const files = await source.getArchiveById(cacheMajors.worldmap, 0),
			worldmapzones: {[k:string]:MapZone} = Object.fromEntries(files.map(q => parse.mapZones.read(q.buffer, source)).map((q,i)=>[i.toString(),q])),
			files2 = await source.getArchiveById(cacheMajors.worldmap, 1),
			worldmappastes:{[k:string]:mapzones_pastes_override} = Object.fromEntries(files2.map((q,i)=>[i,parse.mapPastes.read(q.buffer, source)]));
		await applyOverrides(worldmappastes);
		const questIcon = parseSprite(await source.getFileById(cacheMajors.sprites, 21017)),
			questIconSrc = await pixelsToDataUrl(questIcon[0].img), questIconWidth = questIcon[0].img.width, questIconHeight = questIcon[0].img.height,
			questfiles = await source.getArchiveById(cacheMajors.config, 35),
			quests:quests[] = questfiles.map(q=>parse.quest.read(q.buffer, source)),
			queststartcoords=quests.map(q=>{
				const out:{regionX:number,regionY:number,x:number,z:number}[] = [];
				if (q.start_location_path) {
					for (const coordint of q.start_location_path) {
						out.push(coordintToCoord(coordint));
					}
				}
				if (q.alternate_quest_start) {
					out.push(coordintToCoord(q.alternate_quest_start));
				}
				return out;
			}).flat(),
			questIconLocs:MapIconImageConfig = {
				id: 21021,
				src: questIconSrc,
				width: questIconWidth,
				height: questIconHeight,
				uses: queststartcoords
			};

			
		await fs.writeFile(path.join(outdir, 'worldmap_zones.json'), JSON.stringify(worldmapzones,null,'\t'));
		await fs.writeFile(path.join(outdir, 'worldmap_pastes.json'), JSON.stringify(worldmappastes,null,'\t'));
		await fs.writeFile(path.join(outdir, 'questicon_locs.json'), JSON.stringify(questIconLocs,null,'\t'));

		const maplabellocations = await readMapLabelLocations(source);
		await fs.writeFile(path.join(outdir, 'map_label_locations.json'), JSON.stringify(maplabellocations,null,'\t'));
		
		//if (maplabellocations)return;
		const basemaps:BaseMap[] = Object.entries(worldmappastes).map(([i,e])=>makeBaseMap(i,e,worldmapzones[i] ?? {})),
			basemap_default:BaseMap = {
				mapId: -1,
				bounds: [[0,0],[100*64,200*64]],
				originalBounds: [[0,0],[100*64,200*64]],
				center: [50*64,100*64],
				name: 'Default'
			};
		basemaps.unshift(basemap_default);

		await fs.writeFile(path.join(outdir, 'basemaps.json'), JSON.stringify(basemaps,null,'\t'));
		log('basemaps done');
		if (onlybasemaps) {
			return;
		}
		if (args.bmfrom !== undefined) {
			basemaps.forEach(v=>{if (v.mapId>=args.bmfrom!) basemapidstodo.push(v.mapId)});
		}
		if (!(args.bm === undefined || args.bm.length===0)) {
			args.bm.forEach(v=>{if (!basemapidstodo.includes(v)) basemapidstodo.push(v);});
		}
		if (args.bmfrom === undefined && (args.bm===undefined || args.bm.length === 0)) {
			basemaps.forEach(v=>{if (v.mapId!==-1) basemapidstodo.push(v.mapId)});
		}
		duration_map[basemap_default.mapId] = {id:-1, start: Date.now()};
		const render_out = `map_squares/${basemap_default.mapId}`,
			render_icons_out = `map_icon_squares/${basemap_default.mapId}`,
			conf:Mapconfig = {
				//"$schema": "../generated/maprenderconfig.schema.json",
				"tileimgsize": 256,
				"nochunkoffset": true,
				"noyflip": true,
				"mapsizex": 100,
				"mapsizez": 200,
				"area": boundsToCoordsStr(basemap_default.bounds),
				"layers": [] 
			};
		for (let i=0;i<=3;i++) {
			conf.layers.push({
				"name": render_out,
				"mode": "3d",
				"format": "png",
				"level": i,
				"pxpersquare": 16,
				"dxdy": 0,
				"dzdy": 0,
				"overlaywalls": true,
				"overlayicons": false
			}) 
			conf.layers.push({
				"name": `maplabels/${i}`,
				"mode": "maplabels",
				"level": i,
				"pxpersquare": 1,
				"usegzip":false
			})
		}

		const config = new MapRenderFsBacked(scriptfs, parseMapConfigObject(conf));

		if (args.rendermap) {
			await runMapRender(output, source, config, args.force, `rendering mapId ${basemap_default.mapId} - ${basemap_default.name}`);
		}
		duration_map[basemap_default.mapId].end = Date.now();
		duration_map[basemap_default.mapId].dur = duration_map[basemap_default.mapId].end! - duration_map[basemap_default.mapId].start;
		let opts = {
			verbosity:verbosity,
			nosave:args.debug&&args.nosave,
			questIconLocs:questIconLocs,
			maplabellocs:maplabellocations
		};
		if (args.domip) {
			globalThis.totalToMip=0;
			globalThis.mipLenMap={};
			for (const [mapId,val] of Object.entries(worldmappastes)) {
				if (mapId === '-1')continue;
				if (!basemapidstodo.includes(parseInt(mapId))) continue;
				let total = 0, h = val.height*4, w=val.width*4;
				total+=(h*w);
				for (let z=4; z>-6; z--) {
					h = Math.ceil(h/2);
					w = Math.ceil(w/2);
					total+=(h*w);
				}
				total*=2;
				if (val.squares) {
					for (const sq of val.squares) {
						total += Math.max(1, sq.n_planes)*16;
					}
				}
				if (val.chunks) {
					for (const chunk of val.chunks) {
						total += Math.max(1, chunk.n_planes);
					}
				}
				globalThis.mipLenMap[mapId] = total;
				globalThis.totalToMip+=total;
			}
			globalThis.numformat = new Intl.NumberFormat();
			globalThis.totalToMip=globalThis.numformat.format(globalThis.totalToMip);
			log('total to process', globalThis.totalToMip);
			globalThis.totalMipped = 0;
			globalThis.toNextUpdate = 0;
			const progressDiv = document.createElement('div'),
				progressDiv2=document.createElement('div'),
				progressDivW=document.createElement('div');
			progressDiv.id = 'mipprogress-nodes';
			progressDiv2.id = 'mipprogress-msgs';
			progressDivW.id = 'mipprogressdiv';
			progressDivW.append(progressDiv,progressDiv2);
			document.body.prepend(progressDivW);
			globalThis.progressDiv = progressDiv;
			globalThis.progressDiv2 = progressDiv2;
			progressDiv.innerText = `\n${globalThis.totalToMip} things to process!`
			progress2('Starting mip');
			for (const bm of basemaps) {
				if (basemapidstodo.includes(bm.mapId)) {
					progress2(`mipping mapID=${bm.mapId}, ${globalThis.mipLenMap[bm.mapId]} nodes`);
					duration_map[bm.mapId] = {id:bm.mapId, start:Date.now()};
					await mipMapID(config, bm, worldmappastes[bm.mapId], opts);
					duration_map[bm.mapId].end = Date.now();
					duration_map[bm.mapId].dur = duration_map[bm.mapId].end! - duration_map[bm.mapId].start;
					log(`mapid ${bm.mapId}:`, (new Date(duration_map[bm.mapId].start)).toISOString(), '->', (new Date(duration_map[bm.mapId].end!)).toISOString(), ':::', (duration_map[bm.mapId].dur!/1000).toFixed(1));
					progress2(`Finished mipping ${bm.mapId}, took ${(duration_map[bm.mapId].dur!/1000).toFixed(1)} seconds`)
				}
			}
		}
		if (args.domipdef) {
			await iconsAndMipDefault(config, 256, opts);
		}
		duration_map[-100].end = Date.now();
		duration_map[-100].dur = duration_map[-100].end! - duration_map[-100].start;
		for (const {id,start,end,dur} of Object.values(duration_map).sort((a,b)=>a.id-b.id)) {
			let first:number|string = id;
			if (id === -100) {
				first = 'TOTAL';
			}
			log(first, (new Date(start)).toISOString(), '->', (new Date(end!)).toISOString(), ':::', (dur!/1000).toFixed(1));
		}
		//progress2('Finished!');
	}
});
const progress = (i?:number, forceupdate?:boolean)=>{
	if (i === undefined) i=1;
	globalThis.totalMipped += i;
	globalThis.toNextUpdate -= i;
	if (globalThis.toNextUpdate <= 0 || forceupdate) {
		globalThis.toNextUpdate = 1000;
		globalThis.progressDiv.prepend(`\n${globalThis.numformat.format(globalThis.totalMipped)}/${globalThis.totalToMip}`);
	}
},
progress2 = (txt:string)=>{
	globalThis.progressDiv2.prepend(`\n[${(new Date()).toISOString()}] ${txt}`);
};
type CanvasContext = {
	cnv:HTMLCanvasElement,
	ctx:CanvasRenderingContext2D
};
type CanvasContextGrid = CanvasContext[][];
type MultiCanvas = {
	rows:number,
	cols:number,
	width:number,
	height:number,
	grid:CanvasContextGrid
};
const makeCanvas=(w:number,h:number, className?:string):CanvasContext=>{
	const cnv = document.createElement('canvas'),
		ctx = cnv.getContext('2d', {willReadFrequently:true})!;
	if (className) {
		cnv.className=className;
	}
	cnv.width = w;
	cnv.height = h;
	ctx.fillStyle='rgba(0,0,0,0)';
	ctx.clearRect(0,0,w,h);
	ctx.fillRect(0,0,w,h);
	return {cnv,ctx};
},
makeCanvasArray = (maxsize:number, w:number, h:number, className:string):MultiCanvas => {
	const rows = Math.ceil(h/maxsize),
		cols = Math.ceil(w/maxsize),
		arr:CanvasContextGrid = [];
	for (let r=0;r<rows;r++) {
		const row:CanvasContext[] = [],
			rowh = Math.min(maxsize, h-r*maxsize);
		arr.push(row);
		for (let c=0;c<cols;c++) {
			const colw = Math.min(maxsize, w-c*maxsize);
			row.push(makeCanvas(colw,rowh,className));
		}
	}
	return {rows,cols,grid:arr, width:w, height:h};
},
addCanvasTable = (canvases:MultiCanvas):HTMLTableElement => {
	const tbl = document.createElement('table');
	for (const cnvrow of canvases.grid) {
		const tr = document.createElement('tr');
		tbl.prepend(tr);
		for (const cnvcell of cnvrow) {
			const td = document.createElement('td');
			tr.append(td);
			td.append(cnvcell.cnv);
		}
	}
	document.body.prepend(tbl);
	return tbl;
};

type MapArea = {
	canvas: {
		x:number,
		y:number,
		height?:number,
		width?:number,
		row:number, // multi-canvas row/col
		column:number,
		cellx:number,
		celly:number,
		ybot?:number
	},
	map: {
		x:number,
		y:number,
		width?:number,
		height?:number
	}
}
class MapAreaFactory {
	maxsize:number;
	tilesize:number;
	subtilesize:number;
	width:number;
	height:number;
	south:number;
	west:number;
	southremainder:number;
	westremainder:number;
	rawsouth:number;
	rawwest:number;
	rows:number;
	cols:number;
	leftoverheight:number;
	constructor(maxsize:number, tilesize:number, width:number, height:number, west:number, south:number){
		//canvas-related
		this.maxsize=maxsize;
		this.tilesize=tilesize;
		this.subtilesize=this.tilesize/2;
		this.width=width;
		this.height=height;
		this.cols=Math.ceil(this.width/this.maxsize);
		this.rows=Math.ceil(this.height/this.maxsize);

		this.leftoverheight = this.height-this.rows*this.maxsize;

		//map-related
		this.rawsouth=south;
		this.rawwest=west;
		this.south=Math.floor(this.rawsouth);
		this.west=Math.floor(this.rawwest);
		this.westremainder=this.rawwest-this.west;
		this.southremainder=this.rawsouth-this.south;
	}

	getAreaFromMapOffset(x:number,y:number) {
		return this.getAreaFromMap(x+this.west, y+this.south);
	}

	getAreaFromMap(x:number,y:number):MapArea {

		// left edge of the tile is {x} tiles from the left edge. the left edge is set as {west} 
		//    thus the point is {x-west} tiles from the left
		// bottom edge of the tile is {y} tiles from the bottom edge. the bottom edge is set as {south}
		//    as the canvas's y is from the TOP edge, we do {width - (y-south)}
		//    but this is TOP edge of the canvas to BOTTOM edge of tile
		//    so we move 1 tile up {height - (1+y-south)}

		// {col} is just {left/max}, {cellx} is {left % max}
		// {row} is measured from the bottom edge
		const pxfromleft = this.tilesize * (x - this.rawwest),
			pxfrombottom = this.tilesize * (y - this.rawsouth),
			pxfromtop = this.height - pxfrombottom - this.tilesize,
			//row = this.rows-1-Math.floor(pxfrombottom/this.maxsize);
			row = Math.max(0,Math.floor(pxfrombottom/this.maxsize)),
			celly = Math.min(this.height - row*this.maxsize, this.maxsize) - (pxfrombottom % this.maxsize) - this.tilesize;
		return {
			canvas: {
				x: pxfromleft,
				y: pxfromtop,
				ybot: pxfrombottom,
				column: Math.max(0,Math.floor(pxfromleft/this.maxsize)),
				cellx: pxfromleft % this.maxsize,
				row: row,
				celly: celly
				//celly: row === 0 ? pxfromtop : this.maxsize - (pxfrombottom % this.maxsize) - this.tilesize
			},
			map: {
				x:x,
				y:y
			}
		} as MapArea;

	}
	getAreaFromMapChunk(sqx:number,sqy:number, chunkx:number, chunky:number):MapArea {

		// left edge of the tile is {x} tiles from the left edge. the left edge is set as {west} 
		//    thus the point is {x-west} tiles from the left
		// bottom edge of the tile is {y} tiles from the bottom edge. the bottom edge is set as {south}
		//    as the canvas's y is from the TOP edge, we do {width - (y-south)}
		//    but this is TOP edge of the canvas to BOTTOM edge of tile
		//    so we move 1 tile up {height - (1+y-south)}

		// {col} is just {left/max}, {cellx} is {left % max}
		// {row} is measured from the bottom edge
		const pxfromleft = this.tilesize * (sqx + chunkx - this.rawwest),
			pxfrombottom = this.tilesize * (sqy+chunky - this.rawsouth),
			pxfromtop = this.height - pxfrombottom - this.subtilesize,
			//row = this.rows-1-Math.floor(pxfrombottom/this.maxsize);
			row = Math.max(0,Math.floor(pxfrombottom/this.maxsize)),
			celly = Math.min(this.height - row*this.maxsize, this.maxsize) - (pxfrombottom % this.maxsize) - this.subtilesize;
		return {
			canvas: {
				x: pxfromleft,
				y: pxfromtop,
				ybot: pxfrombottom,
				column: Math.max(0,Math.floor(pxfromleft/this.maxsize)),
				cellx: pxfromleft % this.maxsize,
				row: row,
				celly: celly
				//celly: row === 0 ? pxfromtop : this.maxsize - (pxfrombottom % this.maxsize) - this.tilesize
			},
			map: {
				x:sqx+chunkx,
				y:sqy+chunky
			}
		} as MapArea;

	}

	getAreaFromCanvas(x:number,y:number):MapArea {
		const pxfrombottom = this.height - (y+this.tilesize);
		return {
			canvas: {
				x: x,
				y: y,
				column: Math.floor(x/this.maxsize),
				cellx: x % this.maxsize,
				row: Math.floor(y/this.maxsize),
				celly: y % this.maxsize
				//row: Math.floor(pxfrombottom/this.maxsize),
				//celly: pxfrombottom % this.maxsize
			},
			map: {
				x: x/this.tilesize + this.west,
				y: pxfrombottom/this.tilesize+this.south
			}
		} as MapArea;

	}
}

const saveCanvases = (canvases:MultiCanvas):ImageData[] => {
	const savedstate:ImageData[]=[];
	for (const {cnv,ctx} of canvases.grid.flat(1)) {
		savedstate.push(ctx.getImageData(0,0,cnv.width,cnv.height));
	}
	return savedstate;
},
restoreCanvases = (canvases:MultiCanvas, data:ImageData[])=> {
	const flat = canvases.grid.flat(1);
	for (const [i,id] of data.entries()) {
		flat[i].ctx.putImageData(id,0,0);
	}
};



const COMBOS = makeCombinations(0,3,0,3),
COMBOS2 = makeCombinations(0,1,0,1);
const iconImages:{[id:number]:MapIconImage} = {},
getIconImage=async (cnf:MapIconImageConfig):Promise<MapIconImage>=>{
	if (iconImages[cnf.id]) return iconImages[cnf.id];
	const out = {
		id: cnf.id,
		image: new Image(cnf.width, cnf.height)
	};
	out.image.src = cnf.src;
	await out.image.decode();
	iconImages[cnf.id]=out;
	document.body.prepend(out.image);
	return out;
},
getIconImage2=async (id:number, cnf:{src:string,height:number,width:number}):Promise<MapIconImage>=>{
	if (iconImages[id]) return iconImages[id];
	const out = {
		id: id,
		image: new Image(cnf.width, cnf.height)
	};
	out.image.src = cnf.src;
	await out.image.decode();
	iconImages[id]=out;
	document.body.prepend(out.image);
	return out;
};

const mipMapID = async (render:MapRenderFsBacked, basemap:BaseMap, mappaste:MapPaste, options:{verbosity:number,nosave:boolean, questIconLocs:MapIconImageConfig,maplabellocs:MapLabelLocation[]})=>{
	const originalBounds = boundsToCoords(basemap.bounds),
		tilesize = render.config.tileimgsize,
		CANVAS_MAX_SIZE = tilesize * Math.floor(CANVAS_TRUE_MAX_SIZE/tilesize),
		subtilesize = tilesize / 2,
		noiconsfolder = 'map_squares/',
		iconsfolder = 'map_icon_squares/';


		
	log(`mipping mapid ${basemap.mapId}`);
	log(`bounds: ${JSON.stringify(basemap.bounds)}`);
	log(`parsedbounds: ${JSON.stringify(originalBounds)}`);
	for (const layer of [0,1,2,3]) {
		let hasdrawnto=false;
		const source = noiconsfolder+'-1',
			output = noiconsfolder+basemap.mapId,
			iconsoutput = iconsfolder+basemap.mapId,
			numtilesw = mappaste.width*4,
			numtilesh = mappaste.height*4,
			cnvw = numtilesw * tilesize,
			cnvh = numtilesh * tilesize,
			canvases_w = Math.ceil(cnvw/CANVAS_MAX_SIZE),
			canvases_h = Math.ceil(cnvh/CANVAS_MAX_SIZE),
			multicanvas:MultiCanvas = makeCanvasArray(CANVAS_MAX_SIZE, cnvw, cnvh, 'bigcanvas'),
			west = originalBounds.x1,
			south=originalBounds.y1,
			east = originalBounds.x2,
			north=originalBounds.y2,
			mapAreaFactory = new MapAreaFactory(CANVAS_MAX_SIZE, tilesize, cnvw, cnvh, west, south),
			mapIconsUsed:{[id:number]:MapIconImageConfig} = {};
			//mapAreaFactoryChunk = new MapAreaFactory(CANVAS_MAX_SIZE, tilesize/2, cnvw, cnvh, west, south);
		
		for (const mll of options.maplabellocs) {

		}

		log(`making big map, layer ${layer} - total ${canvases_w}x${canvases_h} canvases; ${cnvw}x${cnvh}px`)
		log('folder', source, '->', output);
		log(`west ${west}  south ${south}  east ${east}  north ${north}  numtilesw ${numtilesw}  numtilesh ${numtilesh}  cnvw ${cnvw}  cnvh ${cnvh}`);
		
		for (const sq of mappaste.squares) {
			//if (options.debug) log('SQUARE',sq);
			//mapsquare - 16 z4 renders
			// COMBOS: premade array of [0,0], [0,1], ... [3,2], [3,3]
			const maxlayer = sq.original_plane+sq.n_planes-1,
				newlayer = Math.min(3,sq.new_plane+layer),
				oldlayer = Math.min(3,sq.original_plane+layer);
			try {
				let iconsFrom = {l:sq.original_plane,x:sq.original_regionX,y:sq.original_regionY};
				if (sq.iconsFrom) {
					iconsFrom = sq.iconsFrom;
				}
				const data:MapIconImageConfig[] = JSON.parse(await render.fs.readFileText(`maplabels/${iconsFrom.l}/${iconsFrom.x}-${iconsFrom.y}.json`));
				for (const conf of data) {
					if (skipLabelIds.includes(conf.id) || skipDataSrcs.includes(conf.src)) continue;
					const newuse:MapIconImageConfig['uses'] = [];
					for (const use of conf.uses) {
						newuse.push({
							x: use.x,
							z: use.z,
							regionX: sq.new_regionX,
							regionY: sq.new_regionY
						});
					}
					if (mapIconsUsed[conf.id]) {
						for (const use of newuse) mapIconsUsed[conf.id].uses.push(use);
					} else {
						conf.uses=newuse;
						mapIconsUsed[conf.id]=conf;
					}
				}
				const questuse:MapIconImageConfig['uses'] = [];
				for (const use of options.questIconLocs.uses) {
					if (sq.original_plane === use.layer && sq.original_regionX === use.regionX && sq.original_regionY === use.regionY) {
						questuse.push({
							x: use.x,
							z: use.z,
							regionX: sq.new_regionX,
							regionY: sq.new_regionY
						})
					}
				}
				if (questuse.length>0) {
					if(mapIconsUsed[options.questIconLocs.id]) {
						for (const use of questuse) mapIconsUsed[options.questIconLocs.id].uses.push(use);
					} else {
						mapIconsUsed[options.questIconLocs.id] = {id:options.questIconLocs.id, width:options.questIconLocs.width, height:options.questIconLocs.height, src:options.questIconLocs.src, uses:questuse};
					}
				}
			} catch(e) {
				//nothing
					console.log(e);
					//debugger;
			}
			if (newlayer === layer && oldlayer<=maxlayer) {
				for (const [xi,yi] of COMBOS) {
					const x = sq.original_regionX*4+xi,
						y = sq.original_regionY*4+yi,
						destarea = mapAreaFactory.getAreaFromMap(sq.new_regionX*4+xi,sq.new_regionY*4+yi),
						sourcefile = render.makeFileName(oldlayer,4,x,y,'png',source),
						res = await render.getFileResponse(sourcefile);
					if (options.verbosity>=2) log('SUBSQUARE', oldlayer, xi,yi, sourcefile, x, y, newlayer, destarea);
					if (res.status == 200) {
						const bitmap = await createImageBitmap(await res.blob());
						multicanvas.grid[destarea.canvas.row][destarea.canvas.column].ctx.drawImage(
							bitmap,
							0, //source x
							0, //source y
							tilesize, //source width
							tilesize, //source height
							destarea.canvas.cellx, //dest x
							destarea.canvas.celly, //dest y
							tilesize, //dest width
							tilesize //dest height
						);
						hasdrawnto=true;
					}
				}
			}
			progress(COMBOS.length);
		}
		for (const sq of mappaste.chunks) {
			//map chunk - 1/4 of a z4 render
			progress(1);
			const newlayer = Math.min(3,sq.new_plane+layer),
				maxlayer = sq.original_plane+sq.n_planes-1,
				oldlayer = Math.min(3,sq.original_plane+layer);
			if (newlayer === layer && oldlayer<=maxlayer) {
				try {
					const data:MapIconImageConfig[] = JSON.parse(await render.fs.readFileText(`maplabels/${sq.original_plane}/${sq.original_regionX}-${sq.original_regionY}.json`));
					for (const conf of data) {
						if (skipLabelIds.includes(conf.id) || skipDataSrcs.includes(conf.src)) continue;
						const relevantuses:MapIconImageConfig['uses'] = [];
						for (const use of conf.uses) {
							if ((Math.floor(use.x/8) === sq.original_chunkX && Math.floor(use.z/8)===sq.original_chunkY)) {
								relevantuses.push({
									x: use.x + (sq.new_chunkX - sq.original_chunkX)*8,
									z: use.z + (sq.new_chunkY - sq.original_chunkY)*8,
									regionX: sq.new_regionX,
									regionY: sq.new_regionY
								});
								use.regionX = sq.original_regionX;
								use.regionY = sq.original_regionY;
							}
						}
						conf.uses = relevantuses;
						if (mapIconsUsed[conf.id]) {
							for (const use of conf.uses) mapIconsUsed[conf.id].uses.push(use);
						} else {
							mapIconsUsed[conf.id]=conf;
						}
					}
					const questuse:MapIconImageConfig['uses'] = [];
					for (const use of options.questIconLocs.uses) {
						if (sq.original_plane === use.layer && sq.original_regionX === use.regionX && sq.original_regionY === use.regionY && Math.floor(use.x/8)===sq.original_chunkX && Math.floor(use.z/8)===sq.original_chunkY) {
							questuse.push({
								x: use.x + (sq.new_chunkX-sq.original_chunkX)*8,
								z: use.z + (sq.new_chunkY-sq.original_chunkY)*8,
								regionX: sq.new_regionX,
								regionY: sq.new_regionY
							})
						}
					}
					if (questuse.length>0) {
						if(mapIconsUsed[options.questIconLocs.id]) {
							for (const use of questuse) mapIconsUsed[options.questIconLocs.id].uses.push(use);
						} else {
							mapIconsUsed[options.questIconLocs.id] = {id:options.questIconLocs.id, width:options.questIconLocs.width, height:options.questIconLocs.height, src:options.questIconLocs.src, uses:questuse};
						}
					}
				} catch(e) {
					console.log(e);
					//debugger;
					//nothing
				}
				const x = sq.original_regionX*4 + Math.floor(sq.original_chunkX!/2),
					y = sq.original_regionY*4 + Math.floor(sq.original_chunkY!/2),
					destarea = mapAreaFactory.getAreaFromMap(sq.new_regionX*4 + sq.new_chunkX!/2, sq.new_regionY*4 + sq.new_chunkY!/2),
					//destchunkx = subtilesize * Math.floor(sq.new_chunkX! / 2),
					//destchunky = subtilesize * Math.floor(sq.new_chunkY! / 2),
					sourcex = subtilesize * (sq.original_chunkX! % 2),
					sourcey = subtilesize * (1-(sq.original_chunkY! % 2)),
					sourcefile = render.makeFileName(oldlayer,4,x,y,'png',source),
					res = await render.getFileResponse(sourcefile);
				if (options.verbosity>=2) log('CHUNK', sq, sourcefile, x, y, sourcex, sourcey, destarea);
				if (res.status==200) {
					const bitmap = await createImageBitmap(await res.blob());
					multicanvas.grid[destarea.canvas.row][destarea.canvas.column].ctx.drawImage(
						bitmap,
						sourcex, //source x
						sourcey, //source y
						subtilesize, //source width
						subtilesize, //source height
						destarea.canvas.cellx, //dest x
						destarea.canvas.celly+subtilesize, //dest y
						subtilesize, //dest width
						subtilesize //dest height
					);
					hasdrawnto=true;
				}
			}
		}
		
		log(mapIconsUsed);
		await render.fs.writeFile(`maplabelsjson/${basemap.mapId}/icon_locs_${layer}.json`, JSON.stringify(mapIconsUsed,null,'\t'));
		if (options.verbosity>=1) {
			const tbl = addCanvasTable(multicanvas);
			debugger;
		}
		if (!hasdrawnto) continue;
		const savingcanvasobj = makeCanvas(tilesize,tilesize),
			savingcanvas = savingcanvasobj.cnv,
			savingctx = savingcanvasobj.ctx;
		if (options.verbosity>=1) document.body.prepend(savingcanvas);
		let multicnvs:MultiCanvas = multicanvas,
			westworking = west,
			southworking = south,
			numtilesw2 = numtilesw,
			numtilesh2 = numtilesh;
		for (let zoom=4; zoom>-6; zoom--) {

			const mapAreaFactorySaving = new MapAreaFactory(CANVAS_MAX_SIZE, tilesize, multicnvs.width, multicnvs.height, westworking, southworking);
			let savedstate:ImageData[];
			for (const addIcons of [true,false]) {
				log(`saving zoom ${zoom}`);
				let numsaved=0,numblack=0;
				for (let y=0; y<=numtilesh2; y++) {
					for (let x=0; x<=numtilesw2; x++) {
						progress(1);
						const sourcearea = mapAreaFactorySaving.getAreaFromMapOffset(x,y);
						if (options.verbosity>=2) log('savingcanvas', y,x, sourcearea);
						if (sourcearea.canvas.row >= multicnvs.rows || sourcearea.canvas.column >= multicnvs.cols) continue;
						const cnv = multicnvs.grid[sourcearea.canvas.row][sourcearea.canvas.column],
							outfilename = render.makeFileName(layer, zoom, sourcearea.map.x, sourcearea.map.y, 'png', addIcons ? output : iconsoutput);
						savingctx.clearRect(0,0,tilesize,tilesize);
						savingctx.drawImage(cnv.cnv, sourcearea.canvas.cellx, sourcearea.canvas.celly, tilesize,tilesize, 0,0,tilesize,tilesize);
						const imgdata = savingctx.getImageData(0,0,tilesize,tilesize);
						if (isAllBlack(imgdata)){
							if (options.verbosity>=2) log('ALL BLACK', outfilename);
							numblack++;
						} else {
							//savingctx.drawImage(bitmap,0,0);
							numsaved++;
							if (!options.nosave) await render.saveFile(outfilename, -1, await canvasToImageFile(savingcanvas,'png',0.9), 0);
							if (options.verbosity>=2) log('saved', outfilename);
						}
						if ((numblack + numsaved) % 200 == 0) {
							log(`saved ${numsaved} files; skipped ${numblack} blank files`);
						}
					}
				}
				if (addIcons) {
					const overflowedicons:Record<'west'|'east'|'north',{img:MapIconImage,x:number,y:number}[]>={west:[],north:[],east:[]};
					log('adding icons')
					savedstate = saveCanvases(multicnvs);
					for (const [iconid,iconconf] of Object.entries(mapIconsUsed)) {
						if (iconconf.src === '') continue;
						const iconimg = await getIconImage(iconconf),
							mapAreaFactoryIcon = new MapAreaFactory(CANVAS_MAX_SIZE, tilesize, multicnvs.width, multicnvs.height, westworking, southworking);
						log(`${iconconf.uses.length} uses of ${iconid}`)
						for (const use of iconconf.uses) {
							const area = mapAreaFactoryIcon.getAreaFromMap(use.regionX!*Math.pow(2,zoom-2), use.regionY!*Math.pow(2,zoom-2)),
								offsetX = use.x * Math.pow(2,zoom) - iconconf.width/2,
								offsetY = tilesize - iconconf.height - use.z*Math.pow(2,zoom);
							multicnvs.grid[area.canvas.row][area.canvas.column].ctx.drawImage(
								iconimg.image,
								area.canvas.cellx + offsetX,
								area.canvas.celly + offsetY
							);
							if (options.verbosity>=1) log(`added icon ${iconid} to ${area.canvas.cellx + offsetX},${area.canvas.celly + offsetY}`, area, use);
							const west_overflow = area.canvas.x+offsetX, east_overflow = area.canvas.x + offsetX + iconconf.width - multicnvs.width, north_overflow = area.canvas.y + offsetY;
							if (west_overflow < 0) {
								overflowedicons.west.push({img:iconimg, x:tilesize+west_overflow, y:area.canvas.y+offsetY});
							}
							if (east_overflow > 0) {
								overflowedicons.east.push({img:iconimg, x:east_overflow-multicnvs.width, y:area.canvas.y+offsetY});
							}
							if (north_overflow < 0) {
								overflowedicons.north.push({img:iconimg, x:area.canvas.x+offsetX, y:tilesize+north_overflow});
							}
						}
					}
					if (overflowedicons.west.length>0) {
						const overflow_canvas = makeCanvas(tilesize, multicnvs.height+tilesize);
						//document.body.prepend(overflow_canvas.cnv);
						for (const icon of overflowedicons.west) {
							overflow_canvas.ctx.drawImage(
								icon.img.image,
								icon.x,
								icon.y+tilesize
							);
						}
						for (const tiley of range(0, overflow_canvas.cnv.height/tilesize+1)) {
							const sourcearea = mapAreaFactorySaving.getAreaFromMapOffset(-1,tiley);
							savingctx.clearRect(0,0,tilesize,tilesize);
							savingctx.drawImage(overflow_canvas.cnv, 0, overflow_canvas.cnv.height-tilesize*tiley, tilesize,tilesize, 0,0,tilesize,tilesize);
							const imgdata = savingctx.getImageData(0,0,tilesize,tilesize);
							if (!isAllBlack(imgdata)) {
								const fn = render.makeFileName(layer,zoom,sourcearea.map.x, sourcearea.map.y, 'png', iconsoutput);
								await render.saveFile(fn, -1, await canvasToImageFile(savingcanvas, 'png', 0.9),0);
							}
						}
					}
					if (overflowedicons.east.length>0) {
						const overflow_canvas = makeCanvas(tilesize, multicnvs.height+tilesize);
						//document.body.prepend(overflow_canvas.cnv);
						for (const icon of overflowedicons.east) {
							overflow_canvas.ctx.drawImage(
								icon.img.image,
								icon.x,
								icon.y+tilesize
							);
						}
						for (const tiley of range(0, overflow_canvas.cnv.height/tilesize+1)) {
							const sourcearea = mapAreaFactorySaving.getAreaFromMapOffset(multicnvs.width/tilesize+1,tiley);
							savingctx.clearRect(0,0,tilesize,tilesize);
							savingctx.drawImage(overflow_canvas.cnv, 0, overflow_canvas.cnv.height-tilesize*tiley, tilesize,tilesize, 0,0,tilesize,tilesize);
							const imgdata = savingctx.getImageData(0,0,tilesize,tilesize);
							if (!isAllBlack(imgdata)) {
								const fn = render.makeFileName(layer,zoom,sourcearea.map.x, sourcearea.map.y, 'png', iconsoutput);
								await render.saveFile(fn, -1, await canvasToImageFile(savingcanvas, 'png', 0.9),0);
							}
						}
					}
					if (overflowedicons.north.length>0) {
						const overflow_canvas = makeCanvas(multicnvs.width,tilesize);
						//document.body.prepend(overflow_canvas.cnv);
						for (const icon of overflowedicons.north) {
							overflow_canvas.ctx.drawImage(
								icon.img.image,
								icon.x,
								icon.y
							);
						}
						for (const tilex of range(0, overflow_canvas.cnv.width/tilesize)) {
							const sourcearea = mapAreaFactorySaving.getAreaFromMapOffset(tilex,-1);
							savingctx.clearRect(0,0,tilesize,tilesize);
							savingctx.drawImage(overflow_canvas.cnv, tilex*tilesize, 0, tilesize,tilesize, 0,0,tilesize,tilesize);
							const imgdata = savingctx.getImageData(0,0,tilesize,tilesize);
							if (!isAllBlack(imgdata)) {
								const fn = render.makeFileName(layer,zoom,sourcearea.map.x, sourcearea.map.y, 'png', iconsoutput);
								await render.saveFile(fn, -1, await canvasToImageFile(savingcanvas, 'png', 0.9),0);
							}
						}
					}
					if (options.verbosity>=1) {
						debugger;
					}

				} else {
					log('reverting icons')
					restoreCanvases(multicnvs, savedstate!);
				}

			}
			log(`FINISHED saving ${zoom}`);
			if (zoom == -5) {
				multicnvs.grid.forEach(row=>row.forEach(cell=>cell.cnv.remove()));
				break;
			};
			const newwest = (westworking/2),
				newsouth = (southworking/2),
				westdiff = westworking-Math.floor(newwest)*2,
				southdiff = southworking-Math.floor(newsouth)*2,
				numtilesw_new = Math.ceil(numtilesw2/2),
				numtilesh_new = Math.ceil(numtilesh2/2),
				newwidth = numtilesw_new * tilesize,
				newheight = numtilesh_new * tilesize,
				smallermulticnv = makeCanvasArray(CANVAS_MAX_SIZE, newwidth, newheight, (newwidth>3000||newheight>3000)?'bigcanvas':'');
			if (options.verbosity>=1) log(`oldsize ${multicnvs.width}x${multicnvs.height}px,  ${numtilesw2}x${numtilesh2} tiles; canvases rows=${multicnvs.rows},cols=${multicnvs.cols}`, '  ->  ', `newsize ${smallermulticnv.width}x${smallermulticnv.height},  ${numtilesw_new}x${numtilesh_new} tiles; canvases rows=${smallermulticnv.rows},cols=${smallermulticnv.cols}`, `oldwest ${westworking} -> newwest ${newwest};  oldsouth ${southworking} -> newsouth ${newsouth};  westdiff ${westdiff}, southdiff ${southdiff}`);
			if (multicnvs.rows*multicnvs.cols === 1) {
				// prior we only had one canvas so we can be a little simpler
				const destx = 0,//westdiff * tilesize/2,
					oldcnv = multicnvs.grid[0][0].cnv,
					desty = smallermulticnv.height - oldcnv.height/2;
				smallermulticnv.grid[0][0].ctx.drawImage(
					multicnvs.grid[0][0].cnv,
					//source topleft,size
					0,0,oldcnv.width,oldcnv.height,
					//dest topleft,size
					destx, desty, oldcnv.width/2,oldcnv.height/2

				);
				if (options.verbosity>=1) log('one canvas to one canvas', `old y=0,x=0 - w=${oldcnv.width}px,h=${oldcnv.height}px`, '  ->  ', `new y=0,x=0 - dx=${destx}px,dy=${desty}px`)
			} else {
				// we had multiple canvases before
				// scale 2x2 canvases into 1x1
				for (let ri=0; ri<multicnvs.rows; ri++) {
					const frombottom = CANVAS_MAX_SIZE*ri/2,
						newcnvy = Math.floor(ri / 2);
					//let frombottom = (multicnvs.rows-1-ri) * Math.min(smallermulticnv.height,CANVAS_MAX_SIZE)/2 + southdiff * tilesize/2,
					//	newcnvy =  smallermulticnv.rows-1 - Math.floor((multicnvs.rows-ri-1)/2);
					for (let ci=0; ci<multicnvs.cols; ci++) {
						const oldcnv = multicnvs.grid[ri][ci],
							fromleft = ci * CANVAS_MAX_SIZE/2,
							newcnvx = Math.floor(ci/2),
							newcellx = fromleft % CANVAS_MAX_SIZE + westdiff*tilesize/2,
							newcnv = smallermulticnv.grid[newcnvy][newcnvx],
							newcelly = newcnv.cnv.height - oldcnv.cnv.height/2 - (frombottom % CANVAS_MAX_SIZE);
						newcnv.ctx.drawImage(
							oldcnv.cnv,
							0,0, oldcnv.cnv.width, oldcnv.cnv.height,
							newcellx,newcelly, oldcnv.cnv.width/2, oldcnv.cnv.height/2
						);
						if (options.verbosity>=1) log(`old y=${ri},x=${ci} - w=${oldcnv.cnv.width}px,h=${oldcnv.cnv.height}px`, '  ->  ', `new y=${newcnvy},x=${newcnvx} - dx=${newcellx}px,dy=${newcelly}px`, '  ->  ', `frombottom ${frombottom}, fromleft ${fromleft}`)

					}
				}
			}
			
			if (options.verbosity>=1) log('shrinking canvas', newwidth, newheight, newwest, newsouth, westdiff, southdiff);
			multicnvs.grid.forEach(row=>row.forEach(cell=>cell.cnv.remove()));//remove from dom so they can be GC'd
			multicnvs=smallermulticnv;
			westworking = newwest;
			southworking = newsouth;
			numtilesw2=numtilesw_new;
			numtilesh2=numtilesh_new;
			if (options.verbosity>=1) {
				const tbl = addCanvasTable(multicnvs);
				debugger;
			}
		}
		if (options.verbosity>=1) debugger;
	}
	progress(0,true);
};


const COMBOS3 = makeCombinations(-1,1,-1,1);
const iconsAndMipDefault = async (render:MapRenderFsBacked, tilesize:number, options:{verbosity:number,nosave:boolean, questIconLocs:MapIconImageConfig}) => {
	log('beginning adding icons to -1');
	for (const layer of [0,1,2,3]) {
		log(`beginning layer ${layer}`)
		const iconData:{[xy:string]:{id:number,uses:MapIconImageConfig['uses']}[]} = {}, iconSrcs:{[id:number]:{src:string,height:number,width:number}} = {};
		iconSrcs[options.questIconLocs.id] = {src:options.questIconLocs.src, height:options.questIconLocs.height, width:options.questIconLocs.width};
		//pre-fill with quest icons
		for (const use of options.questIconLocs.uses) {
			if (use.layer===layer) {
				const k = `${use.regionX} ${use.regionY}`;
				if (iconData[k]==undefined) {
					iconData[k]=[];
				}
				iconData[k].push({id:options.questIconLocs.id, uses:[use]})
			}
		}
		for (const {x,y} of coordRange(100,200)) {
			const iconjson:MapIconImageConfig[]|undefined = await(async()=>{try {
					return JSON.parse(await render.fs.readFileText(`maplabels/${layer}/${x}-${y}.json`));
				} catch(e){
					return undefined
				}
			})();
			if (iconjson === undefined) {
				continue;
			}
			const data:{id:number,uses:MapIconImageConfig['uses']}[] = [];
			for (const ic of iconjson) {
				if (ic.src === '') continue;
				if (!iconSrcs[ic.id]) {
					iconSrcs[ic.id] = {
						src:ic.src,
						height:ic.height,
						width:ic.width
					}
				}
				data.push({id:ic.id, uses:ic.uses});
			}
			if (data.length>0) {
				const k = `${x} ${y}`;
				if (iconData[k]==undefined) {
					iconData[k] = data;
				} else {
					iconData[k] = iconData[k].concat(data);
				}
			}
		}
		log(`icons found: ${Object.keys(iconSrcs).length}, tiles applied to ${Object.keys(iconData).length}`)
		const canvas = makeCanvas(tilesize*3,tilesize*3);
		const savingcanvas = makeCanvas(tilesize,tilesize);
		if (options.verbosity>=1) {
			document.body.prepend(document.createElement('br'), canvas.cnv, document.createElement('br'), savingcanvas.cnv);
		}
		for (const zoom of range(3,-7)) {
			log(`adding icons to ${zoom}`);
			const zoompow = Math.pow(2, zoom-2);
			const subtilesize = zoompow * tilesize;
			const gametilesize = 256/64 * zoompow;
			let num_saved=0, num_black=0;
			for (const {x:tileX,y:tileY} of coordRange(Math.ceil(100*zoompow),Math.ceil(200*zoompow))) {
				let hasicon=false;
				canvas.ctx.fillRect(0,0,canvas.cnv.width,canvas.cnv.height)
				canvas.ctx.clearRect(0,0,canvas.cnv.width,canvas.cnv.height);

				for (const [ox,oy] of COMBOS3) {
					if (tileX+ox < 0 || tileY+oy < 0) continue;
					for (const parentfolder of ['map_icon_squares/-1', 'map_squares/-1']) {
						const fn = render.makeFileName(layer,zoom,tileX+ox,tileY+oy,'png',parentfolder),
							res = await render.getFileResponse(fn);
						if (res.status == 200) {
							const bitmap = await createImageBitmap(await res.blob());
							canvas.ctx.drawImage(bitmap, (ox+1)*tilesize, (1-oy)*tilesize);
							if (options.verbosity>=2) log(`loaded ${fn} for ${tileX}+${ox},  ${tileY}+${oy}, dest ${(ox+1)*tilesize}, ${(1-oy)*tilesize}`)
							break;
						}
					}
				}
				const icons_overlapping:{[k:string]:boolean} = {'0 0':true};
				if (zoom>2) {
					const z2tileX = Math.floor(tileX / zoompow),
						z2tileY = Math.floor(tileY / zoompow),
						z2tileXoffset = tileX % zoompow,
						z2tileYoffset = tileY % zoompow;
					const iconinfo = iconData[`${z2tileX} ${z2tileY}`];
					if (iconinfo) {
						for (const icon of iconinfo) {
							for (const use of icon.uses) {
								if (Math.floor(use.x/(64/zoompow))===z2tileXoffset && Math.floor(use.z/(64/zoompow))===z2tileYoffset) {
									hasicon=true;
									const img = await getIconImage2(icon.id, iconSrcs[icon.id]),
										xpos = (1 + (use.x)/(64/zoompow)-z2tileXoffset)*tilesize-img.image.width/2,
										ypos = (2 - (use.z)/(64/zoompow)-z2tileYoffset)*tilesize-img.image.height;
									canvas.ctx.drawImage(img.image,
										xpos,
										ypos
									);
									if (ypos < tilesize) {
										icons_overlapping['0 1']=true;
									}
									if (xpos<tilesize) {
										icons_overlapping['-1 0']=true;
										if (ypos < tilesize) {
											icons_overlapping['-1 1']=true;
										}
									}
									if (xpos+img.image.width>2*tilesize) {
										icons_overlapping['1 0']=true;
										if (ypos < tilesize) {
											icons_overlapping['1 1']=true;
										}
									}
									if (options.verbosity>=2) log(`icon ${icon.id} drawn to ${(1 + use.x/(64/zoompow)-z2tileXoffset)*tilesize-img.image.width/2} ${(2 - use.z/(64/zoompow)-z2tileYoffset)*tilesize-img.image.height}`)
								}
							}
						}
					}
				} else {
					for (const {x:ix,y:iy} of coordRange(1/zoompow,1/zoompow)) {
						const z2tileX = tileX/zoompow+ix, z2tileY = tileY/zoompow+iy;
						const iconinfo = iconData[`${z2tileX} ${z2tileY}`];
						if (iconinfo) {
							for (const icon of iconinfo) {
								for (const use of icon.uses) {
									hasicon=true;
									const img = await getIconImage2(icon.id, iconSrcs[icon.id]),
										xpos = tilesize + ix*subtilesize + use.x/(64/zoompow)*tilesize - img.image.width/2 + gametilesize/2,
										ypos =  tilesize + tilesize - (iy*subtilesize + use.z/(64/zoompow)*tilesize + img.image.height + gametilesize/2);
									canvas.ctx.drawImage(img.image,
										xpos,
										ypos
									);
									if (ypos < tilesize) {
										icons_overlapping['0 1']=true;
									}
									if (xpos<tilesize) {
										icons_overlapping['-1 0']=true;
										if (ypos < tilesize) {
											icons_overlapping['-1 1']=true;
										}
									}
									if (xpos+img.image.width>2*tilesize) {
										icons_overlapping['1 0']=true;
										if (ypos < tilesize) {
											icons_overlapping['1 1']=true;
										}
									}
									if (options.verbosity>=2) log(`icon ${icon.id} drawn to ${(1 + use.x/(64/zoompow))*tilesize-img.image.width/2} ${(2 - use.z/(64/zoompow))*tilesize-img.image.height}`)
								
								}
							}
						}

					}
				}
				for (const [ix,iy] of COMBOS3) {
					if (tileX+ix<0 || tileY+iy<0) continue;
					if (!icons_overlapping[`${ix} ${iy}`])continue;
					savingcanvas.ctx.fillRect(0,0,savingcanvas.cnv.width,savingcanvas.cnv.height)
					savingcanvas.ctx.clearRect(0,0,savingcanvas.cnv.width,savingcanvas.cnv.height);
					savingcanvas.ctx.drawImage(canvas.cnv, (ix+1)*tilesize, (1-iy)*tilesize, tilesize, tilesize, 0,0,tilesize,tilesize);
					const imgdata = savingcanvas.ctx.getImageData(0,0,savingcanvas.cnv.width,savingcanvas.cnv.height);
					const outfile = render.makeFileName(layer, zoom, tileX+ix, tileY+iy, 'png', `map_icon_squares/-1/`);
					if (isAllBlack(imgdata)) {
						num_black++;
					} else {
						await render.saveFile(outfile, -1, await canvasToImageFile(savingcanvas.cnv, 'png', 0.9), 0);
						if (options.verbosity>=2 && hasicon) debugger;
						num_saved++;
					}
					if ((num_saved+num_black)%200 == 0) log(`saved ${num_saved}; black ${num_black}`);
				}
			}
		}
	}
};


(async () => {
	const res = await cmdts.runSafely(cmd, cliArguments());
	let code = 0;
	if (res._tag == "error") {
		log('ERROR', res.error.config.message);
		code = res.error.config.exitCode;
	} else {
		log("cmd completed", res.value);
	}
	if (globalThis.onCliCompleted) {
		globalThis.onCliCompleted(code);
	}
})();