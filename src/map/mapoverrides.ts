
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
	}[]
	customs: {[k:string]:mapzones_pastes},
	addplanes: {mapId:number, n_planes:number}[]
};

const load = async () => {
	let overrides:MapOverrides = commentjson.parse(await fs.readFile('map_overrides.jsonc', 'utf-8')) as any;
	return overrides;	
};

export const applyOverrides = async (mappastes:{[k:string]:mapzones_pastes}) => {
	let overrides = await load();
	
	// apply overrides
	for (let ov of overrides.overrides) {
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

	// add customs
	for (let ov of Object.values(overrides.customs)) {
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
	for (let pl of overrides.addplanes) {
		for (let sq of mappastes[pl.mapId.toString()].squares) {
			sq.n_planes = pl.n_planes;
		}
		for (let ch of mappastes[pl.mapId.toString()].chunks) {
			ch.n_planes = pl.n_planes;
		}
	}
};