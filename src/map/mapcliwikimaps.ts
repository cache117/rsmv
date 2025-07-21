
import { cliArguments, filesource } from "../cliparser";
import * as cmdts from "cmd-ts";
import { CLIScriptFS, CLIScriptOutput } from "../scriptrunner";
import { Mapconfig, runMapRender } from ".";
import { MapRender, MapRenderFsBacked, parseMapConfigObject } from "./backends";
import { MapRect } from "../3d/mapsquare";
import fs from "fs/promises";
import v8 from 'node:v8';
import log from '../loggerwithtime';
import { canvasToImageFile } from "../imgutils";
import { cacheMajors } from "../constants";
import { parse } from "../opdecoder";
import path from "path";
import { applyOverrides } from "./mapoverrides";
import { HemisphereLight } from "three";

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
	const out:BaseMap = {
		mapId: parseInt(mapid),
		bounds: [[west,south],[east,north]],
		originalBounds: [[west2,south2],[east2,north2]],
		center: [Math.floor((west+east)/2), Math.floor((south+north)/2)],
		name: isNotNullUndefOrEmpty(area.name) ? area.name! : (zone.name??(zone.internal_name??'UNKNOWN'))
	};
	return out;
};


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
		mapicons: cmdts.flag({long: 'mapicons'}), //enable to do map with icons
		mapnoicons: cmdts.flag({long: 'mapnoicons'}), //enable to do map without icons
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
		const sheet = document.createElement('style'),
			output = new CLIScriptOutput(),
			source = await args.source(),
			outdir = args.outdir ?? 'extract_map/renders',
			verbosity = args.debug ? (args.verydebug ? 2 : 1) : 0,
			basemapidstodo:number[] = [];
		sheet.innerHTML = 'canvas {background-color:black;margin-bottom:1em;} #mipprogressdiv {display:flex;} #mipprogressdiv div {white-space:pre-line;} #mipprogress-nodes:before {content:"NODE PROGRESS"} #mipprogress-msgs:before {content:"MESSAGES"} canvas.bigcanvas{zoom:10%;}';
		document.head.appendChild(sheet)
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
		if (args.debug) {
			log('DEBUG MODE');
			if (args.verydebug) {
				log('VERY DEBUG');
			}
			if (args.nosave) {
				log('NO SAVING');
			}
		}
		const scriptfs = new CLIScriptFS(outdir);
		await fs.access(outdir);//check if we're allowed to write the outdir
		log('creating basemaps')

		const files = await source.getArchiveById(cacheMajors.worldmap, 0),
			worldmapzones: {[k:string]:MapZone} = Object.fromEntries(files.map(q => parse.mapZones.read(q.buffer, source))
			.map((q,i)=>[i.toString(),q])),
			files2 = await source.getArchiveById(cacheMajors.worldmap, 1),
			worldmappastes = Object.fromEntries(files2.map((q,i)=>[i,parse.mapPastes.read(q.buffer, source)]));
		await applyOverrides(worldmappastes);
			
		await fs.writeFile(path.join(outdir, 'worldmap_zones.json'), JSON.stringify(worldmapzones,null,'\t'));
		await fs.writeFile(path.join(outdir, 'worldmap_pastes.json'), JSON.stringify(worldmappastes,null,'\t'));

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
			basemaps.forEach(v=>basemapidstodo.push(v.mapId));
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

		const config = new MapRenderFsBacked(scriptfs, parseMapConfigObject(conf));

		if (args.rendermap) {
			await runMapRender(output, source, config, args.force, `rendering mapId ${basemap_default.mapId} - ${basemap_default.name}`);
		}
		duration_map[basemap_default.mapId].end = Date.now();
		duration_map[basemap_default.mapId].dur = duration_map[basemap_default.mapId].end! - duration_map[basemap_default.mapId].start;
		if (args.domip) {
			globalThis.totalToMip=0;
			globalThis.mipLenMap={};
			for (let [mapId,val] of Object.entries(worldmappastes)) {
				if (mapId === '-1')continue;
				if (!basemapidstodo.includes(parseInt(mapId))) continue;
				let total = 0;
				let h = val.height*4, w=val.width*4;
				total+=(h*w);
				for (let z=4; z>-6; z--) {
					h = Math.ceil(h/2);
					w = Math.ceil(w/2);
					total+=(h*w);
				}
				if (val.squares) {
					for (let sq of val.squares) {
						total += Math.max(1, sq.n_planes)*16;
					}
				}
				if (val.chunks) {
					for (let chunk of val.chunks) {
						total += Math.max(1, chunk.n_planes);
					}
				}
				total *= ((args.mapicons?1:0)+(args.mapnoicons?1:0));
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
			progressDiv.innerText = `${globalThis.totalToMip} things to process!`
			progress2('Starting mip');
			let opts = {
				verbosity:verbosity,
				nosave:args.debug&&args.nosave,
				noicons:args.mapnoicons,
				icons:args.mapicons
			};
			for (let bm of basemaps) {
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
		duration_map[-100].end = Date.now();
		duration_map[-100].dur = duration_map[-100].end! - duration_map[-100].start;
		for (let {id,start,end,dur} of Object.values(duration_map).sort((a,b)=>a.id-b.id)) {
			let first:number|string = id;
			if (id === -100) {
				first = 'TOTAL';
			}
			log(first, (new Date(start)).toISOString(), '->', (new Date(end!)).toISOString(), ':::', (dur!/1000).toFixed(1));
		}
		progress2('Finished!');
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
	for (let cnvrow of canvases.grid) {
		const tr = document.createElement('tr');
		tbl.prepend(tr);
		for (let cnvcell of cnvrow) {
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



const COMBOS = (()=>{
	const arr:number[][] = [];
	for (let i of [0,1,2,3]) {
		for (let j of [0,1,2,3]) {
			arr.push([i,j]);
		}
	}
	return arr;
})(),
COMBOS2 = [[0,0],[0,1],[1,0],[1,1]];

const mipMapID = async (render:MapRender, basemap:BaseMap, mappaste:MapPaste, options:{verbosity:number,icons:boolean,noicons:boolean,nosave:boolean})=>{
	const originalBounds = boundsToCoords(basemap.bounds),
		tilesize = render.config.tileimgsize,
		CANVAS_MAX_SIZE = tilesize * Math.floor(CANVAS_TRUE_MAX_SIZE/tilesize),
		subtilesize = tilesize / 2,
		folders:string[]=[];
	log(`mipping mapid ${basemap.mapId}`);
	log(`bounds: ${JSON.stringify(basemap.bounds)}`);
	log(`parsedbounds: ${JSON.stringify(originalBounds)}`);
	if (options.noicons) folders.push('map_squares/');
	if (options.icons) folders.push('map_icon_squares/');
	for (let parentfolder of folders) {
		for (let layer of [0,1,2,3]) {
			let hasdrawnto=false;
			const source = parentfolder+'-1',
				output = parentfolder+basemap.mapId,
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
				mapAreaFactory = new MapAreaFactory(CANVAS_MAX_SIZE, tilesize, cnvw, cnvh, west, south);
				//mapAreaFactoryChunk = new MapAreaFactory(CANVAS_MAX_SIZE, tilesize/2, cnvw, cnvh, west, south);
			
			log(`making big map of ${parentfolder}, layer ${layer} - total ${canvases_w}x${canvases_h} canvases; ${cnvw}x${cnvh}px`)
			log('folder', source, '->', output);
			log(`west ${west}  south ${south}  east ${east}  north ${north}  numtilesw ${numtilesw}  numtilesh ${numtilesh}  cnvw ${cnvw}  cnvh ${cnvh}`);
			
			for (let sq of mappaste.squares) {
				//if (options.debug) log('SQUARE',sq);
				//mapsquare - 16 z4 renders
				// COMBOS: premade array of [0,0], [0,1], ... [3,2], [3,3]
				const maxlayer = sq.original_plane+sq.n_planes,
					newlayer = Math.min(3,sq.new_plane+layer),
					oldlayer = Math.min(3,sq.original_plane+layer);
				if  (newlayer === layer && oldlayer<=maxlayer) {
					for (let [xi,yi] of COMBOS) {
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
			for (let sq of mappaste.chunks) {
				//map chunk - 1/4 of a z4 render
				progress(1);
				const newlayer = Math.min(3,sq.new_plane+layer),
					maxlayer = sq.original_plane+sq.n_planes,
					oldlayer = Math.min(3,sq.original_plane+layer);
				if (newlayer === layer && oldlayer<=maxlayer) {
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
			if (options.verbosity>=1) {
				const tbl = addCanvasTable(multicanvas);
				debugger;
			}
			if (!hasdrawnto) continue;
			const savingcanvasobj = makeCanvas(tilesize,tilesize),
				savingcanvas = savingcanvasobj.cnv,
				savingctx = savingcanvasobj.ctx;
			if (options.verbosity>=2) document.body.prepend(savingcanvas);
			let multicnvs:MultiCanvas = multicanvas,
				westworking = west,
				southworking = south,
				numtilesw2 = numtilesw,
				numtilesh2 = numtilesh;
			for (let zoom=4; zoom>-6; zoom--) {
				log(`saving zoom ${zoom}`);
				const mapAreaFactorySaving = new MapAreaFactory(CANVAS_MAX_SIZE, tilesize, multicnvs.width, multicnvs.height, westworking, southworking);
				let numsaved=0,numblack=0;
				//for (let y=0;y<multicnvs.height;y+=tilesize) {
					//for (let x=0;x<multicnvs.width;x+=tilesize) {
				for (let y=0; y<=numtilesh2; y++) {
					for (let x=0; x<=numtilesw2; x++) {
						progress(1);
						const sourcearea = mapAreaFactorySaving.getAreaFromMapOffset(x,y);
						if (options.verbosity>=2) log('savingcanvas', y,x, sourcearea);
						if (sourcearea.canvas.row >= multicnvs.rows || sourcearea.canvas.column >= multicnvs.cols) continue;
						const cnv = multicnvs.grid[sourcearea.canvas.row][sourcearea.canvas.column],
							outfilename = render.makeFileName(layer, zoom, sourcearea.map.x, sourcearea.map.y, 'png', output);
						savingctx.clearRect(0,0,tilesize,tilesize);
						savingctx.drawImage(cnv.cnv, sourcearea.canvas.cellx, sourcearea.canvas.celly, tilesize,tilesize, 0,0,tilesize,tilesize);
						const imgdata = savingctx.getImageData(0,0,tilesize,tilesize);
						let isAllBlack = true;
						for (let i=0;i<imgdata.data.length&&isAllBlack;i+=4) {
							//isAllBlack = Math.max(...imgdata.data) === 0;
							isAllBlack = imgdata.data[i]===0 && imgdata.data[i+1]===0 && imgdata.data[i+2]===0 && imgdata.data[i+3]===0;
							//imagedata.data is a flat array of r g b a for each pixel
							//if (!isAllBlack) break;
						}
						if (isAllBlack){
							if (options.verbosity>=2) log('ALL BLACK', outfilename);
							numblack++;
						} else {
							//savingctx.drawImage(bitmap,0,0);
							numsaved++;
							if (!options.nosave) await render.saveFile(outfilename, -1, await canvasToImageFile(savingcanvas,'png',0.9));
							if (options.verbosity>=2) log('saved', outfilename);
						}
						if ((numblack + numsaved) % 200 == 0) {
							log(`saved ${numsaved} files; skipped ${numblack} blank files`);
						}
					}
				}
				log(`FINISHED saving ${zoom}; saved ${numsaved} files; skipped ${numblack} blank files`);
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
	}
	progress(0,true);
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