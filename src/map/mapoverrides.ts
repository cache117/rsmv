
import fs from "fs/promises";
import * as commentjson from "comment-json";
import { mapzones_pastes } from "../../generated/mapzones_pastes";

type MapOverrides = {
	overrides: {
		mapId: number,
		index?:number,
		content: {
			original_plane: number,
			n_planes: number,
			original_regionX: number,
			original_regionY: number,
			new_plane: number,
			new_regionX: number,
			new_regionY: number,
		}
	}[],
	addtiles?: {
		mapId: number,
		squares?: mapzones_pastes["squares"],
		chunks?: mapzones_pastes["chunks"]
	}[],
	customs: {[k:string]:mapzones_pastes},
	addplanes: {mapId:number, n_planes:number}[]
};

const load = async () => {
	const overrides:MapOverrides = commentjson.parse(await fs.readFile('map_overrides.jsonc', 'utf-8')) as any;
	return overrides;	
};

export const applyOverrides = async (mappastes:{[k:string]:mapzones_pastes}) => {
	let overrides = await load();
	
	// apply overrides
	for (const ov of overrides.overrides) {
		let oldsq = mappastes[ov.mapId].squares;
		if (ov.index !== undefined) {
			oldsq[ov.index] = ov.content;
		} else {
			let x = ov.content.original_regionX, y = ov.content.original_regionY;
			for (let old of oldsq) {
				if (old.new_regionX == x && old.new_regionY == y) {
					Object.assign(old, ov.content);
					break
				}
			}
		}
	}
	if (overrides.addtiles) {
		for (const add of overrides.addtiles) {
			if (add.chunks) {
				for (let ch of add.chunks) {
					mappastes[add.mapId].chunks.push(ch);
				}
			}
			if (add.squares) {
				for (let sq of add.squares) {
					mappastes[add.mapId].squares.push(sq);
				}
			}
			//recalculate size just to be sure its ok
			let minx=100,maxx=0,miny=200,maxy=0;
			for (let ch of mappastes[add.mapId].chunks) {
				minx=Math.min(minx, ch.new_regionX);
				maxx=Math.min(maxx, ch.new_regionX+1);
				miny=Math.min(miny, ch.new_regionY);
				maxy=Math.min(maxy, ch.new_regionY+1);
			}
			for (let sq of mappastes[add.mapId].squares) {
				minx=Math.min(minx, sq.new_regionX);
				maxx=Math.min(maxx, sq.new_regionX+1);
				miny=Math.min(miny, sq.new_regionY);
				maxy=Math.min(maxy, sq.new_regionY+1);
			}
			mappastes[add.mapId].height = Math.max(1,maxy-miny);
			mappastes[add.mapId].width = Math.max(1,maxx-minx);
		}
	}

	// add customs
	for (const ov of Object.values(overrides.customs)) {
		let minnewx=500,minnewy=500,maxnewx=0,maxnewy=0;
		if (ov.squares) {
			for (let sq of ov.squares) {
				minnewx=Math.min(minnewx, sq.new_regionX);
				minnewy=Math.min(minnewy, sq.new_regionY);
				maxnewx=Math.max(maxnewx, sq.new_regionX);
				maxnewy=Math.max(maxnewy, sq.new_regionY);
				sq.n_planes=Math.max(1,sq.n_planes);
			}
		} else {
			ov.squares=[];
		}
		if (ov.chunks) {
				for (let sq of ov.chunks) {
				minnewx=Math.min(minnewx, sq.new_regionX);
				minnewy=Math.min(minnewy, sq.new_regionY);
				maxnewx=Math.max(maxnewx, sq.new_regionX);
				maxnewy=Math.max(maxnewy, sq.new_regionY);
				sq.n_planes=Math.max(1,sq.n_planes);
			}
		} else {
			ov.chunks=[];
		}
		ov.height = maxnewy-minnewy+1;
		ov.width = maxnewx-minnewx+1;
	}
	Object.assign(mappastes, overrides.customs);
	
	// addplanes
	for (const pl of overrides.addplanes) {
		for (const sq of mappastes[pl.mapId.toString()].squares) {
			sq.n_planes = pl.n_planes;
		}
		for (const ch of mappastes[pl.mapId.toString()].chunks) {
			ch.n_planes = pl.n_planes;
		}
	}
};