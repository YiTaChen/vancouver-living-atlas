import type { Coord, Feature } from './types';
export const ORIGIN: Coord = [-123.128,49.286];
export const MX = 111320 * Math.cos(ORIGIN[1]*Math.PI/180), MZ = 111320;
export function project(c: number[]): [number,number] { return [(c[0]-ORIGIN[0])*MX, -(c[1]-ORIGIN[1])*MZ]; }
export function unproject(x:number,z:number): Coord { return [x/MX+ORIGIN[0],ORIGIN[1]-z/MZ]; }
export function rings(f: Feature): number[][][][] { return f.geometry.type==='MultiPolygon'?f.geometry.coordinates:[f.geometry.coordinates]; }
export function lines(f: Feature): number[][][] { return f.geometry.type==='MultiLineString'?f.geometry.coordinates:[f.geometry.coordinates]; }
export function inside(p:number[],r:number[][]) { let result=false; for(let i=0,j=r.length-1;i<r.length;j=i++) { const a=r[i],b=r[j]; if(((a[1]>p[1])!==(b[1]>p[1]))&&(p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])) result=!result; }return result; }
export function inPolygon(p:number[],poly:number[][][]) { return inside(p,poly[0])&&!poly.slice(1).some(r=>inside(p,r)); }
export function hash(n:number) { const a=Math.sin(n*127.1+311.7)*43758.5453; return a-Math.floor(a); }
