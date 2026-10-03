import { constants } from 'node:fs';
import { open, realpath, stat, type FileHandle } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { HelperError } from './errors.js';
export interface ApprovedFile {path:string;handle:FileHandle;revision:string}
export async function fileRevision(handle:FileHandle):Promise<string>{
  const s=await handle.stat({bigint:true});
  if(!s.isFile())throw new HelperError('INVALID_PATH','Only regular media files are supported');
  return createHash('sha256').update(`${s.dev}:${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`).digest('hex');
}
export class PathGuard {
  private constructor(private readonly roots:readonly string[]){}
  static async create(roots:readonly string[]):Promise<PathGuard>{
    if(!Array.isArray(roots)||!roots.length)throw new HelperError('ROOT_REQUIRED','At least one approved media folder is required');
    const resolved:string[]=[];
    for(const root of roots){
      if(typeof root!=='string'||!isAbsolute(root))throw new HelperError('INVALID_ROOT','Media folders must be absolute paths');
      try{const p=await realpath(root);if(!(await stat(p)).isDirectory())throw new Error();resolved.push(p);}
      catch{throw new HelperError('INVALID_ROOT','Approved media folder is unavailable');}
    }
    return new PathGuard(resolved);
  }
  async open(path:string,expectedRevision?:string):Promise<ApprovedFile>{
    if(typeof path!=='string'||path.length>4096||path.includes('\0')||!isAbsolute(path))throw new HelperError('INVALID_PATH','An absolute local media path is required');
    let resolved:string;
    try{resolved=await realpath(path);}catch{throw new HelperError('MEDIA_UNAVAILABLE','Media file is unavailable',404);}
    const permitted=this.roots.some(root=>{
      const r=relative(root,resolved);
      return r!==''&&!isAbsolute(r)&&r!=='..'&&!r.startsWith(`..${sep}`);
    });
    if(!permitted){
      throw new HelperError('PATH_FORBIDDEN','Media is outside the approved folders',403);
    }
    let handle:FileHandle;
    try{handle=await open(resolved,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);}
    catch{throw new HelperError('MEDIA_UNAVAILABLE','Media file could not be opened read-only',404);}
    try{
      const revision=await fileRevision(handle);
      if(expectedRevision!==undefined&&revision!==expectedRevision)throw new HelperError('MEDIA_CHANGED','Media changed; probe it again',409);
      return {path:resolved,handle,revision};
    }catch(error){await handle.close();throw error;}
  }
}
