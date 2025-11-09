import { CacheFileSource } from "./cache";
import { cacheMajors } from "./constants";

type MapLabelLocation = {labelId:number,location:{x:number,y:number,plane:number, loc:number},val?:number};

const range = function* (val1:number,val2?:number):Generator<number> {
	let start:number,end:number;
	if (val2) {
		start=val1;
		end=val2;
	} else {
		start=0;
		end=val1;
	}
	if (start<end) {
		for (let i=start;i<end;i++) {
			yield i;
		}
	} else {
		for (let i=start;i>end;i--) {
			yield i;
		}
	}
	return
},
coordRange = function* (maxX:number, maxY:number):Generator<{x:number,y:number}> {
	for (const x of range(maxX)) {
		for (const y of range(maxY)) {
			yield {x,y}
		}
	}
	return;
},
makeCombinations = function (a1:number,a2:number,b1:number,b2:number):[number,number][] {
	const out:[number,number][] = [];
	for (const {x,y} of coordRange(a2-a1+1, b2-b1+1)) {
		out.push([x+a1,y+b1]);
	}
	return out;
},
isAllBlack = function(imgdata:ImageData){
	for (let i=0;i<imgdata.data.length;i+=4) {
		//isAllBlack = Math.max(...imgdata.data) === 0;
		if (!(imgdata.data[i]===0 && imgdata.data[i+1]===0 && imgdata.data[i+2]===0 && imgdata.data[i+3]===0)) {
			return false;
		}
	}
	return true;
},
readMapLabelLocations = async function (source:CacheFileSource):Promise<MapLabelLocation[]> {
	const index = await source.getCacheIndex(cacheMajors.maplabellocations);
	const out:MapLabelLocation[] = [];
	for (const d of index) {
		if (d === undefined || d.major === undefined || d.minor === undefined) {
			continue;
		}
		const file = await source.getArchiveById(d.major, d.minor);
		for (const f of file) {
			let off = f.offset;
			const count = f.buffer.readUInt16BE(off);
			off+=2;
			for (let i=0;i<count;i++) {
				const loc = f.buffer.readInt32BE(off);
				off+=4;
				const plane = loc >> 28;
				const x = (loc >> 14) & 0x3FFF;
				const y = loc & 0x3FFF;
				const id = f.buffer.readUInt16BE(off);
				off+=2;
				const val = f.buffer.readUInt8(off); // should always be 0
				off+=1;
				out.push({
					labelId: id,
					location: { x, y, plane, loc },
					val
				});
			}
		}
	}
	return out;
};



export {MapLabelLocation, readMapLabelLocations, range, coordRange, makeCombinations, isAllBlack};