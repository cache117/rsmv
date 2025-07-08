
import { cliArguments, filesource } from "../cliparser";
import * as cmdts from "cmd-ts";
import { CLIScriptFS, CLIScriptOutput } from "../scriptrunner";
import { Mapconfig, runMapRender } from ".";
import { MapRender, MapRenderFsBacked, parseMapConfigObject } from "./backends";
import { MapRect } from "../3d/mapsquare";
import fs from "fs/promises";
import log from '../gazlogger';
import { canvasToImageFile } from "../imgutils";
import { cacheMajors } from "../constants";
import { parse } from "../opdecoder";
import path from "path";
import { applyOverrides } from "./mapoverrides";

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

type MapZone = import('../../generated/mapzones').mapzones;
type MapPaste = import('../../generated/mapzones_pastes').mapzones_pastes & {name?:string};
type MapPasteSqChunk = {
		original_plane: number,
		n_planes: number,
		original_regionX: number,
		original_regionY: number,
		original_chunkX?: number,
		original_chunkY?: number,
		new_plane: number,
		new_regionX: number,
		new_regionY: number,
		new_chunkX?: number,
		new_chunkY?: number,
	};


const boundsToCoordsStr = ([[x1,y1],[x2,y2]]:number[][]):string => {
	return `${Math.floor(x1/64)}.${Math.floor(y1/64)}-${Math.ceil(x2/64)}.${Math.ceil(y2/64)}`
};
const boundsToCoords = ([[x1,y1],[x2,y2]]:number[][]):CoordBounds => {
	let out:CoordBounds = {x1: Math.floor(x1/16), y1:Math.floor(y1/16), x2:Math.ceil(x2/16), y2: Math.ceil(y2/16)};
	out.x1r = x1 - out.x1*16;
	out.y1r = y1 - out.y1*16;
	out.x2r = out.x2*16 - x2;
	out.y2r = out.y2*16 - y2;
	return out;
};
const boundsToCoords2 = ([[x1,y1],[x2,y2]]:number[][]):CoordBounds => {
	let out:CoordBounds = {x1: Math.floor(x1/64)*4, y1:Math.floor(y1/64)*4, x2:Math.ceil(x2/64)*4, y2: Math.ceil(y2/64)*4};
	out.x1r = x1 - out.x1*16;
	out.y1r = y1 - out.y1*16;
	out.x2r = out.x2*16 - x2;
	out.y2r = out.y2*16 - y2;
	return out;
};

const duration_map:Record<number,{id:number,start:number,end?:number,dur?:number}> = {};

const isNotNullUndefOrEmpty = (x:any):boolean => {
	return !(x === null || x === undefined || x === '');
}

const makeBaseMap=(mapid:string, area:MapPaste, zone:MapZone):BaseMap=>{
	let west = 100*64, south = 200*64, north = 0, east = 0;
	let west2 = 100*64, south2 = 200*64, north2 = 0, east2 = 0;
	for (let sq of area.squares) {
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
		for (let ch of area.chunks) {
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
	let out:BaseMap = {
		mapId: parseInt(mapid),
		bounds: [[west,south],[east,north]],
		originalBounds: [[west2,south2],[east2,north2]],
		center: [Math.floor((west+east)/2), Math.floor((south+north)/2)],
		name: isNotNullUndefOrEmpty(area.name) ? area.name! : (zone.name??(zone.internal_name??'UNKNOWN'))
	};
	return out;
};


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
		outdir: cmdts.option({ long: "out", short: "s", type: cmdts.optional(cmdts.string) }),

		rendermap: cmdts.flag({long: 'rendermap'}), //enable to render the map
		domip: cmdts.flag({long: 'domip'}), //enable to do a mip
		mapicons: cmdts.flag({long: 'mapicons'}), //enable to do map with icons
		mapnoicons: cmdts.flag({long: 'mapnoicons'}), //enable to do map without icons
		bm: cmdts.multioption({long:'bm', type:cmdts.optional(cmdts.array(cmdts.number))}),
		debug: cmdts.flag({long:'verbose'})
	},
	handler: async (args) => {
		const sheet = document.createElement('style');
		sheet.innerHTML = 'canvas {background-color:green;margin-bottom:1em;}';
		document.head.appendChild(sheet)
		duration_map[-100] = {id:-100,start:Date.now()};
		globalThis.duration_map = duration_map;
		let output = new CLIScriptOutput();
		//let basemaps:BaseMap[] = JSON.parse(await fs.readFile('extract_map/basemaps.json', 'utf-8'));
		let source = await args.source();
		let onlybasemaps=false;
		let outdir = args.outdir ?? 'extract_map/renders';
		log('ARGUMENTS:', `\noutput folder: ${args.outdir}\nrender map: ${args.rendermap}\nperform mip: ${args.domip}\nmap with icons: ${args.mapicons}\nmap without icons: ${args.mapnoicons}`);
		if ((!args.rendermap && !args.domip) || (!args.mapicons && !args.mapnoicons)) {
			log('So we are just generating basemaps.json');
			onlybasemaps=true;
		} else {
			let str = 'So we are generating basemaps.json, ';
			if (args.rendermap && args.domip) str+='mapping and mipping ';
			else if (args.rendermap) str+='mapping '
			else str+='mipping ';
			if (args.mapicons && args.mapnoicons) str+='both icons and no icons';
			else if (args.mapicons) str+='just icons';
			else str+='just no icons';
			log(str);
		}
		let scriptfs = new CLIScriptFS(outdir);
		await fs.access(outdir);//check if we're allowed to write the outdir
		log('creating basemaps')

		let files = await source.getArchiveById(cacheMajors.worldmap, 0);
		let worldmapzones: {[k:string]:MapZone} = Object.fromEntries(files.map(q => parse.mapZones.read(q.buffer, source))
			.map((q,i)=>[i.toString(),q]));
		let files2 = await source.getArchiveById(cacheMajors.worldmap, 1);
		let worldmappastes = Object.fromEntries(files2.map((q,i)=>[i,parse.mapPastes.read(q.buffer, source)]));
		await applyOverrides(worldmappastes);
			
		await fs.writeFile(path.join(outdir, 'worldmap_zones.json'), JSON.stringify(worldmapzones,null,'\t'));
		await fs.writeFile(path.join(outdir, 'worldmap_pastes.json'), JSON.stringify(worldmappastes,null,'\t'));

		let basemaps:BaseMap[] = Object.entries(worldmappastes).map(([i,e])=>makeBaseMap(i,e,worldmapzones[i] ?? {}));
		let basemap_default:BaseMap = {
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
		duration_map[basemap_default.mapId] = {id:-1, start: Date.now()};
		let config: MapRender;
		let render_out = `map_squares/${basemap_default.mapId}`;
		let render_icons_out = `map_icon_squares/${basemap_default.mapId}`;
		let conf:Mapconfig = {
			//"$schema": "../generated/maprenderconfig.schema.json",
			"tileimgsize": 256,
			"nochunkoffset": true,
			"noyflip": true,
			"mapsizex": 100,
			"mapsizez": 200,
			"area": boundsToCoordsStr(basemap_default.bounds),
			"layers": [] 
		};
		if (args.mapnoicons) {
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
			}
		}
		if (args.mapicons) {
			for (let i=0;i<=3;i++) {
				conf.layers.push({
					"name": render_icons_out,
					"mode": "3d",
					"format": "png",
					"level": i,
					"pxpersquare": 16,
					"dxdy": 0,
					"dzdy": 0,
					"overlaywalls": true,
					"overlayicons": true
				})
			}
		}

		config = new MapRenderFsBacked(scriptfs, parseMapConfigObject(conf));

		if (args.rendermap) {
			await runMapRender(output, source, config, args.force, `rendering mapId ${basemap_default.mapId} - ${basemap_default.name}`);
		}
		duration_map[basemap_default.mapId].end = Date.now();
		duration_map[basemap_default.mapId].dur = duration_map[basemap_default.mapId].end! - duration_map[basemap_default.mapId].start;
		if (args.domip) {
			globalThis.totalToMip = basemaps.reduce((acc,val)=>{
				if (val.mapId === -1 && (args.bm === undefined || args.bm.length === 0 || args.bm.includes(val.mapId))) return acc;
				let bounds = boundsToCoords(val.bounds);
				let working = (bounds.x2-bounds.x1) * (bounds.y2-bounds.y1), working2 = working;
				for (let i=0;i<10;i++) {
					working = Math.ceil(working/4);
					working2 += working;
				}
				return acc + working2;
			},0);
			globalThis.numformat = new Intl.NumberFormat();
			globalThis.totalToMip=globalThis.numformat.format(globalThis.totalToMip);
			log('total to mip', globalThis.totalToMip);
			globalThis.totalMipped = 0;
			globalThis.toNextUpdate = 0;
			const progressDiv = document.createElement('div');
			document.body.prepend(progressDiv);
			globalThis.progressDiv = progressDiv;
			progressDiv.innerText = `${globalThis.totalToMip} things to process!`

			for (let bm of basemaps) {
				if (bm.mapId !== -1 && (args.bm === undefined || args.bm.length === 0 || args.bm.includes(bm.mapId))){
					duration_map[bm.mapId] = {id:bm.mapId, start:Date.now()};
					await gazmip(config, bm, worldmappastes[bm.mapId], {debug:args.debug,noicons:args.mapnoicons,icons:args.mapicons});
					duration_map[bm.mapId].end = Date.now();
					duration_map[bm.mapId].dur = duration_map[bm.mapId].end! - duration_map[bm.mapId].start;
					log(`mapid ${bm.mapId}:`, (new Date(duration_map[bm.mapId].start)).toISOString(), '->', (new Date(duration_map[bm.mapId].end!)).toISOString(), ':::', (duration_map[bm.mapId].dur!/1000).toFixed(1));
				}
			}
		}
		duration_map[-100].end = Date.now();
		duration_map[-100].dur = duration_map[-100].end! - duration_map[-100].start;
		for (let {id,start,end,dur} of Object.values(duration_map).sort((a,b)=>a.id-b.id)) {
			let first:number|string = id;
			if (id === -100) {
				first = 'TOTAL';
			}
			log(first, (new Date(start)).toISOString(), '->', (new Date(end!)).toISOString(), ':::', (dur!/1000).toFixed(1));
		}
	}
});
const progress = (i?:number)=>{
	if (i === undefined) i=1;
	globalThis.totalMipped += i;
	globalThis.toNextUpdate -= i;
	if (globalThis.toNextUpdate <= 0) {
		globalThis.toNextUpdate = 1000;
		globalThis.progressDiv.innerText = `${globalThis.numformat.format(globalThis.totalMipped)}/${globalThis.totalToMip}\n`+globalThis.progressDiv.innerText;
	}
};
const null0 = (x:number|null|undefined):number => {
	if (x === null || x === undefined) return 0;
	return x;
};
const COMBOS = (()=>{
	let arr:number[][] = [];
	for (let i of [0,1,2,3]) {
		for (let j of [0,1,2,3]) {
			arr.push([i,j]);
		}
	}
	return arr;
})();
const gazmip = async (render:MapRender, basemap:BaseMap, mappaste:MapPaste, options:{debug:boolean,icons:boolean,noicons:boolean})=>{
	let originalBounds = boundsToCoords(basemap.bounds);
	log(`mipping mapid ${basemap.mapId}`);
	log(`bounds: ${JSON.stringify(basemap.bounds)}`);
	log(`parsedbounds: ${JSON.stringify(originalBounds)}`);
	const tilesize = render.config.tileimgsize;
	const subtilesize = tilesize / 2;
	const folders:string[]=[];
	if (options.noicons) folders.push('renders2/');
	if (options.icons) folders.push('map_icon_squares/');
	for (let parentfolder of folders) {
		const source = parentfolder+'-1';
		const output = parentfolder+basemap.mapId;
		log('folder', source, '->', output);
		let bigcanvas = [ // layers 0123
			document.createElement('canvas'),
			document.createElement('canvas'),
			document.createElement('canvas'),
			document.createElement('canvas')
		];
		let bigctx = bigcanvas.map(x=>x.getContext('2d', { willReadFrequently: true })!);
		let hasdrawnto=[false,false,false,false];
		let west = originalBounds.x1,
			south=originalBounds.y1,
			east = originalBounds.x2,
			north=originalBounds.y2,
			northr = (originalBounds.y2r??0) / 16 * tilesize; // north remainder, extra space to put at the bottom to round to whole squares
		
		//zoom 2 size bounds - z4 is 4x larger
		// k z2 tiles wide  * 2 (z3) * 2 (z4) * pixel size
		let numtilesw = mappaste.width*4, numtilesh = mappaste.height*4;
		const cnvw = numtilesw * tilesize, cnvh = numtilesh * tilesize;
		log(`west ${west}  south ${south}  east ${east}  north ${north}  northr ${northr}  numtilesw ${numtilesw}  numtilesh ${numtilesh}  cnvw ${cnvw}  cnvh ${cnvh}`)
		bigcanvas.forEach(x=>{
			x.width = cnvw;
			x.height = cnvh;
		});
		bigctx.forEach(x=>{
			x.fillStyle='rgba(0,0,0,0)';
			x.clearRect(0,0,cnvw,cnvh);
			x.fillRect(0,0,cnvw,cnvh);
		});
		for (let sq of mappaste.squares) {
			if (options.debug) log('SQUARE',sq);
			//mapsquare - 16 z4 renders
			// COMBOS: premade array of [0,0], [0,1], ... [3,2], [3,3]
			for (let [xi,yi] of COMBOS) {
				let x = sq.original_regionX*4+xi;
				let y = sq.original_regionY*4+yi;
				let destx = tilesize * (sq.new_regionX*4+xi-west);
				let desty = tilesize * (sq.new_regionY*4+yi-south);
				for (let layer=0;layer<sq.n_planes;layer++) {
					progress(1);
					let oldlayer = sq.original_plane+layer;
					if (oldlayer>3)break;
					let newlayer = Math.min(3,sq.new_plane+layer);
					let sourcefile = render.makeFileName(oldlayer,4,x,y,'png',source);
					if (options.debug) log('SQUARE', oldlayer, xi,yi, sourcefile, x, y, newlayer, destx, desty);
					let res = await render.getFileResponse(sourcefile);
					if (res.status == 200) {
						let bitmap = await createImageBitmap(await res.blob());
						bigctx[newlayer].drawImage(
							bitmap,
							0, //source x
							0, //source y
							tilesize, //source width
							tilesize, //source height
							destx, //dest x
							cnvh-northr*2 - desty, //dest y
							tilesize, //dest width
							tilesize //dest height
						);
						if (options.debug) log('drawing square to', newlayer, destx, cnvh-desty)
						hasdrawnto[newlayer]=true;
					}
				}
			}
		}
		for (let sq of mappaste.chunks) {
			//map chunk - 1/4 of a z4 render
			let x = sq.original_regionX*4 + Math.floor(sq.original_chunkX!/2);
			let y = sq.original_regionY*4 + Math.floor(sq.original_chunkY!/2);
			let destx = (sq.new_regionX*4 + sq.new_chunkX!/2 - west);
			let desty = (sq.new_regionY*4 + sq.new_chunkY!/2 - south);
			for (let layer=0;layer<sq.n_planes;layer++) {
				progress(1);
				let oldlayer = sq.original_plane+layer;
				if (oldlayer>3)break;
				let newlayer = Math.min(3,sq.new_plane+layer);
				let sourcefile = render.makeFileName(oldlayer,4,x,y,'png',source);
				if (options.debug) log('CHUNK', sq, sourcefile, x, y, destx, desty);
				let res = await render.getFileResponse(sourcefile);
				if (res.status==200) {
					let bitmap = await createImageBitmap(await res.blob());
					let sourcex = subtilesize * (sq.original_chunkX! % 2),
						sourcey = subtilesize * (1-(sq.original_chunkY! % 2)),
						destx2 = tilesize*destx,
						desty2 = cnvh-northr - tilesize*(desty);
					if (options.debug) log('drawing chunk: sourcex,sourcey to destx,desty', sourcex, sourcey, destx2, desty2);
					bigctx[newlayer].drawImage(
						bitmap,
						sourcex, //source x
						sourcey, //source y
						subtilesize, //source width
						subtilesize, //source height
						destx2, //dest x
						desty2, //dest y
						subtilesize, //dest width
						subtilesize //dest height
					);
					hasdrawnto[newlayer]=true;
				}
			}
		}
		if (options.debug) document.body.prepend(...bigcanvas);
		//debugger;//return
		// everything drawn to the 4 canvases
		const savingcanvas = document.createElement('canvas');
		savingcanvas.height=tilesize;
		savingcanvas.width=tilesize;
		const savingctx = savingcanvas.getContext('2d', {willReadFrequently:true})!;
		savingctx.fillStyle='rgba(0,0,0,0)';
		if (options.debug) document.body.prepend(savingcanvas);
		for (let layer of [0,1,2,3]) {
			if (!hasdrawnto[layer])continue;
			let cnv:HTMLCanvasElement = bigcanvas[layer],
				ctx:CanvasRenderingContext2D = bigctx[layer],
				westworking = west,
				southworking = south,
				numtilesw2 = numtilesw,
				numtilesh2 = numtilesh;
			for (let zoom=4; zoom>-6; zoom--) {
				for (let x=0;x<cnv.width;x+=tilesize) {
					for (let y=0;y<cnv.height;y+=tilesize) {
						progress(1);
						let outfilename = render.makeFileName(layer, zoom, x/tilesize+westworking, y/tilesize+southworking, 'png', output);
						savingctx.clearRect(0,0,tilesize,tilesize);
						savingctx.drawImage(cnv,x,cnv.height-(y+tilesize),tilesize,tilesize, 0,0,tilesize,tilesize);
						let imgdata = savingctx.getImageData(0,0,tilesize,tilesize);
						let isAllBlack = true;
						for (let i=0;i<imgdata.data.length;i+=4) {
							isAllBlack = imgdata.data[i]===0 && imgdata.data[i+1]===0 && imgdata.data[i+2]===0 && imgdata.data[i+3]===0;
							//imagedata.data is a flat array of r g b a for each pixel
							if (!isAllBlack) break;
						}
						if (isAllBlack){
							if (options.debug) log('ALL BLACK', outfilename, x,cnv.height-(y+tilesize));
						} else {
							//savingctx.drawImage(bitmap,0,0);
							await render.saveFile(outfilename, -1, await canvasToImageFile(savingcanvas,'png',0.9));
							if (options.debug) log('saved', outfilename, x,cnv.height-(y+tilesize));
						}
					}
				}
				if (zoom == -5)break;
				numtilesw2 = Math.ceil(numtilesw2/2);
				numtilesh2 = Math.ceil(numtilesh2/2);
				let newwest = Math.floor(westworking/2);
				let newsouth = Math.floor(southworking/2);
				let westdiff = westworking-newwest*2;
				let southdiff = southworking-newsouth*2;
				const smallercanvas = document.createElement('canvas');
				smallercanvas.width = numtilesw2*tilesize;
				smallercanvas.height = numtilesh2*tilesize;
				if (options.debug) document.body.prepend(smallercanvas);
				const smallerctx = smallercanvas.getContext('2d',{willReadFrequently:true})!;
				let yoffset = 0;
				if (cnv.height/2<smallercanvas.height) {
					yoffset = tilesize/2;
				}
				log('shrinking canvas', smallercanvas.width, smallercanvas.height, newwest, newsouth, westdiff, southdiff, westdiff*tilesize/2, smallercanvas.height-(1-southdiff)*tilesize/2, yoffset);
				//yoffset = smallercanvas.height-(1-southdiff)*tilesize/2;
				smallerctx.drawImage(cnv, westdiff*tilesize/2, yoffset, cnv.width/2, cnv.height/2);
				cnv=smallercanvas;
				ctx=smallerctx;
				westworking = newwest;
				southworking = newsouth;
			}
		}
		if (options.debug) debugger;
	}
};


(async () => {
	let res = await cmdts.runSafely(cmd, cliArguments());
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